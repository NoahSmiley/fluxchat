import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  selectChannel,
  sendMessage,
  waitForMessage,
} from "./helpers";

test.describe("Message Search", () => {
  test.describe.configure({ mode: "serial" });

  test("search bar is visible in chat header", async ({ page }) => {
    const user = uniqueUser("search");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    await expect(page.locator(".search-bar").first()).toBeVisible({ timeout: 5000 });
  });

  test("typing query and pressing Enter shows results", async ({ page }) => {
    const user = uniqueUser("searchq");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    // Send a message first to search for
    const msgText = `searchable-${Date.now()}`;
    await sendMessage(page, msgText);
    await waitForMessage(page, msgText);

    // Type in search bar
    const searchInput = page.locator(".search-bar input").first();
    await searchInput.click();
    await searchInput.fill(msgText);
    await searchInput.press("Enter");
    await page.waitForTimeout(2000);

    // Search results banner should appear
    await expect(page.locator(".search-results-banner").first()).toBeVisible({ timeout: 5000 });
  });

  test("search results contain matching messages", async ({ page }) => {
    const user = uniqueUser("searchmatch");
    await registerUser(page, user.email, user.username, user.password);

    await createChannel(page, "search-test", "text");
    await selectChannel(page, "search-test");

    const unique = `searchtest${Date.now()}`;
    await sendMessage(page, unique);
    await waitForMessage(page, unique);
    // Wait for FTS index to catch up
    await page.waitForTimeout(2000);

    // Search and retry if needed (FTS indexing can be delayed)
    const searchInput = page.locator(".search-bar input").first();
    let found = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await searchInput.click();
      await searchInput.fill(unique);
      await searchInput.press("Enter");
      await page.waitForTimeout(2000);
      const banner = page.locator(".search-results-banner").first();
      const text = await banner.textContent() ?? "";
      if (text.includes("1 result")) {
        found = true;
        break;
      }
      // Clear and retry
      await searchInput.clear();
      await page.waitForTimeout(1000);
    }

    expect(found).toBe(true);
  });

  test("clearing search returns to normal view", async ({ page }) => {
    const user = uniqueUser("searchclear");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const msgText = `clearable-${Date.now()}`;
    await sendMessage(page, msgText);
    await waitForMessage(page, msgText);

    const searchInput = page.locator(".search-bar input").first();
    await searchInput.click();
    await searchInput.fill(msgText);
    await searchInput.press("Enter");
    await page.waitForTimeout(2000);

    await expect(page.locator(".search-results-banner").first()).toBeVisible({ timeout: 5000 });

    // Clear search using the X button
    const clearBtn = page.locator(".search-bar-action-btn").first();
    await clearBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator(".search-results-banner")).not.toBeVisible({ timeout: 3000 });
  });

  test("no results shows zero count", async ({ page }) => {
    const user = uniqueUser("searchnone");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const searchInput = page.locator(".search-bar input").first();
    await searchInput.click();
    await searchInput.fill(`nonexistent-${Date.now()}-gibberish`);
    await searchInput.press("Enter");
    await page.waitForTimeout(2000);

    await expect(page.locator(".search-results-banner").first()).toContainText("0 result");
  });

  test("from: keyword triggers filter dropdown", async ({ page }) => {
    const user = uniqueUser("searchfrom");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const searchInput = page.locator(".search-bar input").first();
    await searchInput.click();
    await searchInput.fill("from:");
    await page.waitForTimeout(500);

    // A dropdown should appear with user suggestions
    const dropdown = page.locator(".search-filter-dropdown").first();
    await expect(dropdown).toBeVisible({ timeout: 3000 });
  });

  test("in: keyword triggers channel filter dropdown", async ({ page }) => {
    const user = uniqueUser("searchin");
    await registerUser(page, user.email, user.username, user.password);
    await selectChannel(page, "general");

    const searchInput = page.locator(".search-bar input").first();
    await searchInput.click();
    await searchInput.fill("in:");
    await page.waitForTimeout(500);

    const dropdown = page.locator(".search-filter-dropdown").first();
    await expect(dropdown).toBeVisible({ timeout: 3000 });
  });
});
