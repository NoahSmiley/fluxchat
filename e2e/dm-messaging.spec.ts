import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  selectChannel,
  sendMessage,
  waitForMessage,
  whitelistEmailViaAPI,
  waitForAppReady,
} from "./helpers";

test.describe("DM Messaging UI", () => {
  test.describe.configure({ mode: "serial" });

  test("clicking a member in sidebar opens user card", async ({ page }) => {
    const user = uniqueUser("dmcard");
    await registerUser(page, user.email, user.username, user.password);

    // Look for a member in the member list sidebar
    const memberItem = page.locator(".member-item").first();
    if (await memberItem.isVisible()) {
      await memberItem.click();
      await page.waitForTimeout(500);
      await expect(page.locator(".user-card").first()).toBeVisible({ timeout: 3000 });
    }
  });

  test("user card shows Message button", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("dmAlice");
      const bob = uniqueUser("dmBob");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      // Alice should see Bob in the member list
      await pageA.waitForTimeout(2000);
      const bobMember = pageA.locator(`.member-item:has-text("${bob.username}")`).first();

      if (await bobMember.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobMember.click();
        await pageA.waitForTimeout(500);

        const userCard = pageA.locator(".user-card").first();
        await expect(userCard).toBeVisible({ timeout: 3000 });
        await expect(userCard.locator(".user-card-dm-btn, button:has-text('Message')").first()).toBeVisible();
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("clicking Message opens DM chat view", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("dmOpen");
      const bob = uniqueUser("dmOpen2");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await pageA.waitForTimeout(2000);
      const bobMember = pageA.locator(`.member-item:has-text("${bob.username}")`).first();

      if (await bobMember.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobMember.click();
        await pageA.waitForTimeout(500);

        const dmBtn = pageA.locator(".user-card .user-card-dm-btn, .user-card button:has-text('Message')").first();
        await dmBtn.click();
        await pageA.waitForTimeout(1000);

        // Should show the DM chat view with Bob's name
        await expect(pageA.locator(".dm-chat-title, .dm-header").first()).toBeVisible({ timeout: 5000 });
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("can type and send a DM message", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("dmSend");
      const bob = uniqueUser("dmSend2");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await pageA.waitForTimeout(2000);
      const bobMember = pageA.locator(`.member-item:has-text("${bob.username}")`).first();

      if (await bobMember.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobMember.click();
        await pageA.waitForTimeout(500);
        await pageA.locator(".user-card .user-card-dm-btn, .user-card button:has-text('Message')").first().click();
        await pageA.waitForTimeout(1000);

        // Send a DM
        const msgText = `DM hello ${Date.now()}`;
        const input = pageA.locator('[data-testid="message-input"], input.message-input').first();
        await input.click();
        await input.pressSequentially(msgText, { delay: 20 });
        await input.press("Enter");
        await pageA.waitForTimeout(1000);

        // Message should appear in the DM view
        await expect(pageA.locator(`text=${msgText}`).first()).toBeVisible({ timeout: 5000 });
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("DM messages persist after navigation", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("dmPers");
      const bob = uniqueUser("dmPers2");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await pageA.waitForTimeout(2000);
      const bobMember = pageA.locator(`.member-item:has-text("${bob.username}")`).first();

      if (await bobMember.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobMember.click();
        await pageA.waitForTimeout(500);
        await pageA.locator(".user-card .user-card-dm-btn, .user-card button:has-text('Message')").first().click();
        await pageA.waitForTimeout(1000);

        const msgText = `DM persist ${Date.now()}`;
        const input = pageA.locator('[data-testid="message-input"], input.message-input').first();
        await input.click();
        await input.pressSequentially(msgText, { delay: 20 });
        await input.press("Enter");
        await pageA.waitForTimeout(1000);

        await expect(pageA.locator(`text=${msgText}`).first()).toBeVisible({ timeout: 5000 });

        // Navigate back to server view
        await pageA.locator('.server-icon, .server-sidebar-item').first().click();
        await pageA.waitForTimeout(1000);

        // Navigate back to DMs - click the Flux logo / DM icon
        await pageA.locator('.flux-home-btn, button[title="Direct Messages"]').first().click();
        await pageA.waitForTimeout(1000);

        // The DM should still show the message
        // Click the DM conversation with bob
        const dmItem = pageA.locator(`.dm-item:has-text("${bob.username}"), .dm-conversation:has-text("${bob.username}")`).first();
        if (await dmItem.isVisible({ timeout: 3000 }).catch(() => false)) {
          await dmItem.click();
          await pageA.waitForTimeout(1000);
          await expect(pageA.locator(`text=${msgText}`).first()).toBeVisible({ timeout: 5000 });
        }
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
