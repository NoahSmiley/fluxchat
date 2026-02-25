import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  sendMessage,
  waitForMessage,
  whitelistEmailViaAPI,
  waitForAppReady,
} from "./helpers";

test.describe("Reactions", () => {
  test.describe.configure({ mode: "serial" });

  test("clicking reaction add button on message hover opens emoji picker", async ({ page }) => {
    const user = uniqueUser("react");
    await registerUser(page, user.email, user.username, user.password);

    await selectChannel(page, "general");
    const msgText = `react-test-${Date.now()}`;
    await sendMessage(page, msgText);
    await waitForMessage(page, msgText);

    // Hover to reveal action buttons
    const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
    await msgRow.hover();
    await page.waitForTimeout(200);

    // Click the reaction add button (the + button, not edit or delete)
    const reactionBtn = msgRow.locator(".reaction-add-btn:not(.edit-btn):not(.delete-btn)").first();
    await reactionBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator(".emoji-picker-panel").first()).toBeVisible({ timeout: 3000 });
  });

  test("selecting an emoji adds a reaction chip below the message", async ({ page }) => {
    const user = uniqueUser("reactadd");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "react-chan", "text");
    await selectChannel(page, "react-chan");

    const msgText = `reactchip-${Date.now()}`;
    await sendMessage(page, msgText);
    await waitForMessage(page, msgText);

    const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
    await msgRow.hover();
    await page.waitForTimeout(200);

    // Click reaction add button
    const reactionBtn = msgRow.locator(".reaction-add-btn:not(.edit-btn):not(.delete-btn)").first();
    await reactionBtn.click();
    await page.waitForTimeout(500);

    // Expand a category then click an emoji
    await page.locator('.emoji-picker-panel .emoji-picker-section-header:has-text("SMILEYS")').first().click();
    await page.waitForTimeout(300);
    await page.locator(".emoji-picker-panel .emoji-cell").first().click();
    await page.waitForTimeout(1000);

    // A reaction chip should appear
    const chip = msgRow.locator(".reaction-chip").first();
    await expect(chip).toBeVisible({ timeout: 5000 });
  });

  test("reaction chip shows count of 1", async ({ page }) => {
    const user = uniqueUser("reactcount");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "count-chan", "text");
    await selectChannel(page, "count-chan");

    const msgText = `count-${Date.now()}`;
    await sendMessage(page, msgText);
    await waitForMessage(page, msgText);

    const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
    await msgRow.hover();
    await page.waitForTimeout(200);
    await msgRow.locator(".reaction-add-btn:not(.edit-btn):not(.delete-btn)").first().click();
    await page.waitForTimeout(500);
    // Expand a category then click an emoji
    await page.locator('.emoji-picker-panel .emoji-picker-section-header:has-text("SMILEYS")').first().click();
    await page.waitForTimeout(300);
    await page.locator(".emoji-picker-panel .emoji-cell").first().click();
    await page.waitForTimeout(1000);

    const chip = msgRow.locator(".reaction-chip").first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    // Should show count "1"
    await expect(chip).toContainText("1");
  });

  test("clicking own reaction chip removes it", async ({ page }) => {
    const user = uniqueUser("reactrem");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "remove-chan", "text");
    await selectChannel(page, "remove-chan");

    const msgText = `remove-${Date.now()}`;
    await sendMessage(page, msgText);
    await waitForMessage(page, msgText);

    const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
    await msgRow.hover();
    await page.waitForTimeout(200);
    await msgRow.locator(".reaction-add-btn:not(.edit-btn):not(.delete-btn)").first().click();
    await page.waitForTimeout(500);
    // Expand a category then click an emoji
    await page.locator('.emoji-picker-panel .emoji-picker-section-header:has-text("SMILEYS")').first().click();
    await page.waitForTimeout(300);
    await page.locator(".emoji-picker-panel .emoji-cell").first().click();
    await page.waitForTimeout(1000);

    const chip = msgRow.locator(".reaction-chip").first();
    await expect(chip).toBeVisible({ timeout: 5000 });

    // Click the chip to remove our reaction
    await chip.click();
    await page.waitForTimeout(1000);

    // Chip should disappear
    await expect(msgRow.locator(".reaction-chip")).not.toBeVisible({ timeout: 5000 });
  });

  test("reactions persist after page reload", async ({ page }) => {
    const user = uniqueUser("reactpers");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "persist-react", "text");
    await selectChannel(page, "persist-react");

    const msgText = `persist-react-${Date.now()}`;
    await sendMessage(page, msgText);
    await waitForMessage(page, msgText);

    const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
    await msgRow.hover();
    await page.waitForTimeout(200);
    await msgRow.locator(".reaction-add-btn:not(.edit-btn):not(.delete-btn)").first().click();
    await page.waitForTimeout(500);
    // Expand a category then click an emoji
    await page.locator('.emoji-picker-panel .emoji-picker-section-header:has-text("SMILEYS")').first().click();
    await page.waitForTimeout(300);
    await page.locator(".emoji-picker-panel .emoji-cell").first().click();
    await page.waitForTimeout(1000);

    await expect(msgRow.locator(".reaction-chip").first()).toBeVisible({ timeout: 5000 });

    // Reload
    await page.reload();
    await waitForAppReady(page);
    await selectChannel(page, "persist-react");
    await page.waitForTimeout(1000);

    // Reaction should still be there
    const reloadedRow = page.locator(`.message:has-text("${msgText}")`).first();
    await expect(reloadedRow.locator(".reaction-chip").first()).toBeVisible({ timeout: 5000 });
  });

  test("two users reacting with same emoji shows count 2", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("rAlice");
      const bob = uniqueUser("rBob");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await createChannel(pageA, "duo-react", "text");
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await selectChannel(pageA, "duo-react");
      await selectChannel(pageB, "duo-react");

      const msgText = `duo-react-${Date.now()}`;
      await sendMessage(pageA, msgText);
      await waitForMessage(pageA, msgText);
      await waitForMessage(pageB, msgText, 10000);

      // Alice adds a reaction
      const aliceRow = pageA.locator(`.message:has-text("${msgText}")`).first();
      await aliceRow.hover();
      await pageA.waitForTimeout(200);
      await aliceRow.locator(".reaction-add-btn:not(.edit-btn):not(.delete-btn)").first().click();
      await pageA.waitForTimeout(500);
      await pageA.locator('.emoji-picker-panel .emoji-picker-section-header:has-text("SMILEYS")').first().click();
      await pageA.waitForTimeout(300);
      await pageA.locator(".emoji-picker-panel .emoji-cell").first().click();
      await pageA.waitForTimeout(1000);

      // Bob sees the reaction chip and clicks it to add his reaction
      const bobRow = pageB.locator(`.message:has-text("${msgText}")`).first();
      const bobChip = bobRow.locator(".reaction-chip").first();
      await expect(bobChip).toBeVisible({ timeout: 10000 });
      await bobChip.click();
      await pageB.waitForTimeout(1000);

      // Both should now see count "2"
      await expect(aliceRow.locator(".reaction-chip").first()).toContainText("2", { timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
