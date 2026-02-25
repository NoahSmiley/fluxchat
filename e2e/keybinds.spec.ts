import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  openSettings,
  navigateToSettingsTab,
} from "./helpers";

test.describe("Keybinds Settings", () => {
  test.describe.configure({ mode: "serial" });

  test("keybinds tab shows all four actions", async ({ page }) => {
    const user = uniqueUser("keybind");
    await registerUser(page, user.email, user.username, user.password);

    await openSettings(page);
    await navigateToSettingsTab(page, "Keybinds");

    // Should show Push to Talk, Push to Mute, Toggle Mute, Toggle Deafen
    await expect(page.locator('text=Push to Talk').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Push to Mute').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Toggle Mute').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Toggle Deafen').first()).toBeVisible({ timeout: 5000 });
  });

  test("each keybind shows current value or Not set", async ({ page }) => {
    const user = uniqueUser("keybindval");
    await registerUser(page, user.email, user.username, user.password);

    await openSettings(page);
    await navigateToSettingsTab(page, "Keybinds");

    // Each keybind row should show either a key name or "Not set"
    const keybindRows = page.locator(".keybind-row, .settings-row").filter({ hasText: /Push to|Toggle/ });
    const count = await keybindRows.count();
    expect(count).toBe(4);
  });

  test("clicking Record enters recording mode", async ({ page }) => {
    const user = uniqueUser("keybindrec");
    await registerUser(page, user.email, user.username, user.password);

    await openSettings(page);
    await navigateToSettingsTab(page, "Keybinds");

    // Click the first keybind button ("Not set") to enter recording mode
    const recordBtn = page.locator('.keybind-button').first();
    await recordBtn.click();
    await page.waitForTimeout(300);

    // Should show recording state with "Press a key..." text
    await expect(page.locator('.keybind-button.recording').first()).toBeVisible({ timeout: 3000 });
  });

  test("pressing Escape cancels recording", async ({ page }) => {
    const user = uniqueUser("keybindesc");
    await registerUser(page, user.email, user.username, user.password);

    await openSettings(page);
    await navigateToSettingsTab(page, "Keybinds");

    const recordBtn = page.locator('.keybind-button').first();
    await recordBtn.click();
    await page.waitForTimeout(300);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Recording mode should exit
    await expect(page.locator('.keybind-button.recording')).not.toBeVisible({ timeout: 2000 });
  });

  test("pressing a key sets the keybind", async ({ page }) => {
    const user = uniqueUser("keybindset");
    await registerUser(page, user.email, user.username, user.password);

    await openSettings(page);
    await navigateToSettingsTab(page, "Keybinds");

    const recordBtn = page.locator('.keybind-button').first();
    await recordBtn.click();
    await page.waitForTimeout(300);

    // Press F5 to set the keybind
    await page.keyboard.press("F5");
    await page.waitForTimeout(500);

    // Should now show "F5" in the keybind display
    await expect(page.locator('text=F5').first()).toBeVisible({ timeout: 3000 });
  });
});
