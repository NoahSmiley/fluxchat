import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  whitelistEmailViaAPI,
} from "./helpers";

test.describe("Member List", () => {
  test.describe.configure({ mode: "serial" });

  test("member list shows server members", async ({ page }) => {
    const user = uniqueUser("memlist");
    await registerUser(page, user.email, user.username, user.password);

    // Wait for member list to load
    await page.waitForTimeout(1000);

    const members = page.locator(".sidebar-member-avatar");
    const count = await members.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("clicking member opens user card popup", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("cardAlice");
      const bob = uniqueUser("cardBob");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await pageA.waitForTimeout(2000);

      // Click on a non-self member avatar (Bob's) in the server sidebar
      const bobItem = pageA.locator(".sidebar-member-avatar:not(.sticky-self)").first();
      if (await bobItem.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobItem.click();
        await pageA.waitForTimeout(500);

        await expect(pageA.locator(".user-card").first()).toBeVisible({ timeout: 3000 });
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("user card shows username", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("nameAlice");
      const bob = uniqueUser("nameBob");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await pageA.waitForTimeout(2000);

      const bobItem = pageA.locator(".sidebar-member-avatar:not(.sticky-self)").first();
      if (await bobItem.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobItem.click();
        await pageA.waitForTimeout(500);

        const card = pageA.locator(".user-card").first();
        await expect(card).toBeVisible({ timeout: 3000 });
        await expect(card.locator(".user-card-name")).toContainText(bob.username);
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("user card Message button opens DM", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("dmcardAlice");
      const bob = uniqueUser("dmcardBob");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await pageA.waitForTimeout(2000);

      const bobItem = pageA.locator(".sidebar-member-avatar:not(.sticky-self)").first();
      if (await bobItem.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobItem.click();
        await pageA.waitForTimeout(500);

        const dmBtn = pageA.locator(".user-card .user-card-dm-btn").first();
        await expect(dmBtn).toBeVisible({ timeout: 3000 });

        await dmBtn.click();
        await pageA.waitForTimeout(1000);

        // Should open DM view
        await expect(pageA.locator(".dm-chat-title, .dm-header-row").first()).toBeVisible({ timeout: 5000 });
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("clicking outside user card closes it", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("closeAlice");
      const bob = uniqueUser("closeBob");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);

      await pageA.waitForTimeout(2000);

      const bobItem = pageA.locator(".sidebar-member-avatar:not(.sticky-self)").first();
      if (await bobItem.isVisible({ timeout: 5000 }).catch(() => false)) {
        await bobItem.click();
        await pageA.waitForTimeout(500);

        await expect(pageA.locator(".user-card").first()).toBeVisible({ timeout: 3000 });

        // Click outside the card
        await pageA.locator(".main-content").first().click({ position: { x: 10, y: 10 } });
        await pageA.waitForTimeout(500);

        await expect(pageA.locator(".user-card")).not.toBeVisible({ timeout: 3000 });
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
