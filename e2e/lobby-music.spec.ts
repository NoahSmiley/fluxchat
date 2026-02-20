import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  openSettings,
  closeSettings,
  navigateToSettingsTab,
  setLocalStorage,
  getLocalStorage,
  removeLocalStorage,
} from "./helpers";

test.describe("Lobby Music Easter Egg", () => {
  test.describe.configure({ mode: "serial" });

  let email: string, username: string, password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("lobby");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
  });

  test("lobby music is NOT unlocked by default", async ({ page }) => {
    const val = await getLocalStorage(page, "flux-lobby-music-unlocked");
    expect(val).toBeNull();
  });

  test("settings voice tab does NOT show lobby music card when not unlocked", async ({ page }) => {
    await removeLocalStorage(page, "flux-lobby-music-unlocked");
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-card-title:has-text("Lobby Music")')).not.toBeVisible({ timeout: 2000 });
  });

  test("after setting localStorage unlock, settings shows lobby music card", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-card-title:has-text("Lobby Music")').first()).toBeVisible({ timeout: 3000 });
  });

  test("lobby music toggle is visible after unlock", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-row-label:has-text("Play ambient music when alone")').first()).toBeVisible({ timeout: 3000 });
    const lobbyCard = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music"))');
    await expect(lobbyCard.locator('[role="switch"]')).toBeVisible();
  });

  test("lobby music toggle defaults to ON after unlock", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    // Don't set flux-lobby-music-enabled — default is true (not "false")
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    const lobbyCard = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music"))');
    const toggle = lobbyCard.locator('[role="switch"]');
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("toggling lobby music OFF persists to localStorage", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    const lobbyCard = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music"))');
    const toggle = lobbyCard.locator('[role="switch"]');
    // Default is on, click to turn off
    await toggle.click();
    await page.waitForTimeout(300);
    const val = await getLocalStorage(page, "flux-lobby-music-enabled");
    expect(val).toBe("false");
  });

  test("toggling lobby music ON persists to localStorage", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    await setLocalStorage(page, "flux-lobby-music-enabled", "false");
    // Reload so the component picks up the new localStorage values on mount
    await page.reload();
    await page.locator('.server-sidebar').first().waitFor({ state: "visible", timeout: 15000 });
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    const lobbyCard = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music"))');
    const toggle = lobbyCard.locator('[role="switch"]');
    // Verify it starts as off
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    // Click to toggle on
    await toggle.click();
    await page.waitForTimeout(300);
    const val = await getLocalStorage(page, "flux-lobby-music-enabled");
    expect(val).toBe("true");
  });

  test("lobby music setting survives modal close and reopen", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    await setLocalStorage(page, "flux-lobby-music-enabled", "false");
    // Reload so the component picks up localStorage values on mount
    await page.reload();
    await page.locator('.server-sidebar').first().waitFor({ state: "visible", timeout: 15000 });
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    const toggle = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music")) [role="switch"]');
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await closeSettings(page);

    // Reopen settings — should still be off
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    const toggle2 = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music")) [role="switch"]');
    await expect(toggle2).toHaveAttribute("aria-checked", "false");
  });

  test("removing unlock key hides lobby music from settings", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-card-title:has-text("Lobby Music")').first()).toBeVisible({ timeout: 3000 });
    await closeSettings(page);

    // Remove the unlock key
    await removeLocalStorage(page, "flux-lobby-music-unlocked");

    // Reopen settings — lobby music should be gone
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-card-title:has-text("Lobby Music")')).not.toBeVisible({ timeout: 2000 });
  });

  test("lobby music description text is correct", async ({ page }) => {
    await setLocalStorage(page, "flux-lobby-music-unlocked", "true");
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-row-desc:has-text("Lofi tunes fade in after 30s alone in a voice channel")').first()).toBeVisible({ timeout: 3000 });
  });
});
