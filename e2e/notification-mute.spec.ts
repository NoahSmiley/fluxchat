import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  rightClickElement,
} from "./helpers";

test.describe("Notification and Mute Settings", () => {
  test.describe.configure({ mode: "serial" });

  test("Mute channel submenu appears in channel context menu", async ({ page }) => {
    const user = uniqueUser("mute");
    await registerUser(page, user.email, user.username, user.password);

    const channel = page.locator('.channel-item:has-text("general")').first();
    const menu = await rightClickElement(page, channel);

    const muteItem = menu.locator('.context-menu-item:has-text("Mute channel")');
    await expect(muteItem).toBeVisible({ timeout: 3000 });

    // Hover to show submenu
    await muteItem.hover();
    await page.waitForTimeout(300);

    // Submenu should appear with duration options
    const submenu = page.locator(".context-menu").nth(1);
    await expect(submenu).toBeVisible({ timeout: 3000 });
    await expect(submenu.locator('text=15 minutes')).toBeVisible();
    await expect(submenu.locator('text=1 hour')).toBeVisible();
  });

  test("Notification settings submenu shows radio options", async ({ page }) => {
    const user = uniqueUser("notif");
    await registerUser(page, user.email, user.username, user.password);

    const channel = page.locator('.channel-item:has-text("general")').first();
    const menu = await rightClickElement(page, channel);

    const notifItem = menu.locator('.context-menu-item:has-text("Notification settings")');
    await expect(notifItem).toBeVisible({ timeout: 3000 });

    // Hover to show submenu
    await notifItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator(".context-menu").nth(1);
    await expect(submenu).toBeVisible({ timeout: 3000 });
    await expect(submenu.locator('text=All messages')).toBeVisible();
    await expect(submenu.locator('text=Only @mentions')).toBeVisible();
    await expect(submenu.locator('text=Nothing')).toBeVisible();
  });

  test("selecting a notification setting shows checkmark", async ({ page }) => {
    const user = uniqueUser("notifcheck");
    await registerUser(page, user.email, user.username, user.password);

    const channel = page.locator('.channel-item:has-text("general")').first();
    const menu = await rightClickElement(page, channel);

    const notifItem = menu.locator('.context-menu-item:has-text("Notification settings")');
    await notifItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator(".context-menu").nth(1);
    // Click "Only @mentions"
    await submenu.locator('.context-menu-item:has-text("Only @mentions")').click();
    await page.waitForTimeout(500);

    // Re-open and verify checkmark
    const menu2 = await rightClickElement(page, channel);
    const notifItem2 = menu2.locator('.context-menu-item:has-text("Notification settings")');
    await notifItem2.hover();
    await page.waitForTimeout(300);

    const submenu2 = page.locator(".context-menu").nth(1);
    const mentionsOption = submenu2.locator('.context-menu-item:has-text("Only @mentions")');
    await expect(mentionsOption.locator(".context-menu-check.checked")).toBeVisible({ timeout: 3000 });
  });

  test("category mute available in category context menu", async ({ page }) => {
    const user = uniqueUser("catmute");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "mute-cat", "category");

    const category = page.locator('.channel-category-toggle:has-text("mute-cat")').first();
    const menu = await rightClickElement(page, category);

    await expect(menu.locator('.context-menu-item:has-text("Mute category")')).toBeVisible({ timeout: 3000 });
  });

  test("mute submenu shows Mute @mentions checkbox", async ({ page }) => {
    const user = uniqueUser("mutementions");
    await registerUser(page, user.email, user.username, user.password);

    const channel = page.locator('.channel-item:has-text("general")').first();
    const menu = await rightClickElement(page, channel);

    const muteItem = menu.locator('.context-menu-item:has-text("Mute channel")');
    await muteItem.hover();
    await page.waitForTimeout(300);

    const submenu = page.locator(".context-menu").nth(1);
    await expect(submenu.locator('text=Mute @mentions')).toBeVisible({ timeout: 3000 });
  });
});
