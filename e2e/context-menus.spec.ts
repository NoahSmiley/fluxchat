import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  sendMessage,
  waitForMessage,
  rightClickElement,
  whitelistEmailViaAPI,
} from "./helpers";

test.describe("Context Menus", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("Channel context menu", () => {
    test("right-clicking a text channel shows context menu", async ({ page }) => {
      const user = uniqueUser("ctx");
      await registerUser(page, user.email, user.username, user.password);

      const channel = page.locator('.channel-item:has-text("general")').first();
      const menu = await rightClickElement(page, channel);
      await expect(menu).toBeVisible({ timeout: 3000 });

      // Should contain notification and mute options
      await expect(menu.locator('.context-menu-item:has-text("Notification settings")')).toBeVisible();
      await expect(menu.locator('.context-menu-item:has-text("Mute channel")')).toBeVisible();
    });

    test("context menu shows Edit channel for admin", async ({ page }) => {
      const user = uniqueUser("ctxadmin");
      await registerUser(page, user.email, user.username, user.password);

      const channel = page.locator('.channel-item:has-text("general")').first();
      const menu = await rightClickElement(page, channel);
      await expect(menu.locator('.context-menu-item:has-text("Edit channel")')).toBeVisible();
    });

    test("Edit channel opens settings modal", async ({ page }) => {
      const user = uniqueUser("ctxedit");
      await registerUser(page, user.email, user.username, user.password);

      const channel = page.locator('.channel-item:has-text("general")').first();
      const menu = await rightClickElement(page, channel);
      await menu.locator('.context-menu-item:has-text("Edit channel")').click();
      await page.waitForTimeout(500);

      // Channel settings modal should appear
      await expect(page.locator(".modal").first()).toBeVisible({ timeout: 3000 });
    });

    test("Delete channel opens confirm dialog", async ({ page }) => {
      const user = uniqueUser("ctxdel");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "delete-me", "text");

      const channel = page.locator('.channel-item:has-text("delete-me")').first();
      const menu = await rightClickElement(page, channel);
      await menu.locator('.context-menu-item:has-text("Delete channel")').click();
      await page.waitForTimeout(500);

      // Delete confirm dialog should appear
      await expect(page.locator(".modal").first()).toBeVisible({ timeout: 3000 });
    });

    test("context menu closes on Escape", async ({ page }) => {
      const user = uniqueUser("ctxesc");
      await registerUser(page, user.email, user.username, user.password);

      const channel = page.locator('.channel-item:has-text("general")').first();
      const menu = await rightClickElement(page, channel);
      await expect(menu).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.locator(".context-menu")).not.toBeVisible({ timeout: 2000 });
    });

    test("context menu closes on outside click", async ({ page }) => {
      const user = uniqueUser("ctxout");
      await registerUser(page, user.email, user.username, user.password);

      const channel = page.locator('.channel-item:has-text("general")').first();
      const menu = await rightClickElement(page, channel);
      await expect(menu).toBeVisible();

      // Click on the main content area (outside the menu)
      await page.locator(".main-content").first().click({ position: { x: 10, y: 10 } });
      await expect(page.locator(".context-menu")).not.toBeVisible({ timeout: 2000 });
    });
  });

  test.describe("Category context menu", () => {
    test("right-clicking a category shows category items", async ({ page }) => {
      const user = uniqueUser("ctxcat");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "test-category", "category");

      const category = page.locator('.channel-category-toggle:has-text("test-category")').first();
      const menu = await rightClickElement(page, category);
      await expect(menu).toBeVisible({ timeout: 3000 });

      // Category should have Collapse/Expand option
      const collapseOrExpand = menu.locator('.context-menu-item:has-text("Collapse"), .context-menu-item:has-text("Expand")');
      await expect(collapseOrExpand.first()).toBeVisible();
    });

    test("admin sees Create channel in category menu", async ({ page }) => {
      const user = uniqueUser("ctxcatcr");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "cat-create", "category");

      const category = page.locator('.channel-category-toggle:has-text("cat-create")').first();
      const menu = await rightClickElement(page, category);
      await expect(menu.locator('.context-menu-item:has-text("Create channel")')).toBeVisible();
    });
  });

  test.describe("Sidebar background context menu", () => {
    test("right-clicking empty sidebar area shows Create channel", async ({ page }) => {
      const user = uniqueUser("ctxside");
      await registerUser(page, user.email, user.username, user.password);

      // Right-click on the channel-list's empty area (below all channel items)
      const channelList = page.locator(".channel-list").first();
      const box = await channelList.boundingBox();
      if (box) {
        // Click near the bottom of the channel list where there's empty space
        await channelList.click({ button: "right", position: { x: box.width / 2, y: box.height - 5 } });
        await page.waitForTimeout(300);
      }
      const menu = page.locator(".context-menu").first();
      await expect(menu).toBeVisible({ timeout: 3000 });
      await expect(menu.locator('.context-menu-item:has-text("Create channel")')).toBeVisible();
    });
  });

  test.describe("Message context menu", () => {
    test("right-clicking own message shows Edit message", async ({ page }) => {
      const user = uniqueUser("ctxmsg");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `ctx-msg-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msg = page.locator(`.message:has-text("${msgText}")`).first();
      const menu = await rightClickElement(page, msg);
      await expect(menu).toBeVisible({ timeout: 3000 });
      await expect(menu.locator('.context-menu-item:has-text("Edit message")')).toBeVisible();
    });

    test("right-clicking own message shows Copy text", async ({ page }) => {
      const user = uniqueUser("ctxcopy");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `copy-msg-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msg = page.locator(`.message:has-text("${msgText}")`).first();
      const menu = await rightClickElement(page, msg);
      await expect(menu.locator('.context-menu-item:has-text("Copy text")')).toBeVisible();
    });

    test("right-clicking other user's message has no Edit option", async ({ browser }) => {
      const contextA = await browser.newContext();
      const contextB = await browser.newContext();

      try {
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();

        const alice = uniqueUser("ctxAlice");
        const bob = uniqueUser("ctxBob");

        await registerUser(pageA, alice.email, alice.username, alice.password);
        await whitelistEmailViaAPI(pageA, bob.email);
        await registerUser(pageB, bob.email, bob.username, bob.password);

        await selectChannel(pageA, "general");
        await selectChannel(pageB, "general");

        const msgText = `alice-msg-${Date.now()}`;
        await sendMessage(pageA, msgText);
        await waitForMessage(pageB, msgText, 10000);

        // Bob right-clicks Alice's message
        const msg = pageB.locator(`.message:has-text("${msgText}")`).first();
        const menu = await rightClickElement(pageB, msg);
        await expect(menu).toBeVisible({ timeout: 3000 });
        await expect(menu.locator('.context-menu-item:has-text("Edit message")')).not.toBeVisible();
        // But should still have Add reaction and Copy text
        await expect(menu.locator('.context-menu-item:has-text("Add reaction")')).toBeVisible();
        await expect(menu.locator('.context-menu-item:has-text("Copy text")')).toBeVisible();
      } finally {
        await contextA.close();
        await contextB.close();
      }
    });

    test("Add reaction opens emoji picker on message", async ({ page }) => {
      const user = uniqueUser("ctxreact");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `react-msg-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msg = page.locator(`.message:has-text("${msgText}")`).first();
      const menu = await rightClickElement(page, msg);
      await menu.locator('.context-menu-item:has-text("Add reaction")').click();
      await page.waitForTimeout(500);

      await expect(page.locator(".emoji-picker-panel").first()).toBeVisible({ timeout: 3000 });
    });
  });
});
