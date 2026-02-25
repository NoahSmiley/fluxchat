import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  selectChannel,
} from "./helpers";

test.describe("Emoji Picker", () => {
  test.describe.configure({ mode: "serial" });

  test("clicking smile icon in message input opens picker", async ({ page }) => {
    const user = uniqueUser("emoji");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    // Click the emoji button (smile icon) next to the message input
    const emojiTrigger = page.locator('button[title="Emoji"]');
    await emojiTrigger.click();
    await page.waitForTimeout(500);

    await expect(page.locator(".emoji-picker-panel").first()).toBeVisible({ timeout: 5000 });
  });

  test("emoji picker shows category tabs", async ({ page }) => {
    const user = uniqueUser("emojitab");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const emojiTrigger = page.locator('button[title="Emoji"]');
    await emojiTrigger.click();
    await page.waitForTimeout(500);

    // Should show category navigation tabs
    const panel = page.locator(".emoji-picker-panel").first();
    await expect(panel).toBeVisible({ timeout: 5000 });
    const tabs = panel.locator(".emoji-picker-category-nav .emoji-category-nav-btn");
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("clicking an emoji inserts into message input", async ({ page }) => {
    const user = uniqueUser("emojiins");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const emojiTrigger = page.locator('button[title="Emoji"]');
    await emojiTrigger.click();
    await page.waitForTimeout(500);

    // Categories are collapsed by default; expand the first standard category
    const panel = page.locator(".emoji-picker-panel").first();
    await expect(panel).toBeVisible({ timeout: 5000 });
    const sectionHeaders = panel.locator(".emoji-picker-section-header");
    // The first header is Favorites, the second is the first standard category
    await sectionHeaders.nth(1).click();
    await page.waitForTimeout(300);

    // Click any emoji cell in the picker
    const emojiBtn = panel.locator(".emoji-cell").first();
    await emojiBtn.click();
    await page.waitForTimeout(500);

    // Message input should contain something (the emoji)
    const input = page.locator('[data-testid="message-input"]');
    const content = await input.textContent() ?? "";
    expect(content.length).toBeGreaterThan(0);
  });

  test("picker closes after selecting an emoji", async ({ page }) => {
    const user = uniqueUser("emojiclose");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const emojiTrigger = page.locator('button[title="Emoji"]');
    await emojiTrigger.click();
    await page.waitForTimeout(500);
    const panel = page.locator(".emoji-picker-panel").first();
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Categories are collapsed by default; expand the first standard category
    const sectionHeaders = panel.locator(".emoji-picker-section-header");
    await sectionHeaders.nth(1).click();
    await page.waitForTimeout(300);

    const emojiBtn = panel.locator(".emoji-cell").first();
    await emojiBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator(".emoji-picker-panel")).not.toBeVisible({ timeout: 3000 });
  });

  test("search input filters emojis", async ({ page }) => {
    const user = uniqueUser("emojisearch");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const emojiTrigger = page.locator('button[title="Emoji"]');
    await emojiTrigger.click();
    await page.waitForTimeout(500);

    const searchInput = page.locator('.emoji-picker-panel input[placeholder="Search emoji..."]');
    await searchInput.fill("smile");
    await page.waitForTimeout(500);

    // Should show search results (emoji cells from the search results grid)
    const results = page.locator(".emoji-picker-panel .emoji-cell");
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("clicking outside picker closes it", async ({ page }) => {
    const user = uniqueUser("emojiout");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const emojiTrigger = page.locator('button[title="Emoji"]');
    await emojiTrigger.click();
    await page.waitForTimeout(500);
    await expect(page.locator(".emoji-picker-panel").first()).toBeVisible({ timeout: 5000 });

    // Click outside the picker
    await page.locator(".main-content").first().click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(500);

    await expect(page.locator(".emoji-picker-panel")).not.toBeVisible({ timeout: 3000 });
  });

  test("Escape key closes picker", async ({ page }) => {
    const user = uniqueUser("emojiesc");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const emojiTrigger = page.locator('button[title="Emoji"]');
    await emojiTrigger.click();
    await page.waitForTimeout(500);
    await expect(page.locator(".emoji-picker-panel").first()).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    await expect(page.locator(".emoji-picker-panel")).not.toBeVisible({ timeout: 3000 });
  });
});
