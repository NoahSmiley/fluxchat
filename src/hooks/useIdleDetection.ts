import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat/index.js";
import { useAuthStore } from "@/stores/auth.js";
import { useVoiceStore } from "@/stores/voice/index.js";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL_MS = 30 * 1000;
const IPC_READY_DELAY_MS = 5_000;

// Module-level flag — set on beforeunload so in-flight invoke() calls bail out.
// This prevents the uncatchable ipc:// fetch error during page refresh.
let unloading = false;
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => { unloading = true; });
}

function getMyStatus() {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return undefined;
  return useChatStore.getState().userStatuses[userId];
}

export function useIdleDetection() {
  const isAutoIdleRef = useRef(false);

  // Tauri desktop: uses native system idle time via IPC
  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function checkIdle() {
      if (cancelled || unloading) return;

      const { invoke } = await import("@tauri-apps/api/core");

      if (cancelled || unloading) return;

      let idleMs: number;
      try {
        idleMs = await invoke<number>("get_system_idle_ms");
      } catch {
        return;
      }

      if (cancelled || unloading) return;

      const { lastSpokeAt } = useVoiceStore.getState();
      const voiceIdleMs = lastSpokeAt > 0 ? Date.now() - lastSpokeAt : Infinity;
      const effectiveIdleMs = Math.min(idleMs, voiceIdleMs);

      const currentStatus = getMyStatus();

      if (effectiveIdleMs >= IDLE_TIMEOUT_MS && currentStatus === "online") {
        isAutoIdleRef.current = true;
        useChatStore.getState().setMyStatus("idle");
      } else if (effectiveIdleMs < IDLE_TIMEOUT_MS && isAutoIdleRef.current) {
        isAutoIdleRef.current = false;
        useChatStore.getState().setMyStatus("online");
      }
    }

    const startupTimer = setTimeout(() => {
      if (cancelled || unloading) return;
      checkIdle();
      interval = setInterval(checkIdle, POLL_INTERVAL_MS);
      window.addEventListener("focus", checkIdle);
      document.addEventListener("visibilitychange", checkIdle);
    }, IPC_READY_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(startupTimer);
      if (interval) clearInterval(interval);
      window.removeEventListener("focus", checkIdle);
      document.removeEventListener("visibilitychange", checkIdle);
    };
  }, []);

  // Browser fallback: track last user interaction via DOM events
  useEffect(() => {
    if ((window as any).__TAURI_INTERNALS__) return;

    let lastActivity = Date.now();
    let interval: ReturnType<typeof setInterval> | null = null;

    function onActivity() {
      lastActivity = Date.now();
      // If we auto-set idle, immediately restore to online on any interaction
      if (isAutoIdleRef.current) {
        isAutoIdleRef.current = false;
        useChatStore.getState().setMyStatus("online");
      }
    }

    function checkIdle() {
      const idleMs = Date.now() - lastActivity;

      const { lastSpokeAt } = useVoiceStore.getState();
      const voiceIdleMs = lastSpokeAt > 0 ? Date.now() - lastSpokeAt : Infinity;
      const effectiveIdleMs = Math.min(idleMs, voiceIdleMs);

      const currentStatus = getMyStatus();

      if (effectiveIdleMs >= IDLE_TIMEOUT_MS && currentStatus === "online") {
        isAutoIdleRef.current = true;
        useChatStore.getState().setMyStatus("idle");
      }
    }

    const events = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"] as const;
    events.forEach((e) => document.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onActivity();
    });

    interval = setInterval(checkIdle, POLL_INTERVAL_MS);

    return () => {
      events.forEach((e) => document.removeEventListener(e, onActivity));
      if (interval) clearInterval(interval);
    };
  }, []);
}
