import { test, expect } from "@playwright/test";
import { uniqueUser, registerUser, openSettings, closeSettings } from "./helpers";

test.describe("User Profile", () => {
  let email: string;
  let username: string;
  let password: string;

  test.beforeEach(async ({ page }) => {
    const user = uniqueUser("prof");
    email = user.email;
    username = user.username;
    password = user.password;
    await registerUser(page, email, username, password);
    // Server "flux" is auto-created on first user registration; no manual creation needed
  });

  test("settings modal opens and shows Profile tab by default", async ({ page }) => {
    await openSettings(page);

    // The settings page should be visible with Profile as the active tab
    await expect(page.locator(".settings-page").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.settings-nav-item.active:has-text("Profile")').first()).toBeVisible({ timeout: 3000 });
    // Should show username, email, avatar sections
    await expect(page.locator("text=Avatar").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Username").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=Email").first()).toBeVisible({ timeout: 3000 });
  });

  test("current username is displayed in profile settings", async ({ page }) => {
    await openSettings(page);

    // The username should be shown in the Username card
    await expect(page.locator(`.settings-row-label:has-text("${username}")`).first()).toBeVisible({ timeout: 5000 });
  });

  test("edit username via settings", async ({ page }) => {
    await openSettings(page);

    // Click Edit button next to username
    await page.locator('.settings-card:has-text("Username") button:has-text("Edit")').click();
    await page.waitForTimeout(300);

    // Clear and type new username
    const newUsername = `edited_${Date.now()}`.slice(0, 20);
    const usernameInput = page.locator('.profile-field-edit input[type="text"]').first();
    await usernameInput.clear();
    await usernameInput.fill(newUsername);

    // Click Save
    await page.locator('.profile-field-edit button:has-text("Save")').click();
    await page.waitForTimeout(1000);

    // Verify the new username is displayed
    await expect(page.locator(`.settings-row-label:has-text("${newUsername}")`).first()).toBeVisible({ timeout: 5000 });
  });

  test("email is displayed and not editable", async ({ page }) => {
    await openSettings(page);

    // Email should be displayed
    await expect(page.locator(`.settings-row-label:has-text("${email}")`).first()).toBeVisible({ timeout: 5000 });

    // There should be no Edit button for email
    const emailCard = page.locator('.settings-card:has-text("Email")');
    await expect(emailCard.locator('button:has-text("Edit")')).not.toBeVisible({ timeout: 2000 });
  });

  test("avatar ring style picker is visible", async ({ page }) => {
    await openSettings(page);

    // The Avatar Ring section should be present with ring style options
    await expect(page.locator("text=Avatar Ring").first()).toBeVisible({ timeout: 5000 });

    // Ring style options should be visible
    await expect(page.locator(".ring-style-picker").first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.ring-style-option:has-text("Default")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.ring-style-option:has-text("Chroma")').first()).toBeVisible({ timeout: 3000 });
  });
});
