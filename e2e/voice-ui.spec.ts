import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  openSettings,
  navigateToSettingsTab,
} from "./helpers";

test.describe("Voice Channel UI", () => {
  test.describe.configure({ mode: "serial" });

  let email: string, username: string, password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("voice");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
  });

  test("voice channel appears in sidebar after creation", async ({ page }) => {
    await createChannel(page, "voice-test", "voice");
    const voiceChannel = page.locator('.channel-item:has-text("voice-test")').first();
    await expect(voiceChannel).toBeVisible({ timeout: 5000 });
  });

  test("clicking voice channel shows voice-channel-view", async ({ page }) => {
    await createChannel(page, "vc-select", "voice");
    await selectChannel(page, "vc-select");
    await expect(page.locator('.voice-channel-view').first()).toBeVisible({ timeout: 5000 });
  });

  test("voice channel view shows without tabs when not connected", async ({ page }) => {
    await createChannel(page, "vc-notabs", "voice");
    await selectChannel(page, "vc-notabs");
    await expect(page.locator('.voice-channel-view').first()).toBeVisible({ timeout: 5000 });
    // Tabs only render when isConnected === true
    await expect(page.locator('.voice-channel-tabs')).not.toBeVisible({ timeout: 2000 });
  });

  test("voice status bar is hidden when not connected to voice", async ({ page }) => {
    // VoiceStatusBar returns null when connectedChannelId is null
    await expect(page.locator('.voice-status-bar')).not.toBeVisible({ timeout: 2000 });
  });

  test("multiple voice channels can be created", async ({ page }) => {
    await createChannel(page, "vc-alpha", "voice");
    await createChannel(page, "vc-beta", "voice");
    await expect(page.locator('.channel-item:has-text("vc-alpha")').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.channel-item:has-text("vc-beta")').first()).toBeVisible({ timeout: 5000 });
  });

  test("voice channel icon differs from text channel icon", async ({ page }) => {
    await createChannel(page, "text-compare", "text");
    await createChannel(page, "voice-compare", "voice");
    // Both should have icon elements but with different SVG content
    const textItem = page.locator('.channel-item:has-text("text-compare")').first();
    const voiceItem = page.locator('.channel-item:has-text("voice-compare")').first();
    await expect(textItem).toBeVisible();
    await expect(voiceItem).toBeVisible();
    // Text channels use Hash icon, voice channels use Volume2 icon
    const textSvg = await textItem.locator('svg').first().innerHTML();
    const voiceSvg = await voiceItem.locator('svg').first().innerHTML();
    expect(textSvg).not.toBe(voiceSvg);
  });

  test("voice and audio settings tab shows processing toggles", async ({ page }) => {
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-card-title:has-text("Processing")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-row-label:has-text("Noise Cancellation")').first()).toBeVisible({ timeout: 3000 });
  });

  test("switching between text and voice channels updates content area", async ({ page }) => {
    await createChannel(page, "txt-switch", "text");
    await createChannel(page, "vc-switch", "voice");

    // Select text channel — should show message input
    await selectChannel(page, "txt-switch");
    await expect(page.locator('[data-testid="message-input"], input.message-input').first()).toBeVisible({ timeout: 5000 });

    // Select voice channel — should show voice view, NOT message input
    await selectChannel(page, "vc-switch");
    await expect(page.locator('.voice-channel-view').first()).toBeVisible({ timeout: 5000 });
  });
});
