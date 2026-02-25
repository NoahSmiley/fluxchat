import { useChatStore } from "@/stores/chat/index.js";
import { useAuthStore } from "@/stores/auth.js";
import type { useNotifStore as NotifStoreType } from "@/stores/notifications.js";
import { dbg } from "./debug.js";
import { escapeRegex, EVERYONE_MENTION_RE, HERE_MENTION_RE } from "./mention.js";

// True when running inside the Tauri desktop app
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Notification preferences from localStorage
function isSoundEnabled(): boolean {
  return localStorage.getItem("flux-sound-enabled") !== "false";
}

function isNotificationsEnabled(): boolean {
  return localStorage.getItem("flux-notifications-enabled") !== "false";
}

function isDND(): boolean {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return false;
  return useChatStore.getState().userStatuses[userId] === "dnd";
}

// Lazy reference to notif store to avoid circular imports
let notifStoreRef: typeof NotifStoreType | null = null;
import("@/stores/notifications.js").then((m) => { notifStoreRef = m.useNotifStore; });

export function playMessageSound() {
  if (!isSoundEnabled() || isDND()) return;
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.08;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 800;
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 1000;
    osc2.connect(gain);
    osc2.start(ctx.currentTime + 0.08);
    osc2.stop(ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.08, ctx.currentTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.15);
    setTimeout(() => ctx.close(), 300);
  } catch {
    // Audio not available
  }
}

export function showDesktopNotification(senderName: string, text: string) {
  if (!isNotificationsEnabled() || isDND()) return;
  const body = text.length > 100 ? text.slice(0, 100) + "..." : text;

  if (isTauri) {
    void (async () => {
      try {
        const { isPermissionGranted, sendNotification } = await import("@tauri-apps/plugin-notification");
        if (await isPermissionGranted()) {
          sendNotification({ title: senderName, body });
        }
      } catch { /* ignore */ }
    })();
    return;
  }

  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  new Notification(senderName, { body, silent: true });
}

export function requestNotificationPermission() {
  if (isTauri) {
    void (async () => {
      try {
        const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification");
        if (!(await isPermissionGranted())) {
          await requestPermission();
        }
      } catch { /* ignore */ }
    })();
    return;
  }

  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

/**
 * Determines whether a desktop notification should fire for a text channel message.
 * DM notifications bypass this — they always notify unless the sender is muted.
 */
export function shouldNotifyChannel(
  channelId: string,
  senderId: string,
  content: string,
  categoryId?: string | null,
  authUsername?: string
): boolean {
  if (isDND()) return false;

  const notif = notifStoreRef?.getState();
  if (notif?.isUserMuted(senderId)) return false;
  if (notif?.isChannelMuted(channelId)) return false;
  if (categoryId && notif?.isCategoryMuted(categoryId)) return false;

  const setting = notif?.getEffectiveChannelSetting(channelId, categoryId) ?? "only_mentions";

  if (setting === "none") return false;
  if (setting === "all") {
    dbg("notif", `shouldNotify=true reason=setting_all channel=${channelId}`);
    return true;
  }

  // "only_mentions": @everyone, @here, or personal @username
  if (EVERYONE_MENTION_RE.test(content)) {
    dbg("notif", `shouldNotify=true reason=@everyone channel=${channelId}`);
    return true;
  }
  if (HERE_MENTION_RE.test(content)) {
    dbg("notif", `shouldNotify=true reason=@here channel=${channelId}`);
    return true;
  }
  if (!authUsername) return false;
  const escaped = escapeRegex(authUsername);
  const mentioned = new RegExp(`(?<![a-zA-Z0-9_])@${escaped}(?![a-zA-Z0-9_])`, "i").test(content);
  if (mentioned) {
    dbg("notif", `shouldNotify=true reason=@${authUsername} channel=${channelId}`);
  }
  return mentioned;
}
