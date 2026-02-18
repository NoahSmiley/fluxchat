import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";

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
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  new Notification(`${senderName}`, {
    body: text.length > 100 ? text.slice(0, 100) + "..." : text,
    silent: true,
  });
}

export function requestNotificationPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}
