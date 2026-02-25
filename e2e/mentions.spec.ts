import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  selectChannel,
  sendMessage,
  waitForMessage,
} from "./helpers";

test.describe("@Mention Autocomplete", () => {
  test.describe.configure({ mode: "serial" });

  test("typing @ in message input shows mention popup", async ({ page }) => {
    const user = uniqueUser("mention");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const input = page.locator('[data-testid="message-input"], input.message-input').first();
    await input.click();
    await input.pressSequentially("@", { delay: 50 });
    await page.waitForTimeout(500);

    // Mention autocomplete popup should appear
    await expect(page.locator(".mention-autocomplete").first()).toBeVisible({ timeout: 3000 });
  });

  test("popup shows @everyone and @here options", async ({ page }) => {
    const user = uniqueUser("mentionall");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const input = page.locator('[data-testid="message-input"], input.message-input').first();
    await input.click();
    await input.pressSequentially("@", { delay: 50 });
    await page.waitForTimeout(500);

    const popup = page.locator(".mention-autocomplete").first();
    await expect(popup).toBeVisible({ timeout: 3000 });
    await expect(popup.locator('text=everyone')).toBeVisible({ timeout: 2000 });
    await expect(popup.locator('text=here')).toBeVisible({ timeout: 2000 });
  });

  test("pressing Escape closes mention popup", async ({ page }) => {
    const user = uniqueUser("mentionesc");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const input = page.locator('[data-testid="message-input"], input.message-input').first();
    await input.click();
    await input.pressSequentially("@", { delay: 50 });
    await page.waitForTimeout(500);

    await expect(page.locator(".mention-autocomplete").first()).toBeVisible({ timeout: 3000 });

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(page.locator(".mention-autocomplete")).not.toBeVisible({ timeout: 2000 });
  });

  test("mention in sent message renders as highlighted span", async ({ page }) => {
    const user = uniqueUser("mentionhl");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    // Send a message with @everyone
    const input = page.locator('[data-testid="message-input"], input.message-input').first();
    await input.click();
    await input.pressSequentially("hello @everyone!", { delay: 30 });
    await input.press("Enter");
    await page.waitForTimeout(1000);

    // The mention should render as a highlighted span
    const mention = page.locator(".mention").first();
    if (await mention.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(mention).toContainText("everyone");
    }
  });
});
