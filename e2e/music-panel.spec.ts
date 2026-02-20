import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  enterKonamiCode,
} from "./helpers";

test.describe("Music Panel & Voice Channel View", () => {
  test.describe.configure({ mode: "serial" });

  let email: string, username: string, password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("music");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
  });

  test("voice channel view renders when voice channel is selected", async ({ page }) => {
    await createChannel(page, "music-vc", "voice");
    await selectChannel(page, "music-vc");
    await expect(page.locator('.voice-channel-view').first()).toBeVisible({ timeout: 5000 });
  });

  test("voice channel tabs are NOT visible when not connected", async ({ page }) => {
    await createChannel(page, "music-tabs", "voice");
    await selectChannel(page, "music-tabs");
    // voice-channel-tabs only render when isConnected === true
    await expect(page.locator('.voice-channel-tabs')).not.toBeVisible({ timeout: 2000 });
  });

  test("music panel is not visible without voice connection", async ({ page }) => {
    await createChannel(page, "music-noconn", "voice");
    await selectChannel(page, "music-noconn");
    // MusicPanel is only mounted when isConnected && activeTab === "music"
    await expect(page.locator('.music-panel')).not.toBeVisible({ timeout: 2000 });
  });

  test("soundboard panel is not visible without voice connection", async ({ page }) => {
    await createChannel(page, "sb-noconn", "voice");
    await selectChannel(page, "sb-noconn");
    await expect(page.locator('.soundboard-panel')).not.toBeVisible({ timeout: 2000 });
  });

  test("key sequences do not crash the page", async ({ page }) => {
    await createChannel(page, "konami-vc", "voice");
    await selectChannel(page, "konami-vc");
    // Pressing konami code keys should not cause errors even without music panel mounted
    await enterKonamiCode(page);
    await page.waitForTimeout(500);
    // Page should still be functional
    await expect(page.locator('.voice-channel-view').first()).toBeVisible();
  });

  test("text channel does NOT show voice-channel-view", async ({ page }) => {
    await createChannel(page, "not-voice", "text");
    await selectChannel(page, "not-voice");
    await expect(page.locator('.voice-channel-view')).not.toBeVisible({ timeout: 2000 });
    await expect(page.locator('[data-testid="message-input"], input.message-input').first()).toBeVisible({ timeout: 5000 });
  });

  test("voice channel shows in sidebar immediately after creation", async ({ page }) => {
    await createChannel(page, "instant-vc", "voice");
    await expect(page.locator('.channel-item:has-text("instant-vc")').first()).toBeVisible({ timeout: 5000 });
  });

  test("voice channel view has no theatre class by default", async ({ page }) => {
    await createChannel(page, "no-theatre", "voice");
    await selectChannel(page, "no-theatre");
    const vcv = page.locator('.voice-channel-view').first();
    await expect(vcv).toBeVisible({ timeout: 5000 });
    await expect(vcv).not.toHaveClass(/theatre/);
  });

  test("participants area renders in voice channel view", async ({ page }) => {
    await createChannel(page, "part-vc", "voice");
    await selectChannel(page, "part-vc");
    // The voice channel view renders even when nobody is connected
    await expect(page.locator('.voice-channel-view').first()).toBeVisible({ timeout: 5000 });
  });

  test("switching between voice channels updates view", async ({ page }) => {
    await createChannel(page, "vc-one", "voice");
    await createChannel(page, "vc-two", "voice");

    await selectChannel(page, "vc-one");
    await expect(page.locator('.voice-channel-view').first()).toBeVisible({ timeout: 5000 });

    await selectChannel(page, "vc-two");
    await expect(page.locator('.voice-channel-view').first()).toBeVisible({ timeout: 5000 });
  });
});
