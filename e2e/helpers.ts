import { type Page } from "@playwright/test";

const API_BASE = "http://127.0.0.1:3001";

// Cached admin token for whitelisting test users.
// The admin is the "first user" who bypasses the whitelist gate.
let adminToken: string | null = null;
let adminBootstrapped = false;

/**
 * Bootstrap the admin user if not already done.
 * The admin is registered via direct API call (bypasses the whitelist as first user).
 * On reused servers where the admin already exists, we sign in instead.
 */
async function bootstrapAdmin(): Promise<void> {
  if (adminBootstrapped) return;
  adminBootstrapped = true;

  const adminEmail = "e2e-admin@test.com";
  const adminUsername = "e2e_admin";
  const adminPassword = "TestPass123!";

  try {
    // Try to register (works if this is the first user in a fresh DB)
    const signUpRes = await fetch(`${API_BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
        name: adminUsername,
        username: adminUsername,
      }),
    });

    if (signUpRes.ok) {
      const data = await signUpRes.json();
      adminToken = data.token;
      return;
    }

    // Admin might already exist (reused server). Try signing in.
    const signInRes = await fetch(`${API_BASE}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
      }),
    });

    if (signInRes.ok) {
      const data = await signInRes.json();
      adminToken = data.token;
    }
  } catch {
    // Server might not be ready; admin bootstrapping failed
  }
}

/**
 * Whitelist an email using the admin token via direct HTTP call.
 * Bootstraps the admin user on first call.
 */
