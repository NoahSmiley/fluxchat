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

test.describe("Real-time Multi-user Features", () => {
  test("two users can join the same server", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("rtJoinA");
      const bob = uniqueUser("rtJoinB");

      // Register Alice (first user, auto-creates "FluxChat" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);

      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      // Both users should see the channel sidebar
      await expect(pageA.locator(".channel-sidebar").first()).toBeVisible({ timeout: 10000 });
      await expect(pageB.locator(".channel-sidebar").first()).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("member appears in member list when they join", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("rtMemA");
      const bob = uniqueUser("rtMemB");

      // Register Alice (first user, auto-creates "FluxChat" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);

      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      // Alice's page should eventually show Bob in the sidebar members
      // The server sidebar shows member avatars; we can check the sidebar-members section
      // Wait a moment for WebSocket member_joined event
      await pageA.waitForTimeout(3000);
      await pageA.reload();
      await waitForAppReady(pageA);
      await pageA.waitForTimeout(1000);

      // Check that there's more than one member avatar in the sidebar
      const memberAvatars = pageA.locator(".sidebar-member-avatar");
      const count = await memberAvatars.count();
      expect(count).toBeGreaterThanOrEqual(2);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("real-time message delivery between two users", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("rtMsgA");
      const bob = uniqueUser("rtMsgB");

      // Register Alice (first user, auto-creates "FluxChat" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);
      await createChannel(pageA, "realtime-chat", "text");
      await selectChannel(pageA, "realtime-chat");

      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);
      await selectChannel(pageB, "realtime-chat");

      // Alice sends a message
      const msg = `Realtime test ${Date.now()}`;
      await sendMessage(pageA, msg);

      // Bob should see it in real time
      await waitForMessage(pageB, msg, 10000);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("bidirectional messaging works in real time", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("biA");
      const bob = uniqueUser("biB");

      // Register Alice (first user, auto-creates "FluxChat" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);
      await createChannel(pageA, "bi-chat", "text");
      await selectChannel(pageA, "bi-chat");

      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);
      await selectChannel(pageB, "bi-chat");

      // Rapid back-and-forth
      const msg1 = `Alice says hi ${Date.now()}`;
      await sendMessage(pageA, msg1);
      await waitForMessage(pageB, msg1, 10000);

      const msg2 = `Bob replies ${Date.now()}`;
      await sendMessage(pageB, msg2);
      await waitForMessage(pageA, msg2, 10000);

      const msg3 = `Alice follows up ${Date.now()}`;
      await sendMessage(pageA, msg3);
      await waitForMessage(pageB, msg3, 10000);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("presence indicators show online users", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("presA");
      const bob = uniqueUser("presB");

      // Register Alice (first user, auto-creates "FluxChat" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);

      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      // Wait for presence events
      await pageA.waitForTimeout(3000);

      // Should see online status indicators
      const statusIndicators = pageA.locator(".avatar-status-indicator");
      const count = await statusIndicators.count();
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("WebSocket reconnects and recovers state", async ({ page }) => {
    const user = uniqueUser("wsRecon");
    await registerUser(page, user.email, user.username, user.password);
    // Server "FluxChat" is auto-created; no manual creation needed

    await createChannel(page, "recon-chat", "text");
    await selectChannel(page, "recon-chat");

    // Send a message before disconnection
    const msg1 = `Before disconnect ${Date.now()}`;
    await sendMessage(page, msg1);
    await waitForMessage(page, msg1, 5000);

    // Simulate network disruption by going offline briefly
    await page.context().setOffline(true);
    await page.waitForTimeout(2000);
    await page.context().setOffline(false);
    await page.waitForTimeout(5000);

    // After reconnecting, the page should still be functional
    // Send another message to verify WebSocket is working
    const msg2 = `After reconnect ${Date.now()}`;
    await sendMessage(page, msg2);
    await waitForMessage(page, msg2, 10000);
  });
});
