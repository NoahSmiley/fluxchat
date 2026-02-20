import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  openSettings,
  closeSettings,
  navigateToSettingsTab,
  removeLocalStorage,
} from "./helpers";

test.describe("Audio Settings", () => {
  test.describe.configure({ mode: "serial" });

  let email: string, username: string, password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("audio");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
  });

  test("processing card shows all five toggle labels", async ({ page }) => {
    await expect(page.locator('.settings-row-label:has-text("Noise Cancellation")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-row-label:has-text("Noise Suppression")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-row-label:has-text("Echo Cancellation")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-row-label:has-text("Auto Gain Control")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-row-label:has-text("Silence Detection")').first()).toBeVisible({ timeout: 3000 });
  });

  test("all processing toggles are interactive", async ({ page }) => {
    const processingCard = page.locator('.settings-card:has(.settings-card-title:has-text("Processing"))');
    const toggles = processingCard.locator('[role="switch"]');
    const count = await toggles.count();
    expect(count).toBe(5);

    // Click first toggle and verify state changes
    const firstToggle = toggles.first();
    const initialState = await firstToggle.getAttribute("aria-checked");
    await firstToggle.click();
    await page.waitForTimeout(200);
    const newState = await firstToggle.getAttribute("aria-checked");
    expect(newState).not.toBe(initialState);
  });

  test("noise cancellation toggle can be toggled off and on", async ({ page }) => {
    const toggle = page.locator('.settings-row:has-text("Noise Cancellation") [role="switch"]').first();
    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.waitForTimeout(200);
    expect(await toggle.getAttribute("aria-checked")).not.toBe(initial);
    // Toggle back
    await toggle.click();
    await page.waitForTimeout(200);
    expect(await toggle.getAttribute("aria-checked")).toBe(initial);
  });

  test("noise suppression toggle can be toggled", async ({ page }) => {
    const toggle = page.locator('.settings-row:has-text("Noise Suppression") [role="switch"]').first();
    await expect(toggle).toBeVisible();
    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.waitForTimeout(200);
    expect(await toggle.getAttribute("aria-checked")).not.toBe(initial);
  });

  test("echo cancellation toggle can be toggled", async ({ page }) => {
    const toggle = page.locator('.settings-row:has-text("Echo Cancellation") [role="switch"]').first();
    await expect(toggle).toBeVisible();
    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.waitForTimeout(200);
    expect(await toggle.getAttribute("aria-checked")).not.toBe(initial);
  });

  test("auto gain control toggle can be toggled", async ({ page }) => {
    const toggle = page.locator('.settings-row:has-text("Auto Gain Control") [role="switch"]').first();
    await expect(toggle).toBeVisible();
    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.waitForTimeout(200);
    expect(await toggle.getAttribute("aria-checked")).not.toBe(initial);
  });

  test("silence detection toggle can be toggled", async ({ page }) => {
    const toggle = page.locator('.settings-row:has-text("Silence Detection") [role="switch"]').first();
    await expect(toggle).toBeVisible();
    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.waitForTimeout(200);
    expect(await toggle.getAttribute("aria-checked")).not.toBe(initial);
  });

  test("input sensitivity section is visible", async ({ page }) => {
    await expect(page.locator('.settings-card-title:has-text("Input Sensitivity")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-row-label:has-text("Manual Threshold")').first()).toBeVisible({ timeout: 3000 });
  });

  test("enabling input sensitivity shows threshold slider", async ({ page }) => {
    const toggle = page.locator('.settings-row:has-text("Manual Threshold") [role="switch"]').first();
    const isChecked = await toggle.getAttribute("aria-checked");
    if (isChecked === "false") {
      await toggle.click();
      await page.waitForTimeout(300);
    }
    // Threshold slider row should now be visible
    await expect(page.locator('.settings-slider-header:has-text("Threshold")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-card:has-text("Input Sensitivity") input[type="range"]').first()).toBeVisible({ timeout: 3000 });
  });

  test("audio filters section shows high-pass and low-pass sliders", async ({ page }) => {
    await expect(page.locator('.settings-card-title:has-text("Audio Filters")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-slider-header:has-text("High-Pass Filter")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-slider-header:has-text("Low-Pass Filter")').first()).toBeVisible({ timeout: 3000 });
  });

  test("high-pass filter slider is interactive", async ({ page }) => {
    const slider = page.locator('.settings-card:has-text("Audio Filters") input[type="range"]').first();
    await expect(slider).toBeVisible({ timeout: 3000 });
    // Move slider to a non-zero value
    await slider.fill("500");
    await page.waitForTimeout(200);
    // Value display should show Hz
    await expect(page.locator('.settings-slider-value:has-text("Hz")').first()).toBeVisible({ timeout: 3000 });
  });

  test("lobby music card is absent when not unlocked", async ({ page }) => {
    await removeLocalStorage(page, "flux-lobby-music-unlocked");
    await closeSettings(page);
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
    await expect(page.locator('.settings-card-title:has-text("Lobby Music")')).not.toBeVisible({ timeout: 2000 });
  });
});
