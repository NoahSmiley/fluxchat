import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  openServerSettings,
  whitelistEmailViaAPI,
} from "./helpers";

test.describe("Whitelist Management", () => {
  test("first user bypasses whitelist on registration", async ({ page }) => {
    const user = uniqueUser("wlFirst");
    await registerUser(page, user.email, user.username, user.password);

    // First user should successfully register and see the main app
    await expect(page).not.toHaveURL(/login|register/);
    await expect(page.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
  });

  // Skip: SSO-only auth has no register form to test whitelist rejection
  test.skip("non-whitelisted user cannot register", () => {});

  test("add email to whitelist via server settings UI", async ({ page }) => {
    const user = uniqueUser("wlAdmin");
    await registerUser(page, user.email, user.username, user.password);

    // Open server settings (via settings modal > Overview tab)
    await openServerSettings(page);

    // Navigate to Members tab (which contains the whitelist)
    await page.locator('.settings-nav-item:has-text("Members")').click();
    await page.waitForTimeout(500);

    // Type an email into the whitelist input
    const testEmail = `whitelisted_${Date.now()}@test.com`;
    await page.locator('input[type="email"][placeholder*="@"]').fill(testEmail);
    await page.locator('button:has-text("Add")').click();
    await page.waitForTimeout(1000);

    // The email should appear in the whitelist
    await expect(page.locator(`.settings-row-label:has-text("${testEmail}")`).first()).toBeVisible({ timeout: 5000 });
  });

  test("whitelisted user can register successfully", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("wlOk");
      const bob = uniqueUser("wlBobOk");

      // Register Alice (first user, auto-creates "flux" server)
      await registerUser(pageA, alice.email, alice.username, alice.password);

      // Whitelist Bob's email
      await whitelistEmailViaAPI(pageA, bob.email);

      // Bob can now register
      await registerUser(pageB, bob.email, bob.username, bob.password);

      // Bob should be on the main app
      await expect(pageB).not.toHaveURL(/login|register/);
      await expect(pageB.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
