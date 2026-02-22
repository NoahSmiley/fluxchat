import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  openSettings,
  closeSettings,
  navigateToSettingsTab,
  getLocalStorage,
  setLocalStorage,
  removeLocalStorage,
  enterKonamiCode,
} from "./helpers";

test.describe("Audio Settings — Advanced Noise Suppression & Processing", () => {
  test.describe.configure({ mode: "serial" });

  let email: string, username: string, password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("advaudio");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");
  });

  // ── Card 1: AI Noise Suppression ──

  test("AI Noise Suppression card is visible with model dropdown", async ({ page }) => {
    await expect(page.locator('.settings-card-title:has-text("AI Noise Suppression")')).toBeVisible({ timeout: 3000 });
    const dropdown = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
  });

  test("model dropdown has all 6 options", async ({ page }) => {
    const dropdown = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    const options = dropdown.locator("option");
    await expect(options).toHaveCount(6);

    // Verify option values
    const values = await options.evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
    expect(values).toEqual(["off", "speex", "rnnoise", "dtln", "deepfilter", "nsnet2"]);
  });

  test("model dropdown defaults to dtln", async ({ page }) => {
    const dropdown = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    expect(await dropdown.inputValue()).toBe("dtln");
  });

  test("selecting a model shows model info text", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    // dtln is default — info should be visible
    await expect(card.locator(".settings-model-info")).toBeVisible({ timeout: 3000 });
    await expect(card.locator(".settings-model-info")).toContainText("Dual-signal transformer");
  });

  test("selecting off hides model info and suppression strength", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    const dropdown = card.locator("select.settings-select");

    await dropdown.selectOption("off");
    await page.waitForTimeout(300);

    await expect(card.locator(".settings-model-info")).not.toBeVisible();
    await expect(card.locator('.settings-slider-header:has-text("Suppression Strength")')).not.toBeVisible();
  });

  test("model info text changes per model", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    const dropdown = card.locator("select.settings-select");
    const info = card.locator(".settings-model-info");

    await dropdown.selectOption("speex");
    await page.waitForTimeout(200);
    await expect(info).toContainText("DSP-based");

    await dropdown.selectOption("rnnoise");
    await page.waitForTimeout(200);
    await expect(info).toContainText("Recurrent neural network");

    await dropdown.selectOption("deepfilter");
    await page.waitForTimeout(200);
    await expect(info).toContainText("Deep neural network");

    await dropdown.selectOption("nsnet2");
    await page.waitForTimeout(200);
    await expect(info).toContainText("FluxAI");
  });

  test("suppression strength slider is visible when model is not off", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    await expect(card.locator('.settings-slider-header:has-text("Suppression Strength")')).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.settings-slider-value:has-text("%")')).toBeVisible();
  });

  test("suppression strength slider is interactive", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    const slider = card.locator('input[type="range"]').first();
    await slider.fill("50");
    await page.waitForTimeout(200);
    await expect(card.locator('.settings-slider-value:has-text("50%")')).toBeVisible();
  });

  test("VAD threshold slider only visible for RNNoise model", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    const dropdown = card.locator("select.settings-select");

    // Default (dtln) — VAD slider should not be visible
    await expect(card.locator('.settings-slider-header:has-text("VAD Threshold")')).not.toBeVisible();

    // Switch to rnnoise — VAD slider should appear
    await dropdown.selectOption("rnnoise");
    await page.waitForTimeout(300);
    await expect(card.locator('.settings-slider-header:has-text("VAD Threshold")')).toBeVisible({ timeout: 3000 });

    // Switch to speex — VAD slider should disappear
    await dropdown.selectOption("speex");
    await page.waitForTimeout(300);
    await expect(card.locator('.settings-slider-header:has-text("VAD Threshold")')).not.toBeVisible();
  });

  test("VAD threshold slider is interactive", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    const dropdown = card.locator("select.settings-select");

    await dropdown.selectOption("rnnoise");
    await page.waitForTimeout(300);

    const vadSlider = card.locator('.settings-slider-row:has(.settings-slider-header:has-text("VAD Threshold")) input[type="range"]');
    await vadSlider.fill("60");
    await page.waitForTimeout(200);
    await expect(card.locator('.settings-slider-value:has-text("60%")')).toBeVisible();
  });

  // ── Card 2: Microphone ──

  test("Microphone card shows mic input gain slider", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Microphone"))');
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.settings-slider-header:has-text("Mic Input Gain")')).toBeVisible();
  });

  test("mic input gain slider is interactive (0-200%)", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Microphone"))');
    const slider = card.locator('.settings-slider-row:has(.settings-slider-header:has-text("Mic Input Gain")) input[type="range"]');
    await slider.fill("150");
    await page.waitForTimeout(200);
    await expect(card.locator('.settings-slider-value:has-text("150%")')).toBeVisible();
  });

  test("noise gate toggle and conditional settings", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Microphone"))');
    const gateToggle = card.locator('.settings-row:has-text("Noise Gate") [role="switch"]');
    await expect(gateToggle).toBeVisible();

    // Default is off — hold time should not be visible
    await expect(card.locator('.settings-slider-header:has-text("Hold Time")')).not.toBeVisible();

    // Enable noise gate
    await gateToggle.click();
    await page.waitForTimeout(300);

    // Threshold and hold time should now be visible
    await expect(card.locator('.settings-slider-header:has-text("Threshold")')).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.settings-slider-header:has-text("Hold Time")')).toBeVisible({ timeout: 3000 });
  });

  test("noise gate hold time slider is interactive", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Microphone"))');
    const gateToggle = card.locator('.settings-row:has-text("Noise Gate") [role="switch"]');

    // Enable noise gate first
    const isChecked = await gateToggle.getAttribute("aria-checked");
    if (isChecked === "false") {
      await gateToggle.click();
      await page.waitForTimeout(300);
    }

    const holdSlider = card.locator('.settings-slider-row:has(.settings-slider-header:has-text("Hold Time")) input[type="range"]');
    await holdSlider.fill("500");
    await page.waitForTimeout(200);
    await expect(card.locator('.settings-slider-value:has-text("500ms")')).toBeVisible();
  });

  // ── Card 3: Processing ──

  test("Processing card shows all toggle labels", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Processing"))');
    await expect(card.locator('.settings-row-label:has-text("Echo Cancellation")')).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.settings-row-label:has-text("Auto Gain Control")')).toBeVisible();
    await expect(card.locator('.settings-row-label:has-text("Browser Noise Suppression")')).toBeVisible();
    await expect(card.locator('.settings-row-label:has-text("Silence Detection")')).toBeVisible();
    await expect(card.locator('.settings-row-label:has-text("Compressor")')).toBeVisible();
  });

  test("compressor toggle reveals sub-settings", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Processing"))');
    const compToggle = card.locator('.settings-row:has-text("Compressor") [role="switch"]');

    // Default off — sub-settings hidden
    await expect(card.locator('.settings-slider-header:has-text("Ratio")')).not.toBeVisible();

    // Enable compressor
    await compToggle.click();
    await page.waitForTimeout(300);

    // Compressor sub-settings should appear
    await expect(card.locator('.settings-slider-header:has-text("Threshold")')).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.settings-slider-header:has-text("Ratio")')).toBeVisible();
    await expect(card.locator('.settings-slider-header:has-text("Attack")')).toBeVisible();
    await expect(card.locator('.settings-slider-header:has-text("Release")')).toBeVisible();
  });

  test("compressor threshold slider displays dB units", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Processing"))');
    const compToggle = card.locator('.settings-row:has-text("Compressor") [role="switch"]');

    await compToggle.click();
    await page.waitForTimeout(300);

    await expect(card.locator('.settings-slider-value:has-text("dB")')).toBeVisible({ timeout: 3000 });
  });

  test("compressor ratio slider displays :1 format", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Processing"))');
    const compToggle = card.locator('.settings-row:has-text("Compressor") [role="switch"]');

    await compToggle.click();
    await page.waitForTimeout(300);

    await expect(card.locator('.settings-slider-value:has-text(":1")')).toBeVisible({ timeout: 3000 });
  });

  // ── Card 4: Audio Filters ──

  test("Audio Filters card shows de-esser toggle", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Audio Filters"))');
    await expect(card.locator('.settings-row-label:has-text("De-esser")')).toBeVisible({ timeout: 3000 });
  });

  test("de-esser toggle reveals strength slider", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Audio Filters"))');
    const deEsserToggle = card.locator('.settings-row:has-text("De-esser") [role="switch"]');

    // Default off — strength slider hidden
    await expect(card.locator('.settings-slider-header:has-text("De-esser Strength")')).not.toBeVisible();

    // Enable de-esser
    await deEsserToggle.click();
    await page.waitForTimeout(300);

    // Strength slider should appear
    await expect(card.locator('.settings-slider-header:has-text("De-esser Strength")')).toBeVisible({ timeout: 3000 });
  });

  test("de-esser strength slider is interactive", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Audio Filters"))');
    const deEsserToggle = card.locator('.settings-row:has-text("De-esser") [role="switch"]');

    await deEsserToggle.click();
    await page.waitForTimeout(300);

    const strengthSlider = card.locator('.settings-slider-row:has(.settings-slider-header:has-text("De-esser Strength")) input[type="range"]');
    await strengthSlider.fill("75");
    await page.waitForTimeout(200);
    await expect(card.locator('.settings-slider-value:has-text("75%")')).toBeVisible();
  });

  // ── Card 5: Lobby Music ──

  test("Lobby Music card shows volume slider", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music"))');
    await expect(card).toBeVisible({ timeout: 3000 });
    await expect(card.locator('.settings-slider-header:has-text("Volume")')).toBeVisible();
  });

  test("lobby music toggle is interactive", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Lobby Music"))');
    const toggle = card.locator('[role="switch"]').first();
    await expect(toggle).toBeVisible();
    const initial = await toggle.getAttribute("aria-checked");
    await toggle.click();
    await page.waitForTimeout(200);
    expect(await toggle.getAttribute("aria-checked")).not.toBe(initial);
  });

  // ── Settings Persistence ──

  test("model selection persists to localStorage", async ({ page }) => {
    const dropdown = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    await dropdown.selectOption("rnnoise");
    await page.waitForTimeout(300);

    const stored = await getLocalStorage(page, "flux-audio-settings");
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.noiseSuppressionModel).toBe("rnnoise");
  });

  test("suppression strength persists to localStorage", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');
    const slider = card.locator('.settings-slider-row:has(.settings-slider-header:has-text("Suppression Strength")) input[type="range"]');
    await slider.fill("42");
    await page.waitForTimeout(300);

    const stored = await getLocalStorage(page, "flux-audio-settings");
    const parsed = JSON.parse(stored!);
    expect(parsed.suppressionStrength).toBe(42);
  });

  test("settings persist across page reload", async ({ page }) => {
    // Set a non-default model
    const dropdown = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    await dropdown.selectOption("speex");
    await page.waitForTimeout(300);

    // Reload and check
    await closeSettings(page);
    await page.reload();
    await page.locator(".server-sidebar").first().waitFor({ state: "visible", timeout: 15000 });
    await openSettings(page);
    await navigateToSettingsTab(page, "Voice");

    const dropdown2 = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    await expect(dropdown2).toBeVisible({ timeout: 5000 });
    expect(await dropdown2.inputValue()).toBe("speex");
  });

  test("compressor settings persist to localStorage", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Processing"))');
    const compToggle = card.locator('.settings-row:has-text("Compressor") [role="switch"]');
    await compToggle.click();
    await page.waitForTimeout(300);

    const stored = await getLocalStorage(page, "flux-audio-settings");
    const parsed = JSON.parse(stored!);
    expect(parsed.compressorEnabled).toBe(true);
  });

  test("de-esser settings persist to localStorage", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Audio Filters"))');
    const deEsserToggle = card.locator('.settings-row:has-text("De-esser") [role="switch"]');
    await deEsserToggle.click();
    await page.waitForTimeout(300);

    const stored = await getLocalStorage(page, "flux-audio-settings");
    const parsed = JSON.parse(stored!);
    expect(parsed.deEsserEnabled).toBe(true);
  });

  // ── Rapid Model Switching ──

  test("rapid model switching does not crash", async ({ page }) => {
    const dropdown = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    const models = ["speex", "rnnoise", "dtln", "deepfilter", "nsnet2", "off", "dtln"];

    for (const model of models) {
      await dropdown.selectOption(model);
      await page.waitForTimeout(100);
    }

    // App should still be responsive
    await expect(dropdown).toBeVisible();
    expect(await dropdown.inputValue()).toBe("dtln");
  });

  // ── All 5 Cards Visible ──

  test("all 5 voice settings cards are visible", async ({ page }) => {
    await expect(page.locator('.settings-card-title:has-text("AI Noise Suppression")')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.settings-card-title:has-text("Microphone")')).toBeVisible();
    await expect(page.locator('.settings-card-title:has-text("Processing")')).toBeVisible();
    await expect(page.locator('.settings-card-title:has-text("Audio Filters")')).toBeVisible();
    await expect(page.locator('.settings-card-title:has-text("Lobby Music")')).toBeVisible();
  });

  // ── Model Cycle Through All Options ──

  test("can cycle through all noise suppression models", async ({ page }) => {
    const dropdown = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression")) select.settings-select');
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("AI Noise Suppression"))');

    const models = [
      { value: "off", hasInfo: false, hasStrength: false, hasVad: false },
      { value: "speex", hasInfo: true, hasStrength: true, hasVad: false },
      { value: "rnnoise", hasInfo: true, hasStrength: true, hasVad: true },
      { value: "dtln", hasInfo: true, hasStrength: true, hasVad: false },
      { value: "deepfilter", hasInfo: true, hasStrength: true, hasVad: false },
      { value: "nsnet2", hasInfo: true, hasStrength: true, hasVad: false },
    ];

    for (const model of models) {
      await dropdown.selectOption(model.value);
      await page.waitForTimeout(300);

      expect(await dropdown.inputValue()).toBe(model.value);

      if (model.hasInfo) {
        await expect(card.locator(".settings-model-info")).toBeVisible();
      } else {
        await expect(card.locator(".settings-model-info")).not.toBeVisible();
      }

      if (model.hasStrength) {
        await expect(card.locator('.settings-slider-header:has-text("Suppression Strength")')).toBeVisible();
      } else {
        await expect(card.locator('.settings-slider-header:has-text("Suppression Strength")')).not.toBeVisible();
      }

      if (model.hasVad) {
        await expect(card.locator('.settings-slider-header:has-text("VAD Threshold")')).toBeVisible();
      } else {
        await expect(card.locator('.settings-slider-header:has-text("VAD Threshold")')).not.toBeVisible();
      }
    }
  });

  // ── Mic Gain Boundary Values ──

  test("mic input gain can be set to 0% and 200%", async ({ page }) => {
    const card = page.locator('.settings-card:has(.settings-card-title:has-text("Microphone"))');
    const slider = card.locator('.settings-slider-row:has(.settings-slider-header:has-text("Mic Input Gain")) input[type="range"]');

    await slider.fill("0");
    await page.waitForTimeout(200);
    await expect(card.locator('.settings-slider-value:has-text("0%")')).toBeVisible();

    await slider.fill("200");
    await page.waitForTimeout(200);
    await expect(card.locator('.settings-slider-value:has-text("200%")')).toBeVisible();
  });
});
