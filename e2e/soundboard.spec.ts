import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  setLocalStorage,
  getLocalStorage,
  openServerSettings,
} from "./helpers";

test.describe("Soundboard", () => {
  test.describe.configure({ mode: "serial" });

  let email: string, username: string, password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("sboard");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
  });

  test("soundboard panel is not visible on text channels", async ({ page }) => {
    await selectChannel(page, "general");
    await expect(page.locator('.soundboard-panel')).not.toBeVisible({ timeout: 2000 });
  });

  // Voice channels no longer exist as standalone sidebar items — only rooms.
  test.skip("soundboard panel is not visible on voice channel without connection", async ({ page }) => {
    await createChannel(page, "sb-voice", "voice");
    await selectChannel(page, "sb-voice");
    await expect(page.locator('.soundboard-panel')).not.toBeVisible({ timeout: 2000 });
  });

  test("soundboard master volume default is not set in localStorage", async ({ page }) => {
    const val = await getLocalStorage(page, "soundboard-master-volume");
    expect(val).toBeNull();
  });

  test("setting soundboard volume via localStorage persists", async ({ page }) => {
    await setLocalStorage(page, "soundboard-master-volume", "0.5");
    const val = await getLocalStorage(page, "soundboard-master-volume");
    expect(val).toBe("0.5");
  });

  test("server settings has Soundboard tab for admin users", async ({ page }) => {
    await openServerSettings(page);
    await expect(page.locator('.settings-nav-item:has-text("Soundboard")').first()).toBeVisible({ timeout: 5000 });
  });

  test("soundboard tab in server settings shows management area", async ({ page }) => {
    await openServerSettings(page);
    await page.locator('.settings-nav-item:has-text("Soundboard")').click();
    await page.waitForTimeout(500);
    await expect(page.locator('.settings-content-title:has-text("Soundboard"), .settings-card-title:has-text("Soundboard")').first()).toBeVisible({ timeout: 3000 });
  });

  test("soundboard volume survives page reload", async ({ page }) => {
    await setLocalStorage(page, "soundboard-master-volume", "0.75");
    await page.reload();
    await page.locator('.server-sidebar').first().waitFor({ state: "visible", timeout: 15000 });
    const val = await getLocalStorage(page, "soundboard-master-volume");
    expect(val).toBe("0.75");
  });

  test("soundboard volume preserved across channel navigation", async ({ page }) => {
    await setLocalStorage(page, "soundboard-master-volume", "0.3");
    await createChannel(page, "sb-nav-text", "text");
    await selectChannel(page, "sb-nav-text");
    await selectChannel(page, "general");
    const val = await getLocalStorage(page, "soundboard-master-volume");
    expect(val).toBe("0.3");
  });
});
