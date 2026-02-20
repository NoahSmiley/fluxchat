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

  test("sign-up with existing email shows error", async ({ page }) => {
    const user = uniqueUser("dup");
    await registerUser(page, user.email, user.username, user.password);

    // Clear session and navigate to register page
    await page.evaluate(() => {
      localStorage.removeItem("flux-session-token");
    });
    await page.goto("/register", { waitUntil: "networkidle" });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="text"]').fill("othername123");
    await page.locator('input[type="password"]').fill(user.password);
    await page.locator('button[type="submit"]').click();

    // Should see an error message in the auth-error div
    await expect(page.locator(".auth-error").first()).toBeVisible({ timeout: 5000 });
  });

  test("sign-up with short username shows validation error", async ({ page }) => {
    await page.goto("/register");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    await page.locator('input[type="email"]').fill("short@test.com");
    await page.locator('input[type="text"]').fill("a");
    await page.locator('input[type="password"]').fill("TestPass123!");
    await page.locator('button[type="submit"]').click();

    // Validation error should appear (the RegisterPage shows validationError in auth-error div)
    await expect(page.locator(".auth-error").first()).toBeVisible({ timeout: 5000 });
  });

  test("sign-in with valid credentials", async ({ page }) => {
    const user = uniqueUser("signin");
    await registerUser(page, user.email, user.username, user.password);

    // Clear session
    await page.evaluate(() => {
      localStorage.removeItem("flux-session-token");
    });
    await page.goto("/login");

    await loginUser(page, user.email, user.password);
    await expect(page).not.toHaveURL(/login|register/);
    await expect(page.locator(".server-sidebar").first()).toBeVisible({ timeout: 10000 });
  });

  test("sign-in with wrong password shows error", async ({ page }) => {
    const user = uniqueUser("wrongpw");
    await registerUser(page, user.email, user.username, user.password);

    // Clear session
    await page.evaluate(() => {
      localStorage.removeItem("flux-session-token");
    });
    await page.goto("/login");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill("wrongpassword");
    await page.locator('button[type="submit"]').click();

    // Should see an error message
    await expect(page.locator(".auth-error").first()).toBeVisible({ timeout: 5000 });
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

    // Should be back on login page
    await expect(page.locator('input[type="email"]').first()).toBeVisible({ timeout: 10000 });
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
