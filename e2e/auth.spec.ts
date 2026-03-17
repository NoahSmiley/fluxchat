import { test, expect } from "@playwright/test";
import { uniqueUser, registerUser, loginUser } from "./helpers";

test.describe("Authentication", () => {
  test("register first user and land on main view", async ({ page }) => {
    const user = uniqueUser("first");
    await registerUser(page, user.email, user.username, user.password);

    // Should be on main app view (not login/register)
    await expect(page).not.toHaveURL(/login|register/);
    // The main layout should be visible (has server sidebar)
    await expect(page.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
  });

  // Skip: SSO-only auth has no email/password registration form
  test.skip("sign-up with existing email shows error", () => {});
  test.skip("sign-up with short username shows validation error", () => {});
  test.skip("sign-in with wrong password shows error", () => {});

  test("sign-in with valid credentials", async ({ page }) => {
    const user = uniqueUser("signin");
    await registerUser(page, user.email, user.username, user.password);

    // Clear session
    await page.evaluate(() => {
      localStorage.removeItem("flux-session-token");
    });

    await loginUser(page, user.email, user.password);
    await expect(page).not.toHaveURL(/login|register/);
    await expect(page.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
  });

  test("sign-out returns to login page", async ({ page }) => {
    const user = uniqueUser("signout");
    await registerUser(page, user.email, user.username, user.password);

    // Open settings modal
    await page.locator('button[title="User Settings"]').click();
    await page.waitForTimeout(500);

    // The Profile tab is shown by default and has a "Sign Out" button
    await page.locator('button:has-text("Sign Out")').click();
    await page.waitForTimeout(1000);

    // Should be back on login page (SSO page shows "Sign in with Athion")
    await expect(page.locator('button:has-text("Sign in")').first()).toBeVisible({ timeout: 10000 });
  });

  test("session persists after page reload", async ({ page }) => {
    const user = uniqueUser("persist");
    await registerUser(page, user.email, user.username, user.password);

    await page.reload();
    await page.waitForTimeout(2000);

    // Should still be on main view (not redirected to login)
    await expect(page).not.toHaveURL(/login|register/);
    await expect(page.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
  });
});
