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
    // After registration, the first user should have the "flux" server auto-created.
    // The channel sidebar should be visible with channel items
    await expect(page.locator(".channel-sidebar").first()).toBeVisible({ timeout: 10000 });
    // Should have at least one channel (general is auto-created)
    await expect(page.locator(".channel-item").first()).toBeVisible({ timeout: 10000 });
  });

  test("server name is visible in server settings", async ({ page }) => {
    // Sidebar header was removed (single-server app). Server name is in settings.
    await page.locator('button[title="User Settings"]').click();
    await page.waitForTimeout(500);
    // Navigate to server Overview tab
    await page.locator('.settings-nav-item:has-text("Overview")').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.settings-row-label:has-text("Server Name")').first()).toBeVisible({ timeout: 5000 });
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

  // Skip: Sidebar header was removed. Server rename is verified through settings UI.
  test.skip("rename server via API and see updated name", () => {});
});
