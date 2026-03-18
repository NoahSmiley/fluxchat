import { test, expect, type Page, type Browser } from "@playwright/test";
import {
  registerUser,
  loginUser,
  createChannel,
  createChannelViaAPI,
  selectChannel,
  sendMessage,
  waitForAppReady,
  waitForMessage,
  openSettings,
  navigateToSettingsTab,
} from "./helpers";

import { dirname, resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCREENSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../athion/public/flux");

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const users = {
  noah: { email: "noah@test.com", username: "noah", password: "TestPass123!" },
  alex: { email: "alex@test.com", username: "alex", password: "TestPass123!" },
  sarah: { email: "sarah@test.com", username: "sarah", password: "TestPass123!" },
  james: { email: "james@test.com", username: "james", password: "TestPass123!" },
};

test.describe("Flux Screenshots", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(120_000);

  test("setup — register users and create channels", async ({ browser }) => {
    const noahCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const noahPage = await noahCtx.newPage();
    await registerUser(noahPage, users.noah.email, users.noah.username, users.noah.password);
    await waitForAppReady(noahPage);

    const textCat = await createChannelViaAPI(noahPage, "Text Channels", "category");
    const voiceCat = await createChannelViaAPI(noahPage, "Voice Channels", "category");

    await createChannelViaAPI(noahPage, "dev", "text", { parentId: textCat?.id || undefined });
    await createChannelViaAPI(noahPage, "music", "text", { parentId: textCat?.id || undefined });
    await createChannelViaAPI(noahPage, "off-topic", "text", { parentId: textCat?.id || undefined });
    await createChannelViaAPI(noahPage, "Room 1", "voice", { parentId: voiceCat?.id || undefined, isRoom: true });
    await createChannelViaAPI(noahPage, "Room 2", "voice", { parentId: voiceCat?.id || undefined, isRoom: true });

    for (const user of [users.alex, users.sarah, users.james]) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage();
      await registerUser(page, user.email, user.username, user.password);
      await waitForAppReady(page);
      await page.close();
      await ctx.close();
    }

    await noahPage.close();
    await noahCtx.close();
  });

  test("populate #general with conversation", async ({ browser }) => {
    const conversation: { user: typeof users[keyof typeof users]; message: string }[] = [
      { user: users.noah, message: "Hey everyone, just pushed the new voice engine changes to main" },
      { user: users.alex, message: "Nice! What codec are you using now?" },
      { user: users.noah, message: "Opus at 48kHz stereo, constant bitrate. The quality difference is insane compared to what we had before" },
      { user: users.sarah, message: "Just tested it — the noise suppression is so clean. I had my mechanical keyboard going and nobody could hear it" },
      { user: users.james, message: "That's the Krisp integration right?" },
      { user: users.sarah, message: "Yeah, it runs locally too. No audio gets sent to any third party" },
      { user: users.alex, message: "What about screen share? I noticed the preset selector got updated" },
      { user: users.noah, message: "We now have 6 presets from 480p30 all the way up to lossless VP9 at 4K. The lossless mode does 20 Mbps" },
      { user: users.james, message: "20 Mbps?? That's wild. Discord caps at like 720p on Nitro" },
      { user: users.alex, message: "How's the latency looking?" },
      { user: users.noah, message: "P95 is under 45ms. LiveKit's SFU architecture is really paying off" },
      { user: users.sarah, message: "The memory usage is what gets me. 48MB idle vs Discord eating 300+ MB just sitting there" },
      { user: users.james, message: "My laptop thanks you 🙏" },
      { user: users.alex, message: "Are we still on track for the encryption rollout?" },
      { user: users.noah, message: "E2EE is already live — AES-256-GCM with ECDH key exchange. Every message, every file, every reaction" },
      { user: users.sarah, message: "Love that it's on by default and not some premium upsell" },
      { user: users.james, message: "This is genuinely the best voice app I've used. The whole thing feels so fast" },
      { user: users.alex, message: "Agreed. Switching to this full time, no question" },
    ];

    for (const msg of conversation) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage();
      await loginUser(page, msg.user.email, msg.user.password);
      await waitForAppReady(page);
      await selectChannel(page, "general");
      await sendMessage(page, msg.message);
      await page.waitForTimeout(300);
      await page.close();
      await ctx.close();
    }
  });

  test("populate #dev with messages", async ({ browser }) => {
    const devMessages: { user: typeof users[keyof typeof users]; message: string }[] = [
      { user: users.noah, message: "Tauri v2 migration is done. Binary size dropped from 45MB to 12MB" },
      { user: users.alex, message: "That's amazing. What about the SQLite layer?" },
      { user: users.noah, message: "Switched to sqlx with compile-time checked queries. No more runtime SQL errors" },
      { user: users.sarah, message: "The LiveKit integration is solid too. Voice reconnects are seamless now" },
      { user: users.james, message: "I noticed the screen share preset selector. Six options from 480p to lossless VP9 is nice" },
      { user: users.alex, message: "Has anyone tested the lossless mode on a 4K display?" },
      { user: users.noah, message: "Yeah — 20 Mbps VP9 at native resolution. Every pixel perfect" },
    ];

    for (const msg of devMessages) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage();
      await loginUser(page, msg.user.email, msg.user.password);
      await waitForAppReady(page);
      await selectChannel(page, "dev");
      await sendMessage(page, msg.message);
      await page.waitForTimeout(300);
      await page.close();
      await ctx.close();
    }
  });

  // HERO: Full app — the only full-window screenshot, used as the overview
  test("screenshot — hero (full app, #general)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await loginUser(page, users.noah.email, users.noah.password);
    await waitForAppReady(page);
    await selectChannel(page, "general");
    await waitForMessage(page, "Switching to this full time");
    await page.waitForTimeout(1000);

    await page.screenshot({ path: join(SCREENSHOT_DIR, "hero.png"), fullPage: false });
    await page.close();
    await ctx.close();
  });

  // MESSAGING: Cropped to just the message list — a focused fragment showing the conversation
  // Also grab the channel sidebar as a separate piece
  test("screenshot — messaging (cropped fragments)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await loginUser(page, users.noah.email, users.noah.password);
    await waitForAppReady(page);
    await selectChannel(page, "general");
    await waitForMessage(page, "Switching to this full time");
    await page.waitForTimeout(1000);

    // Get the bounding box of the message area (main content, excluding sidebars)
    const messageArea = await page.evaluate(() => {
      // The messages container is the scrollable area with all the messages
      const container = document.querySelector(".messages-container");
      if (container) {
        const rect = container.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      return null;
    });

    if (messageArea) {
      // Crop to just the message list — no sidebars, no input bar, no header
      // Add a bit of the header for context but cut off sidebars
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "chat.png"),
        clip: {
          x: messageArea.x,
          y: Math.max(0, messageArea.y - 50), // include channel header
          width: messageArea.width,
          height: Math.min(messageArea.height + 50, 900),
        },
      });
    } else {
      // Fallback: crop the main content area (everything right of channel sidebar)
      const channelSidebar = await page.locator(".channel-sidebar").first().boundingBox();
      const sidebarRight = channelSidebar ? channelSidebar.x + channelSidebar.width : 230;
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "chat.png"),
        clip: { x: sidebarRight, y: 0, width: 1920 - sidebarRight, height: 900 },
      });
    }

    // Also grab the channel sidebar as a separate cropped element
    const sidebarEl = page.locator(".channel-sidebar").first();
    const sidebarBox = await sidebarEl.boundingBox();
    if (sidebarBox) {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "sidebar.png"),
        clip: {
          x: sidebarBox.x,
          y: sidebarBox.y,
          width: sidebarBox.width,
          height: sidebarBox.height,
        },
      });
    }

    await page.close();
    await ctx.close();
  });

  // VOICE: Navigate to #dev and crop to just messages — different conversation content
  test("screenshot — voice section (cropped #dev messages)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await loginUser(page, users.noah.email, users.noah.password);
    await waitForAppReady(page);
    await selectChannel(page, "dev");
    await waitForMessage(page, "Every pixel perfect");
    await page.waitForTimeout(1000);

    // Crop to just the message area
    const messageArea = await page.evaluate(() => {
      const container = document.querySelector(".messages-container");
      if (container) {
        const rect = container.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      return null;
    });

    if (messageArea) {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "voice.png"),
        clip: {
          x: messageArea.x,
          y: Math.max(0, messageArea.y - 50),
          width: messageArea.width,
          height: Math.min(messageArea.height + 50, 900),
        },
      });
    } else {
      const channelSidebar = await page.locator(".channel-sidebar").first().boundingBox();
      const sidebarRight = channelSidebar ? channelSidebar.x + channelSidebar.width : 230;
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "voice.png"),
        clip: { x: sidebarRight, y: 0, width: 1920 - sidebarRight, height: 900 },
      });
    }

    await page.close();
    await ctx.close();
  });

  // SETTINGS: Crop to just the settings content panel (no settings nav sidebar)
  test("screenshot — settings (cropped content)", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await loginUser(page, users.noah.email, users.noah.password);
    await waitForAppReady(page);

    await openSettings(page);
    await page.waitForTimeout(500);

    // Navigate to Voice & Audio tab — more visually interesting than Appearance
    try {
      await navigateToSettingsTab(page, "Voice & Audio");
      await page.waitForTimeout(500);
    } catch {
      try {
        await navigateToSettingsTab(page, "Appearance");
        await page.waitForTimeout(500);
      } catch {
        // Stay on default tab
      }
    }

    // Crop to the settings content area (excluding the settings nav sidebar on the left)
    const settingsContent = await page.evaluate(() => {
      // Look for the settings content area (right side of settings modal)
      const content = document.querySelector(".settings-content, .settings-panel, .settings-main");
      if (content) {
        const rect = content.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      // Fallback: find the settings nav and crop everything to its right
      const nav = document.querySelector(".settings-nav");
      if (nav) {
        const navRect = nav.getBoundingClientRect();
        return { x: navRect.right, y: 0, width: window.innerWidth - navRect.right, height: window.innerHeight };
      }
      return null;
    });

    if (settingsContent && settingsContent.width > 200) {
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "settings.png"),
        clip: {
          x: settingsContent.x,
          y: settingsContent.y,
          width: settingsContent.width,
          height: Math.min(settingsContent.height, 900),
        },
      });
    } else {
      // Fallback: take the full settings view but try to crop roughly
      await page.screenshot({
        path: join(SCREENSHOT_DIR, "settings.png"),
        clip: { x: 160, y: 0, width: 1760, height: 900 },
      });
    }

    await page.close();
    await ctx.close();
  });
});
