import { test, expect } from "@playwright/test";
import {
  uniqueUser,
  registerUser,
  getServersViaAPI,
  createRoomViaAPI,
  createRoom,
  waitForAppReady,
  whitelistEmailViaAPI,
} from "./helpers";

// ── Non-voice tests (no LiveKit needed) ──
test.describe("Rooms — CRUD", () => {
  test.describe.configure({ mode: "serial" });

  test("room appears in sidebar after creation", async ({ page }) => {
    const user = uniqueUser("room");
    await registerUser(page, user.email, user.username, user.password);
    await waitForAppReady(page);

    // Click the "Create Room" button
    await createRoom(page);

    // A room should appear in the sidebar with the auto-generated name
    const roomElement = page.locator(".voice-room-group").first();
    await expect(roomElement).toBeVisible({ timeout: 5000 });
  });

  test("room appears in rooms section (bottom of sidebar)", async ({ page }) => {
    const user = uniqueUser("room");
    await registerUser(page, user.email, user.username, user.password);
    await waitForAppReady(page);

    const servers = await getServersViaAPI(page);
    const serverId = servers[0]?.id;
    expect(serverId).toBeTruthy();

    // Create room via API
    await createRoomViaAPI(page, serverId, "API Room");
    await page.waitForTimeout(1000);

    // Room should appear in the voice/rooms section
    const roomLabel = page.locator(".voice-room-group-label").filter({ hasText: "API Room" });
    await expect(roomLabel).toBeVisible({ timeout: 5000 });
  });

  test("multiple rooms can coexist", async ({ page }) => {
    const user = uniqueUser("room");
    await registerUser(page, user.email, user.username, user.password);
    await waitForAppReady(page);

    const servers = await getServersViaAPI(page);
    const serverId = servers[0]?.id;
    expect(serverId).toBeTruthy();

    await createRoomViaAPI(page, serverId, "Room Alpha");
    await createRoomViaAPI(page, serverId, "Room Beta");
    await page.waitForTimeout(1000);

    const roomAlpha = page.locator(".voice-room-group-label").filter({ hasText: "Room Alpha" });
    const roomBeta = page.locator(".voice-room-group-label").filter({ hasText: "Room Beta" });
    await expect(roomAlpha).toBeVisible({ timeout: 5000 });
    await expect(roomBeta).toBeVisible({ timeout: 5000 });
  });

  test("room lock icon visible when locked", async ({ page }) => {
    const user = uniqueUser("room");
    await registerUser(page, user.email, user.username, user.password);
    await waitForAppReady(page);

    const servers = await getServersViaAPI(page);
    const serverId = servers[0]?.id;
    expect(serverId).toBeTruthy();

    await createRoomViaAPI(page, serverId, "Lock Room");
    await page.waitForTimeout(1000);

    // Find the specific Lock Room group
    const roomGroup = page.locator(".voice-room-group").filter({ hasText: "Lock Room" });
    await expect(roomGroup).toBeVisible({ timeout: 5000 });

    // Click the lock toggle button to lock the room
    const lockToggle = roomGroup.locator(".room-lock-toggle");
    await lockToggle.click();

    // Room should now have the locked class
    await expect(roomGroup).toHaveClass(/voice-room-locked/, { timeout: 5000 });
  });

  test("empty room can be deleted", async ({ page }) => {
    const user = uniqueUser("room");
    await registerUser(page, user.email, user.username, user.password);
    await waitForAppReady(page);

    const servers = await getServersViaAPI(page);
    const serverId = servers[0]?.id;
    expect(serverId).toBeTruthy();

    const room = await createRoomViaAPI(page, serverId, "Deletable Room");
    await page.waitForTimeout(1000);

    // Verify room exists
    const roomLabel = page.locator(".voice-room-group-label").filter({ hasText: "Deletable Room" });
    await expect(roomLabel).toBeVisible({ timeout: 5000 });

    // Delete via API
    await page.evaluate(
      async ({ serverId, roomId }) => {
        const token = localStorage.getItem("flux-session-token");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        await fetch(`/api/servers/${serverId}/channels/${roomId}`, {
          method: "DELETE",
          credentials: "include",
          headers,
        });
      },
      { serverId, roomId: room.id },
    );

    await page.waitForTimeout(1000);

    // Room should be gone
    await expect(roomLabel).not.toBeVisible({ timeout: 5000 });
  });
});

