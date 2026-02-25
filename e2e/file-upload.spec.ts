import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
} from "./helpers";

test.describe("File Upload", () => {
  test.describe.configure({ mode: "serial" });

  test("attachment button is visible in message input area", async ({ page }) => {
    const user = uniqueUser("upload");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    // Look for paperclip / attachment button
    const attachBtn = page.locator('button.btn-attach[title="Attach file"]').first();
    await expect(attachBtn).toBeVisible({ timeout: 5000 });
  });

  test("file input element exists in the DOM", async ({ page }) => {
    const user = uniqueUser("uploadinput");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    // A hidden file input should exist
    const fileInput = page.locator('input[type="file"]').first();
    await expect(fileInput).toBeAttached({ timeout: 5000 });
  });

  test("selecting a file shows pending attachment preview", async ({ page }) => {
    const user = uniqueUser("uploadpreview");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "upload-test", "text");
    await selectChannel(page, "upload-test");

    // Set a file on the hidden file input
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "test.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Hello E2E test file"),
    });
    await page.waitForTimeout(1000);

    // A pending attachment preview should appear
    const preview = page.locator(".pending-attachment").first();
    await expect(preview).toBeVisible({ timeout: 5000 });
  });

  test("can remove a pending attachment", async ({ page }) => {
    const user = uniqueUser("uploadremove");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "upload-remove", "text");
    await selectChannel(page, "upload-remove");

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "remove-me.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Remove me"),
    });

    // Wait for the upload to complete and the remove button to appear
    const removeBtn = page.locator(".pending-attachment-remove").first();
    await expect(removeBtn).toBeVisible({ timeout: 10000 });

    // Click the remove button
    await removeBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator(".pending-attachment:not(.uploading)")).not.toBeVisible({ timeout: 3000 });
  });
});