async function ensureWhitelisted(email: string): Promise<void> {
  await bootstrapAdmin();
  if (!adminToken) return;

  try {
    await fetch(`${API_BASE}/api/whitelist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ emails: [email] }),
    });
  } catch {
    // Best effort
  }
}

/**
 * Promote a user to "admin" role using the admin token.
 * This gives them permission to create/delete channels and manage the server.
 */
async function promoteToAdmin(userId: string): Promise<void> {
  if (!adminToken) return;

  try {
    await fetch(`${API_BASE}/api/members/${userId}/role`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ role: "admin" }),
    });
  } catch {
    // Best effort
  }
}

let userCounter = 0;

export function uniqueUser(prefix = "user") {
  userCounter++;
  const id = `${prefix}${userCounter}_${Date.now()}`;
  return {
    email: `${id}@test.com`,
    username: id.slice(0, 20),
    password: "TestPass123!",
  };
}

/**
 * Register a new user via the /register page.
 *
 * Before registration, the email is automatically whitelisted using an admin
 * token (the admin is auto-bootstrapped as the first user in the DB).
 *
 * After registration, the user auto-joins the "FluxChat" server with
 * "general" text and voice channels.
 */
export async function registerUser(
  page: Page,
  email: string,
  username: string,
  password: string,
) {
  // Pre-whitelist this email so registration succeeds
  await ensureWhitelisted(email);

  await page.goto("/register");
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill(password);

  await page.locator('button[type="submit"]').click();

  // Wait for the main app UI to appear (server sidebar proves we're fully loaded)
  await page.locator(".server-sidebar").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);

  // Promote this user to admin so they can create channels, manage server, etc.
  const userId = await page.evaluate(async () => {
    const token = localStorage.getItem("flux-session-token");
    if (!token) return null;
    const res = await fetch("/api/auth/get-session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user?.id || null;
  });
  if (userId) {
    await promoteToAdmin(userId);
  }
}

/**
 * Login an existing user via the /login page.
 */
export async function loginUser(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);

  await page.locator('button[type="submit"]').click();

  // Wait for the main app UI to appear (server sidebar proves we're fully loaded)
  await page.locator(".server-sidebar").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(500);
}

/**
 * Fetch the list of servers the current user belongs to via API.
 * Returns the parsed JSON array of servers.
 */
async function getServersViaAPI(page: Page) {
  return await page.evaluate(async () => {
    const token = localStorage.getItem("flux-session-token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/servers", {
      credentials: "include",
      headers,
    });
    if (!res.ok) return [];
    return res.json();
  });
}

/**
 * Wait for the app to be fully loaded with the server view visible.
 * Useful after reload or navigation.
 */
export async function waitForAppReady(page: Page, timeout = 10000) {
  await page.locator(".channel-sidebar").first().waitFor({ state: "visible", timeout });
}

/**
 * Click the Create Channel button (+) in the channel sidebar and fill out the modal.
 */
export async function createChannel(page: Page, channelName: string, type: "text" | "voice" | "category" = "text") {
  const addBtn = page.locator('button[title="Create Channel"]').first();
  await addBtn.click();
  await page.waitForTimeout(500);

  if (type === "voice") {
    await page.locator('button.channel-type-option:has-text("Voice")').click();
  } else if (type === "category") {
    await page.locator('button.channel-type-option:has-text("Category")').click();
  }

  await page.locator('.modal input[type="text"]').fill(channelName);
  await page.locator('.modal button[type="submit"]').click();
  await page.waitForTimeout(1000);
}

/**
 * Select a channel from the channel sidebar by name.
 */
export async function selectChannel(page: Page, channelName: string) {
  await page.locator(`.channel-item:has-text("${channelName}")`).first().click();
  await page.waitForTimeout(500);
}

/**
 * Send a message in the current chat view by typing into the message input and pressing Enter.
 */
export async function sendMessage(page: Page, text: string) {
  const input = page.locator('[data-testid="message-input"], input.message-input').first();
  await input.click();
  await input.pressSequentially(text, { delay: 20 });
  await input.press("Enter");
  await page.waitForTimeout(500);
}

/**
 * Wait for a message containing the given text to appear on the page.
 */
export async function waitForMessage(page: Page, text: string, timeout = 5000) {
  await page.locator(`text=${text}`).first().waitFor({ timeout });
}

/**
 * Open the user settings modal by clicking the settings gear button in the server sidebar.
 */
export async function openSettings(page: Page) {
  await page.locator('button[title="User Settings"]').click();
  await page.waitForTimeout(500);
}

/**
 * Close the settings modal.
 */
export async function closeSettings(page: Page) {
  await page.locator('.settings-nav-close').click();
  await page.waitForTimeout(300);
}

/**
 * Open server settings by clicking the server name header or the settings icon in the channel sidebar.
 */
export async function openServerSettings(page: Page) {
  await page.locator('.channel-sidebar-header-btn[title="Server Settings"]').first().click();
  await page.waitForTimeout(500);
}

/**
 * Whitelist an email via the API using the current page's session token.
 */
export async function whitelistEmailViaAPI(page: Page, email: string) {
  return await page.evaluate(async (emailToAdd) => {
    const token = localStorage.getItem("flux-session-token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/whitelist", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ emails: [emailToAdd] }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    if (!text) return { ok: true };
    try {
      return JSON.parse(text);
    } catch {
      return { ok: true, body: text };
    }
  }, email);
}

/**
 * Navigate to a settings tab within the settings modal.
 * Assumes settings modal is already open.
 */
export async function navigateToSettingsTab(page: Page, tabName: string) {
  await page.locator(`.settings-nav-item:has-text("${tabName}")`).click();
  await page.waitForTimeout(300);
}

/**
 * Set a localStorage value.
 */
export async function setLocalStorage(page: Page, key: string, value: string) {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [key, value]);
}

/**
 * Get a localStorage value.
 */
export async function getLocalStorage(page: Page, key: string): Promise<string | null> {
  return await page.evaluate((k) => localStorage.getItem(k), key);
}

/**
 * Remove a localStorage key.
 */
export async function removeLocalStorage(page: Page, key: string) {
  await page.evaluate((k) => localStorage.removeItem(k), key);
}

/**
 * Execute the Konami code sequence (↑↑↓↓←→←→).
 */
export async function enterKonamiCode(page: Page) {
  const keys = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"];
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(50);
  }
}
