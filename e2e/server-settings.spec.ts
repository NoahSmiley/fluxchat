import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  openServerSettings,
} from "./helpers";

test.describe("Server Settings Page", () => {
  test.describe.configure({ mode: "serial" });

  test("gear icon opens server settings", async ({ page }) => {
    const user = uniqueUser("srvset");
    await registerUser(page, user.email, user.username, user.password);

    await openServerSettings(page);
    // Server settings page should be visible
    await expect(page.locator(".settings-page").first()).toBeVisible({ timeout: 5000 });
  });

  test("Overview tab shows server name", async ({ page }) => {
    const user = uniqueUser("srvover");
    await registerUser(page, user.email, user.username, user.password);

    await openServerSettings(page);
    // Should show the server name "FluxChat" (auto-created)
    await expect(page.locator('text=FluxChat').first()).toBeVisible({ timeout: 5000 });
  });

  test("can navigate to Members tab", async ({ page }) => {
    const user = uniqueUser("srvmem");
    await registerUser(page, user.email, user.username, user.password);

    await openServerSettings(page);

    const membersTab = page.locator('.settings-nav-item:has-text("Members")').first();
    await membersTab.click();
    await page.waitForTimeout(500);

    // Should show member list (members rendered as .settings-row inside .settings-card)
    await expect(page.locator('.settings-card:has-text("Members") .settings-row .settings-row-label').first()).toBeVisible({ timeout: 5000 });
  });

  test("can navigate to Emojis tab", async ({ page }) => {
    const user = uniqueUser("srvemoji");
    await registerUser(page, user.email, user.username, user.password);

    await openServerSettings(page);

    const emojisTab = page.locator('.settings-nav-item:has-text("Emojis")').first();
    await emojisTab.click();
    await page.waitForTimeout(500);

    // Should show emoji upload area or emoji list
    await expect(page.locator('.emoji-upload-drop').first()).toBeVisible({ timeout: 5000 });
  });

  test("close button returns to main view", async ({ page }) => {
    const user = uniqueUser("srvclose");
    await registerUser(page, user.email, user.username, user.password);

    await openServerSettings(page);
    await expect(page.locator(".settings-page").first()).toBeVisible({ timeout: 5000 });

    // Click close/back button
    const closeBtn = page.locator('.settings-nav-close').first();
    await closeBtn.click();
    await page.waitForTimeout(500);

    // Should return to normal channel sidebar view
    await expect(page.locator(".channel-sidebar").first()).toBeVisible({ timeout: 5000 });
  });

  test("Members tab shows server members", async ({ page }) => {
    const user = uniqueUser("srvmemlist");
    await registerUser(page, user.email, user.username, user.password);

    await openServerSettings(page);

    const membersTab = page.locator('.settings-nav-item:has-text("Members")').first();
    await membersTab.click();
    await page.waitForTimeout(500);

    // At least one member should be listed (the current user)
    // Members are rendered as .settings-row items inside a .settings-card titled "Members"
    const members = page.locator('.settings-card:has-text("Members") .settings-row .settings-row-label');
    const count = await members.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("Whitelist section shows email input", async ({ page }) => {
    const user = uniqueUser("srvwl");
    await registerUser(page, user.email, user.username, user.password);

    await openServerSettings(page);

    // Whitelist is part of the Members tab
    const membersTab = page.locator('.settings-nav-item:has-text("Members")').first();
    await membersTab.click();
    await page.waitForTimeout(500);

    // Should show an email input for whitelisting
    const emailInput = page.locator('input[placeholder*="email" i], input[type="email"]').first();
    await expect(emailInput).toBeVisible({ timeout: 5000 });
  });
});
