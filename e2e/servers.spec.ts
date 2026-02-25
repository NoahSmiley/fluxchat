import { test, expect } from "@playwright/test";
import { uniqueUser, registerUser, createChannel, selectChannel, openServerSettings } from "./helpers";

test.describe("Server and Channel Management", () => {
  let email: string;
  let username: string;
  let password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("srv");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
  });

  test("auto-creates and auto-selects server for first user", async ({ page }) => {
    // After registration, the first user should have the "FluxChat" server auto-created.
    // The channel sidebar should be visible with the server name
    await expect(page.locator(".channel-sidebar-header-title").first()).toBeVisible({ timeout: 10000 });
  });

  test("server name is displayed in channel sidebar header", async ({ page }) => {
    // The auto-created server is named "FluxChat" (may have been renamed by a previous test run)
    const header = page.locator(".channel-sidebar-header-title").first();
    await expect(header).toBeVisible({ timeout: 10000 });
    const text = await header.textContent();
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(0);
  });

  test("create a text channel via the UI", async ({ page }) => {
    const channelName = "test-channel";
    await createChannel(page, channelName, "text");

    // The new channel should appear in the channel list
    await expect(page.locator(`.channel-item:has-text("${channelName}")`).first()).toBeVisible({ timeout: 5000 });
  });

  // Voice channels no longer exist as standalone sidebar items — only rooms.
  test.skip("create a voice channel via the UI", async ({ page }) => {
    const channelName = "voice-room";
    await createChannel(page, channelName, "voice");

    await expect(page.locator(`.channel-item:has-text("${channelName}")`).first()).toBeVisible({ timeout: 5000 });
  });

  test("select a channel and see the chat view", async ({ page }) => {
    await createChannel(page, "chat-room", "text");
    await selectChannel(page, "chat-room");

    // The main content area should show the chat view (which has a message input)
    await expect(
      page.locator('[data-testid="message-input"], input.message-input').first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("rename server via API and see updated name", async ({ page }) => {
    const newName = "RenamedServer";

    // Get the server ID and rename via API (admins can rename via API)
    await page.evaluate(async (name) => {
      const token = localStorage.getItem("flux-session-token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Get servers list
      const listRes = await fetch("/api/servers", { headers });
      const servers = await listRes.json();
      if (servers.length > 0) {
        await fetch(`/api/servers/${servers[0].id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ name }),
        });
      }
    }, newName);

    // Reload to pick up the change
    await page.reload();
    await page.waitForTimeout(2000);

    // Verify the header shows the new name
    await expect(page.locator(".channel-sidebar-header-title").first()).toHaveText(newName, { timeout: 5000 });
  });
});
