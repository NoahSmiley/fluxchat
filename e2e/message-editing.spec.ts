import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  sendMessage,
  waitForMessage,
  whitelistEmailViaAPI,
} from "./helpers";

test.describe("Message Editing and Deleting", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("Edit message", () => {
    test("clicking edit pencil icon enters edit mode", async ({ page }) => {
      const user = uniqueUser("edit");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `edit-me-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      // Hover over message to reveal action buttons
      const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
      await msgRow.hover();
      await page.waitForTimeout(200);

      // Click the edit pencil button
      const editBtn = msgRow.locator(".edit-btn").first();
      await editBtn.click();
      await page.waitForTimeout(300);

      // Should now show the edit form
      await expect(page.locator(".message-edit-form").first()).toBeVisible({ timeout: 3000 });
      await expect(page.locator(".message-edit-input[contenteditable]").first()).toBeVisible();
    });

    test("edit form shows Save and Cancel buttons", async ({ page }) => {
      const user = uniqueUser("editsave");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `editbtn-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
      await msgRow.hover();
      await msgRow.locator(".edit-btn").first().click();
      await page.waitForTimeout(300);

      const editForm = page.locator(".message-edit-form").first();
      await expect(editForm.locator("button:has-text('Save')")).toBeVisible();
      await expect(editForm.locator("button:has-text('Cancel')")).toBeVisible();
    });

    test("pressing Escape cancels edit", async ({ page }) => {
      const user = uniqueUser("editesc");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `editesc-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
      await msgRow.hover();
      await msgRow.locator(".edit-btn").first().click();
      await page.waitForTimeout(300);

      await expect(page.locator(".message-edit-form").first()).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.locator(".message-edit-form")).not.toBeVisible({ timeout: 2000 });

      // Original message text should still be there
      await expect(page.locator(`text=${msgText}`).first()).toBeVisible();
    });

    test("pressing Enter saves edited message and shows (edited)", async ({ page }) => {
      const user = uniqueUser("editsub");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const origText = `original-${Date.now()}`;
      await sendMessage(page, origText);
      await waitForMessage(page, origText);

      const msgRow = page.locator(`.message:has-text("${origText}")`).first();
      await msgRow.hover();
      await msgRow.locator(".edit-btn").first().click();
      await page.waitForTimeout(300);

      // Clear and type new content
      const editInput = page.locator(".message-edit-input[contenteditable]").first();
      await editInput.click();
      await page.keyboard.press("Control+A");
      const editedText = `edited-${Date.now()}`;
      await page.keyboard.type(editedText, { delay: 20 });
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);

      // Edited message should appear with new text
      await expect(page.locator(`text=${editedText}`).first()).toBeVisible({ timeout: 5000 });

      // (edited) indicator should appear
      await expect(page.locator(".message-edited").first()).toBeVisible({ timeout: 3000 });
    });
  });

  test.describe("Delete message", () => {
    test("delete button opens confirmation modal", async ({ page }) => {
      const user = uniqueUser("del");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `delete-me-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
      await msgRow.hover();
      await page.waitForTimeout(200);

      const deleteBtn = msgRow.locator(".delete-btn").first();
      await deleteBtn.click();
      await page.waitForTimeout(500);

      // Confirm delete modal should appear
      await expect(page.locator(".confirm-delete-modal").first()).toBeVisible({ timeout: 3000 });
    });

    test("confirmation modal shows message preview", async ({ page }) => {
      const user = uniqueUser("delpreview");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `preview-del-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
      await msgRow.hover();
      await msgRow.locator(".delete-btn").first().click();
      await page.waitForTimeout(500);

      const modal = page.locator(".confirm-delete-modal").first();
      await expect(modal.locator(".confirm-delete-preview")).toContainText(msgText);
    });

    test("Cancel on delete modal closes without deleting", async ({ page }) => {
      const user = uniqueUser("delcancel");
      await registerUser(page, user.email, user.username, user.password);

      await selectChannel(page, "general");
      const msgText = `cancel-del-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
      await msgRow.hover();
      await msgRow.locator(".delete-btn").first().click();
      await page.waitForTimeout(500);

      // Click Cancel
      await page.locator(".confirm-delete-modal button:has-text('Cancel')").click();
      await page.waitForTimeout(300);

      // Modal should be gone
      await expect(page.locator(".confirm-delete-modal")).not.toBeVisible({ timeout: 2000 });
      // Message should still exist
      await expect(page.locator(`text=${msgText}`).first()).toBeVisible();
    });

    test("confirm delete removes the message", async ({ page }) => {
      const user = uniqueUser("delconfirm");
      await registerUser(page, user.email, user.username, user.password);

      await createChannel(page, "del-test", "text");
      await selectChannel(page, "del-test");

      const msgText = `confirm-del-${Date.now()}`;
      await sendMessage(page, msgText);
      await waitForMessage(page, msgText);

      const msgRow = page.locator(`.message:has-text("${msgText}")`).first();
      await msgRow.hover();
      await msgRow.locator(".delete-btn").first().click();
      await page.waitForTimeout(500);

      // Click Delete
      await page.locator(".confirm-delete-modal .btn-danger").click();
      await page.waitForTimeout(1000);

      // Message should be gone
      await expect(page.locator(`text=${msgText}`)).not.toBeVisible({ timeout: 5000 });
    });

    test("edit/delete buttons only show on own messages", async ({ browser }) => {
      const contextA = await browser.newContext();
      const contextB = await browser.newContext();

      try {
        const pageA = await contextA.newPage();
        const pageB = await contextB.newPage();

        const alice = uniqueUser("editAlice");
        const bob = uniqueUser("editBob");

        await registerUser(pageA, alice.email, alice.username, alice.password);
        await whitelistEmailViaAPI(pageA, bob.email);
        await registerUser(pageB, bob.email, bob.username, bob.password);

        await selectChannel(pageA, "general");
        await selectChannel(pageB, "general");

        const msgText = `alice-only-${Date.now()}`;
        await sendMessage(pageA, msgText);
        await waitForMessage(pageB, msgText, 10000);

        // Bob hovers over Alice's message — should NOT see edit/delete buttons
        const msgRow = pageB.locator(`.message:has-text("${msgText}")`).first();
        await msgRow.hover();
        await pageB.waitForTimeout(300);

        await expect(msgRow.locator(".edit-btn")).not.toBeVisible({ timeout: 2000 });
        await expect(msgRow.locator(".delete-btn")).not.toBeVisible({ timeout: 2000 });
      } finally {
        await contextA.close();
        await contextB.close();
      }
    });
  });
});
