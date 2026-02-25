import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  createChannel,
  createChannelViaAPI,
  rightClickElement,
} from "./helpers";

test.describe("Rooms", () => {
  test.describe.configure({ mode: "serial" });

  test.describe("Room CRUD", () => {
    // Skip: Rooms only appear in the sidebar when participants are present.
    // These tests require LiveKit voice infrastructure to join rooms.
    test.skip();
    test("room appears in sidebar after API creation", async ({ page }) => {
      const user = uniqueUser("room");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Alpha", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      // Room should appear in the voice/rooms section
      await expect(page.locator(`text=Room Alpha`).first()).toBeVisible({ timeout: 5000 });
    });

    test("room context menu shows Rename and Delete for admin", async ({ page }) => {
      const user = uniqueUser("roomctx");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Beta", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      const room = page.locator(`text=Room Beta`).first();
      const menu = await rightClickElement(page, room);
      await expect(menu).toBeVisible({ timeout: 3000 });

      await expect(menu.locator('.context-menu-item:has-text("Rename room")')).toBeVisible();
      await expect(menu.locator('.context-menu-item:has-text("Delete room")')).toBeVisible();
    });

    test("delete room via context menu removes it", async ({ page }) => {
      const user = uniqueUser("roomdel");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Delete", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      const room = page.locator(`text=Room Delete`).first();
      await expect(room).toBeVisible({ timeout: 5000 });

      const menu = await rightClickElement(page, room);
      await menu.locator('.context-menu-item:has-text("Delete room")').click();
      await page.waitForTimeout(2000);

      await expect(page.locator(`text=Room Delete`)).not.toBeVisible({ timeout: 5000 });
    });

    test("room shows bitrate submenu in context menu", async ({ page }) => {
      const user = uniqueUser("roombr");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Bitrate", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      const room = page.locator(`text=Room Bitrate`).first();
      const menu = await rightClickElement(page, room);

      // Should show Bitrate submenu item
      const bitrateItem = menu.locator('.context-menu-item:has-text("Bitrate")');
      await expect(bitrateItem).toBeVisible({ timeout: 3000 });
    });

    test("lock/unlock room toggle in context menu", async ({ page }) => {
      const user = uniqueUser("roomlock");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Lock", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      const room = page.locator(`text=Room Lock`).first();

      // First click should show "Lock room"
      const menu1 = await rightClickElement(page, room);
      await expect(menu1.locator('.context-menu-item:has-text("Lock room")')).toBeVisible({ timeout: 3000 });

      // Click Lock room
      await menu1.locator('.context-menu-item:has-text("Lock room")').click();
      await page.waitForTimeout(1000);

      // Now context menu should show "Unlock room"
      const menu2 = await rightClickElement(page, room);
      await expect(menu2.locator('.context-menu-item:has-text("Unlock room")')).toBeVisible({ timeout: 3000 });
    });

    test("multiple rooms can coexist", async ({ page }) => {
      const user = uniqueUser("roommulti");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room One", "voice", { isRoom: true });
      await createChannelViaAPI(page, "Room Two", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      await expect(page.locator(`text=Room One`).first()).toBeVisible({ timeout: 5000 });
      await expect(page.locator(`text=Room Two`).first()).toBeVisible({ timeout: 5000 });
    });

    test("rename room via context menu", async ({ page }) => {
      const user = uniqueUser("roomren");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Rename", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      const room = page.locator(`text=Room Rename`).first();
      const menu = await rightClickElement(page, room);
      await menu.locator('.context-menu-item:has-text("Rename room")').click();
      await page.waitForTimeout(500);

      // Should show an inline rename input
      const renameInput = page.locator('.room-rename-input, input[type="text"]').first();
      await expect(renameInput).toBeVisible({ timeout: 3000 });

      await renameInput.clear();
      await renameInput.fill("Renamed Room");
      await renameInput.press("Enter");
      await page.waitForTimeout(1000);

      await expect(page.locator(`text=Renamed Room`).first()).toBeVisible({ timeout: 5000 });
    });
  });

  test.describe("Room via Create Room button", () => {
    // Skip: Create Room button auto-joins via LiveKit, requires voice infrastructure
    test.skip();
    test("Create Room button creates a room when voice channel is selected", async ({ page }) => {
      const user = uniqueUser("roomcr");
      await registerUser(page, user.email, user.username, user.password);

      // Create a voice channel first
      await createChannel(page, "vc-room-test", "voice");

      // Look for the Create Room button
      const createRoomBtn = page.locator('button:has-text("Create Room"), button[title="Create Room"]').first();

      // It may only be visible in the voice channel view
      if (await createRoomBtn.isVisible()) {
        await createRoomBtn.click();
        await page.waitForTimeout(1500);

        // A new room should appear
        const rooms = page.locator('.room-item, .voice-room-group');
        const count = await rooms.count();
        expect(count).toBeGreaterThanOrEqual(1);
      }
    });
  });

  test.describe("Room join/leave behavior", () => {
    // Skip: These tests require LiveKit voice infrastructure to be running.
    test.skip();
    test("joining a room shows user avatar in the room card", async ({ page }) => {
      const user = uniqueUser("roomjoin");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Join Test", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      // Click the room card to join
      const roomCard = page.locator('.voice-room-group:has-text("Room Join Test")').first();
      await expect(roomCard).toBeVisible({ timeout: 5000 });
      await roomCard.click();
      await page.waitForTimeout(2000);

      // User avatar should appear inside the room card
      const avatar = roomCard.locator('.voice-room-avatar, .voice-user-row').first();
      await expect(avatar).toBeVisible({ timeout: 5000 });
    });

    test("disconnecting from a room removes the room card from sidebar", async ({ page }) => {
      const user = uniqueUser("roomleave");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Leave Test", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      // Join the room
      const roomCard = page.locator('.voice-room-group:has-text("Room Leave Test")').first();
      await expect(roomCard).toBeVisible({ timeout: 5000 });
      await roomCard.click();
      await page.waitForTimeout(2000);

      // Click the disconnect button
      const disconnectBtn = page.locator('button[title="Disconnect"]').first();
      await expect(disconnectBtn).toBeVisible({ timeout: 5000 });
      await disconnectBtn.click();
      await page.waitForTimeout(1500);

      // Room card should disappear (no participants, not connected)
      await expect(page.locator('.voice-room-group:has-text("Room Leave Test")')).not.toBeVisible({ timeout: 5000 });
    });

    test("user avatar is not shown in the room after leaving", async ({ page }) => {
      const user = uniqueUser("roomavatar");
      await registerUser(page, user.email, user.username, user.password);

      await createChannelViaAPI(page, "Room Avatar Test", "voice", { isRoom: true });
      await page.waitForTimeout(1500);

      // Join the room
      const roomCard = page.locator('.voice-room-group:has-text("Room Avatar Test")').first();
      await expect(roomCard).toBeVisible({ timeout: 5000 });
      await roomCard.click();
      await page.waitForTimeout(2000);

      // Verify avatar is visible while connected
      const avatarInRoom = roomCard.locator('.voice-room-avatar, .voice-user-row').first();
      await expect(avatarInRoom).toBeVisible({ timeout: 5000 });

      // Disconnect
      const disconnectBtn = page.locator('button[title="Disconnect"]').first();
      await disconnectBtn.click();
      await page.waitForTimeout(1500);

      // The room card itself should be gone, so no avatars are visible for this room
      await expect(page.locator('.voice-room-group:has-text("Room Avatar Test")')).not.toBeVisible({ timeout: 5000 });
    });
  });
});
