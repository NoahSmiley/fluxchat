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

test.describe("Messaging", () => {
  test.describe.configure({ mode: "serial" });

  test("send a message and see it appear", async ({ page }) => {
    const user = uniqueUser("msg");
    await registerUser(page, user.email, user.username, user.password);

    // The "general" text channel is auto-created; select it
    await selectChannel(page, "general");

    const messageText = `Hello E2E ${Date.now()}`;
    await sendMessage(page, messageText);
    await waitForMessage(page, messageText, 5000);
  });

  test("message appears in the message list area", async ({ page }) => {
    const user = uniqueUser("msglist");
    await registerUser(page, user.email, user.username, user.password);

    await selectChannel(page, "general");

    const messageText = `Msg list test ${Date.now()}`;
    await sendMessage(page, messageText);

    // Verify the message is in the main content area
    await expect(page.locator(`.main-content:has-text("${messageText}")`).first()).toBeVisible({ timeout: 5000 });
  });

  test("send multiple messages in sequence", async ({ page }) => {
    const user = uniqueUser("multi");
    await registerUser(page, user.email, user.username, user.password);

    await selectChannel(page, "general");

    const messages = [
      `First message ${Date.now()}`,
      `Second message ${Date.now()}`,
      `Third message ${Date.now()}`,
    ];

    for (const msg of messages) {
      await sendMessage(page, msg);
    }

    for (const msg of messages) {
      await waitForMessage(page, msg, 5000);
    }
  });

  test("message input clears after sending", async ({ page }) => {
    const user = uniqueUser("clear");
    await registerUser(page, user.email, user.username, user.password);

    await selectChannel(page, "general");

    const input = page.locator(
      'input[placeholder*="message" i], textarea[placeholder*="message" i]',
    ).first();
    await input.fill("Test message");
    await input.press("Enter");
    await page.waitForTimeout(500);

    // Input should be empty after sending
    await expect(input).toHaveValue("", { timeout: 3000 });
  });

  test("empty message is not sent", async ({ page }) => {
    const user = uniqueUser("empty");
    await registerUser(page, user.email, user.username, user.password);

    // Create a fresh channel with no prior messages
    await createChannel(page, "empty-test", "text");
    await selectChannel(page, "empty-test");

    const input = page.locator(
      'input[placeholder*="message" i], textarea[placeholder*="message" i]',
    ).first();

    // Count existing messages before pressing enter
    const countBefore = await page.locator('.message, [class*="message-row"]').count();

    // Press enter on empty input
    await input.press("Enter");
    await page.waitForTimeout(500);

    // No new messages should appear
    const countAfter = await page.locator('.message, [class*="message-row"]').count();
    expect(countAfter).toBe(countBefore);
  });

  test("real-time: two users see each other's messages", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("rtAlice");
      const bob = uniqueUser("rtBob");

      // Register Alice (first user bypasses whitelist, auto-creates "FluxChat" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);

      // Create a channel and select it
      await createChannel(pageA, "rt-chat", "text");
      await selectChannel(pageA, "rt-chat");

      // Alice whitelists Bob
      await whitelistEmailViaAPI(pageA, bob.email);

      // Register Bob and navigate to the same channel
      await registerUser(pageB, bob.email, bob.username, bob.password);
      await selectChannel(pageB, "rt-chat");

      // Alice sends a message
      const aliceMsg = `Hello from Alice ${Date.now()}`;
      await sendMessage(pageA, aliceMsg);

      // Bob should see it
      await waitForMessage(pageB, aliceMsg, 10000);

      // Bob sends a reply
      const bobMsg = `Hello from Bob ${Date.now()}`;
      await sendMessage(pageB, bobMsg);

      // Alice should see it
      await waitForMessage(pageA, bobMsg, 10000);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("messages persist after page reload", async ({ page }) => {
    const user = uniqueUser("persist");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "persist-chat", "text");
    await selectChannel(page, "persist-chat");

    const messageText = `Persistent ${Date.now()}`;
    await sendMessage(page, messageText);
    await waitForMessage(page, messageText, 5000);

    // Reload and check message is still there
    await page.reload();
    await waitForAppReady(page);
    await page.waitForTimeout(1000);
    await selectChannel(page, "persist-chat");
    await waitForMessage(page, messageText, 10000);
  });

  test("switching channels shows correct messages", async ({ page }) => {
    const user = uniqueUser("switch");
    await registerUser(page, user.email, user.username, user.password);

    // Create two channels
    await createChannel(page, "channel-a", "text");
    await createChannel(page, "channel-b", "text");

    // Send message in channel-a
    await selectChannel(page, "channel-a");
    const msgA = `Channel A ${Date.now()}`;
    await sendMessage(page, msgA);
    await waitForMessage(page, msgA, 5000);

    // Send message in channel-b
    await selectChannel(page, "channel-b");
    const msgB = `Channel B ${Date.now()}`;
    await sendMessage(page, msgB);
    await waitForMessage(page, msgB, 5000);

    // Switch back to channel-a and verify its message is shown
    await selectChannel(page, "channel-a");
    await page.waitForTimeout(1000);
    await waitForMessage(page, msgA, 5000);
  });
});
