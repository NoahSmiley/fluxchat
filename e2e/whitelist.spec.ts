import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  openServerSettings,
  whitelistEmailViaAPI,
} from "./helpers";

test.describe("Whitelist Management", () => {
  test("first user bypasses whitelist on registration", async ({ page }) => {
    const user = uniqueUser("wlFirst");
    await registerUser(page, user.email, user.username, user.password);

    // First user should successfully register and see the main app
    await expect(page).not.toHaveURL(/login|register/);
    await expect(page.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
  });

  test("non-whitelisted user cannot register", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      // Register first user (Alice) -- auto-creates "FluxChat" server
      const alice = uniqueUser("wlAlice");
      await registerUser(pageA, alice.email, alice.username, alice.password);

      // Try to register Bob without whitelisting
      const bob = uniqueUser("wlBob");
      await pageB.goto("/register");
      await pageB.waitForSelector('input[type="email"]', { timeout: 10000 });

      await pageB.locator('input[type="email"]').fill(bob.email);
      await pageB.locator('input[type="text"]').fill(bob.username);
      await pageB.locator('input[type="password"]').fill(bob.password);
      await pageB.locator('button[type="submit"]').click();
      await pageB.waitForTimeout(2000);

      // Bob should see an error or remain on the register page
      const hasError = await pageB.locator(".auth-error").isVisible().catch(() => false);
      const stillOnRegister = pageB.url().includes("register");
      expect(hasError || stillOnRegister).toBe(true);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("add email to whitelist via server settings UI", async ({ page }) => {
    const user = uniqueUser("wlAdmin");
    await registerUser(page, user.email, user.username, user.password);
    // Server "FluxChat" is auto-created; no manual creation needed

    // Open server settings
    await openServerSettings(page);

    // Navigate to Members tab (which contains the whitelist)
    await page.locator('.settings-nav-item:has-text("Members")').click();
    await page.waitForTimeout(500);

    // Type an email into the whitelist input
    const testEmail = `whitelisted_${Date.now()}@test.com`;
    await page.locator('input[type="email"][placeholder*="@"]').fill(testEmail);
    await page.locator('button:has-text("Add")').click();
    await page.waitForTimeout(1000);

    // The email should appear in the whitelist
    await expect(page.locator(`.settings-row-label:has-text("${testEmail}")`).first()).toBeVisible({ timeout: 5000 });
  });

  test("whitelisted user can register successfully", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("wlOk");
      const bob = uniqueUser("wlBobOk");

      // Register Alice (first user, auto-creates "FluxChat" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);

      // Whitelist Bob's email
      await whitelistEmailViaAPI(pageA, bob.email);

      // Bob can now register
      await registerUser(pageB, bob.email, bob.username, bob.password);

      // Bob should be on the main app
      await expect(pageB).not.toHaveURL(/login|register/);
      await expect(pageB.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
