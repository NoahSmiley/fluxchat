import { test, expect } from "@playwright/test";
import { uniqueUser, registerUser, openSettings, closeSettings } from "./helpers";

test.describe("Settings UI", () => {
  let email: string;
  let username: string;
  let password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("set");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
    // Server "flux" is auto-created on first user registration; no manual creation needed
  });

  test("settings modal can be opened and closed", async ({ page }) => {
    await openSettings(page);
    await expect(page.locator(".settings-page").first()).toBeVisible({ timeout: 5000 });

    await closeSettings(page);
    await expect(page.locator(".settings-page")).not.toBeVisible({ timeout: 3000 });
  });

  test("navigate through all settings tabs", async ({ page }) => {
    await openSettings(page);

    const tabs = ["Profile", "Appearance", "Voice & Audio", "Keybinds", "Updates", "Spotify", "Debug"];

    for (const tab of tabs) {
      await page.locator(`.settings-nav-item:has-text("${tab}")`).click();
      await page.waitForTimeout(300);

      // Verify the content title matches the tab
      await expect(page.locator(".settings-content-title").first()).toHaveText(tab, { timeout: 3000 });
    }
  });

  test("appearance tab shows sidebar position picker", async ({ page }) => {
    await openSettings(page);

    await page.locator('.settings-nav-item:has-text("Appearance")').click();
    await page.waitForTimeout(300);

    // Should show Sidebar Position section
    await expect(page.locator("text=Sidebar Position").first()).toBeVisible({ timeout: 3000 });
    // Should show position options
    await expect(page.locator('.ring-style-option:has-text("Left")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.ring-style-option:has-text("Top")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.ring-style-option:has-text("Right")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.ring-style-option:has-text("Bottom")').first()).toBeVisible({ timeout: 3000 });

    // Should show App Border section
    await expect(page.locator("text=App Border").first()).toBeVisible({ timeout: 3000 });
  });

  test("voice tab shows device selection", async ({ page }) => {
    await openSettings(page);

    await page.locator('.settings-nav-item:has-text("Voice")').click();
    await page.waitForTimeout(300);

    // Should show device selection dropdowns
    await expect(page.locator("text=Input Device").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Output Device").first()).toBeVisible({ timeout: 3000 });

    // Device dropdowns should be present
    const selects = page.locator('select.settings-select');
    expect(await selects.count()).toBeGreaterThanOrEqual(2);
  });

  test("debug tab shows diagnostics options", async ({ page }) => {
    await openSettings(page);

    await page.locator('.settings-nav-item:has-text("Debug")').click();
    await page.waitForTimeout(300);

    // Should show debug options
    await expect(page.locator("text=Diagnostics").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Debug Mode").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Export Logs").first()).toBeVisible({ timeout: 3000 });
    // Copy Logs button should be present
    await expect(page.locator('button:has-text("Copy Logs")').first()).toBeVisible({ timeout: 3000 });
  });
});
