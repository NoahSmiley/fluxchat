import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  rightClickElement,
  waitForAppReady,
} from "./helpers";

test.describe("Channel Management", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("Channel Settings Modal", () => {
    test("open channel settings via context menu", async ({ page }) => {
      const user = uniqueUser("chset");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "settings-chan", "text");

      const channel = page.locator('.channel-item:has-text("settings-chan")').first();
      const menu = await rightClickElement(page, channel);
      await menu.locator('.context-menu-item:has-text("Edit channel")').click();
      await page.waitForTimeout(500);

      await expect(page.locator(".modal").first()).toBeVisible({ timeout: 3000 });
    });

    test("can rename a text channel via settings", async ({ page }) => {
      const user = uniqueUser("chrename");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "rename-me", "text");

      const channel = page.locator('.channel-item:has-text("rename-me")').first();
      const menu = await rightClickElement(page, channel);
      await menu.locator('.context-menu-item:has-text("Edit channel")').click();
      await page.waitForTimeout(500);

      const nameInput = page.locator('.modal input[type="text"]').first();
      await nameInput.clear();
      await nameInput.fill("renamed-channel");

      // Save
      await page.locator('.modal button[type="submit"], .modal button:has-text("Save")').first().click();
      await page.waitForTimeout(1000);

      // Verify sidebar shows new name
      await expect(page.locator('.channel-item:has-text("renamed-channel")').first()).toBeVisible({ timeout: 5000 });
    });

    test("close button dismisses settings modal", async ({ page }) => {
      const user = uniqueUser("chclose");
      await registerUser(page, user.email, user.username, user.password);

      const channel = page.locator('.channel-item:has-text("general")').first();
      const menu = await rightClickElement(page, channel);
      await menu.locator('.context-menu-item:has-text("Edit channel")').click();
      await page.waitForTimeout(500);

      await expect(page.locator(".modal").first()).toBeVisible();

      // Close modal
      await page.locator('.modal-overlay').first().click({ position: { x: 5, y: 5 } });
      await page.waitForTimeout(500);

      await expect(page.locator(".modal")).not.toBeVisible({ timeout: 3000 });
    });
  });

  test.describe("Delete channel flow", () => {
    test("delete from context menu opens confirm dialog", async ({ page }) => {
      const user = uniqueUser("chdel");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "del-chan", "text");

      const channel = page.locator('.channel-item:has-text("del-chan")').first();
      const menu = await rightClickElement(page, channel);
      await menu.locator('.context-menu-item:has-text("Delete channel")').click();
      await page.waitForTimeout(500);

      await expect(page.locator(".modal").first()).toBeVisible({ timeout: 3000 });
    });

    test("confirming delete removes channel from sidebar", async ({ page }) => {
      const user = uniqueUser("chdelconf");
      await registerUser(page, user.email, user.username, user.password);

      const chanName = `bye-${Date.now()}${Math.floor(Math.random() * 1000)}`;
      await createChannel(page, chanName, "text");
      await expect(page.locator(`.channel-item:has-text("${chanName}")`).first()).toBeVisible();

      const channel = page.locator(`.channel-item:has-text("${chanName}")`).first();
      const menu = await rightClickElement(page, channel);
      await menu.locator('.context-menu-item:has-text("Delete channel")').click();
      await page.waitForTimeout(500);

      // Type the channel name to confirm deletion (use pressSequentially for React)
      const confirmInput = page.locator('.delete-confirm-modal input, .modal input[type="text"]').first();
      await confirmInput.click();
      await confirmInput.pressSequentially(chanName, { delay: 20 });
      await page.waitForTimeout(500);

      // Wait for the Delete button to be enabled, then click
      const deleteBtn = page.locator('.modal .btn-danger').first();
      await expect(deleteBtn).toBeEnabled({ timeout: 3000 });
      await deleteBtn.click();
      await page.waitForTimeout(2000);

      // Channel should be gone
      await expect(page.locator(`.channel-item:has-text("${chanName}")`)).not.toBeVisible({ timeout: 10000 });
    });
  });

  test.describe("Category channels", () => {
    test("can create a category channel", async ({ page }) => {
      const user = uniqueUser("catcreate");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "my-category", "category");

      // Category should appear in sidebar
      const category = page.locator('.channel-category-name:has-text("my-category")').first();
      await expect(category).toBeVisible({ timeout: 5000 });
    });

    test("can create text channel inside a category", async ({ page }) => {
      const user = uniqueUser("catchild");
      await registerUser(page, user.email, user.username, user.password);

      const catName = `pcat-${Date.now()}`;
      const childName = `child-${Date.now()}`;
      await createChannel(page, catName, "category");

      // Right-click category → Create channel
      const category = page.locator(`.channel-category-toggle:has-text("${catName}")`).first();
      const menu = await rightClickElement(page, category);
      await menu.locator('.context-menu-item:has-text("Create channel")').click();
      await page.waitForTimeout(500);

      // Fill in the create channel modal
      await page.locator('.modal input[type="text"]').fill(childName);
      await page.locator('.modal button[type="submit"]').click();
      await page.waitForTimeout(1000);

      // Child channel should appear
      await expect(page.locator(`.channel-item:has-text("${childName}")`).first()).toBeVisible({ timeout: 5000 });
    });

    test("collapsing a category toggles chevron and hides children", async ({ page }) => {
      const user = uniqueUser("catcoll");
      await registerUser(page, user.email, user.username, user.password);

      // Use the default "general" channel's parent category or create one
      const catName = `co-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await createChannel(page, catName, "category");
      await page.waitForTimeout(500);

      const category = page.locator(`.channel-category-toggle:has-text("${catName}")`).first();
      await expect(category).toBeVisible({ timeout: 5000 });

      // Verify chevron is in expanded state (has channel-chevron-open class)
      const chevron = category.locator(".channel-chevron").first();
      await expect(chevron).toHaveClass(/channel-chevron-open/, { timeout: 2000 });

      // Collapse by clicking the toggle button
      await category.click();
      await page.waitForTimeout(500);

      // Chevron should lose the open class (collapsed state)
      await expect(chevron).not.toHaveClass(/channel-chevron-open/, { timeout: 3000 });

      // Expand by clicking again
      await category.click();
      await page.waitForTimeout(500);

      // Chevron should have open class again (expanded)
      await expect(chevron).toHaveClass(/channel-chevron-open/, { timeout: 3000 });
    });

    test("Create Channel modal type selector works", async ({ page }) => {
      const user = uniqueUser("chtype");
      await registerUser(page, user.email, user.username, user.password);

      const addBtn = page.locator('button[title="Create Channel"]').first();
      await addBtn.click();
      await page.waitForTimeout(500);

      // Modal should have Text and Category type options
      const textBtn = page.locator('button.channel-type-option:has-text("Text")').first();
      const catBtn = page.locator('button.channel-type-option:has-text("Category")').first();

      await expect(textBtn).toBeVisible();
      await expect(catBtn).toBeVisible();

      // Text should be selected by default
      await expect(textBtn).toHaveClass(/selected/);

      // Click Category and verify it becomes selected
      await catBtn.click();
      await page.waitForTimeout(200);
      await expect(catBtn).toHaveClass(/selected/);

      // Click Text back
      await textBtn.click();
      await page.waitForTimeout(200);
      await expect(textBtn).toHaveClass(/selected/);

      // Close modal
      await page.keyboard.press("Escape");
    });
  });
});