// ── Voice tests (require LiveKit) ──
test.describe("Rooms — Voice", () => {
  test.describe.configure({ mode: "serial" });

  test("joining a room connects and shows user in voice view", async ({ page }) => {
    const user = uniqueUser("room");
    await registerUser(page, user.email, user.username, user.password);
    await waitForAppReady(page);

    const servers = await getServersViaAPI(page);
    const serverId = servers[0]?.id;
    expect(serverId).toBeTruthy();

    await createRoomViaAPI(page, serverId, "Avatar Room");
    await page.waitForTimeout(1000);

    // Click on the room to join it
    const roomGroup = page.locator(".voice-room-group").filter({ hasText: "Avatar Room" });
    await roomGroup.click();

    // Verify voice connection via the status bar (shows "Connected" + room name)
    await expect(page.locator(".voice-status-label")).toContainText("Connected", { timeout: 10000 });
    await expect(page.locator(".voice-status-channel")).toContainText("Avatar Room");

    // Verify user appears in the main voice participant grid
    const tile = page.locator(".voice-participant-tile").filter({ hasText: user.username });
    await expect(tile).toBeVisible({ timeout: 10000 });

    // Sidebar participant count should reflect the joined user
    const sidebarCount = roomGroup.locator(".voice-room-group-count");
    await expect(sidebarCount).not.toHaveText("0", { timeout: 5000 });
  });

  test("multi-user room shows both users in voice view", async ({ browser }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      const alice = uniqueUser("alice");
      const bob = uniqueUser("bob");

      await registerUser(pageA, alice.email, alice.username, alice.password);
      await waitForAppReady(pageA);

      await whitelistEmailViaAPI(pageA, bob.email);
      await registerUser(pageB, bob.email, bob.username, bob.password);
      await waitForAppReady(pageB);

      const servers = await getServersViaAPI(pageA);
      const serverId = servers[0]?.id;
      expect(serverId).toBeTruthy();

      // Create room and alice joins
      await createRoomViaAPI(pageA, serverId, "Party Room");
      await pageA.waitForTimeout(1000);

      const roomGroupA = pageA.locator(".voice-room-group").filter({ hasText: "Party Room" });
      await roomGroupA.click();

      // Wait for alice to be connected
      await expect(pageA.locator(".voice-status-label")).toContainText("Connected", { timeout: 10000 });

      // Bob joins the same room
      await pageB.waitForTimeout(1000);
      const roomGroupB = pageB.locator(".voice-room-group").filter({ hasText: "Party Room" });
      await roomGroupB.click();

      // Wait for bob to be connected
      await expect(pageB.locator(".voice-status-label")).toContainText("Connected", { timeout: 10000 });

      // Alice's main voice view should show both users as participant tiles
      const aliceTile = pageA.locator(".voice-participant-tile").filter({ hasText: alice.username });
      const bobTile = pageA.locator(".voice-participant-tile").filter({ hasText: bob.username });
      await expect(aliceTile).toBeVisible({ timeout: 10000 });
      await expect(bobTile).toBeVisible({ timeout: 10000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("switching rooms updates voice view", async ({ page }) => {
    const user = uniqueUser("room");
    await registerUser(page, user.email, user.username, user.password);
    await waitForAppReady(page);

    const servers = await getServersViaAPI(page);
    const serverId = servers[0]?.id;
    expect(serverId).toBeTruthy();

    await createRoomViaAPI(page, serverId, "Switch A");
    await createRoomViaAPI(page, serverId, "Switch B");
    await page.waitForTimeout(1000);

    // Join room A
    const roomA = page.locator(".voice-room-group").filter({ hasText: "Switch A" });
    await roomA.click();

    // Room A should be highlighted as current
    await expect(roomA).toHaveClass(/voice-room-current/, { timeout: 10000 });

    // Switch to room B
    const roomB = page.locator(".voice-room-group").filter({ hasText: "Switch B" });
    await roomB.click();

    // Room B should now be current, Room A should not
    await expect(roomB).toHaveClass(/voice-room-current/, { timeout: 10000 });
    await expect(roomA).not.toHaveClass(/voice-room-current/);
  });
});
