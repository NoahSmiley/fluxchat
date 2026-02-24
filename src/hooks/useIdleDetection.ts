import { useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chat/index.js";
import { useAuthStore } from "@/stores/auth.js";
import { useVoiceStore } from "@/stores/voice/index.js";

// How long without any system-wide input (keyboard/mouse or voice) before marking idle
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// How often to poll GetLastInputInfo while app may be in background
const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds

/**
 * Polls OS-level idle time via GetLastInputInfo (Windows) to auto-set status
 * to "idle" after IDLE_TIMEOUT_MS of inactivity across the whole machine.
 * Also treats recent mic transmission as activity, so talking in voice
 * without touching keyboard/mouse keeps the user online.
 * Restores to "online" near-instantly when the user focuses the window.
 */
export function useIdleDetection() {
  const isAutoIdleRef = useRef(false);

  useEffect(() => {
    function getMyStatus() {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return undefined;
      return useChatStore.getState().userStatuses[userId];
    }

    async function checkIdle() {
      const { invoke } = await import("@tauri-apps/api/core");
      let idleMs: number;
      try {
        idleMs = await invoke<number>("get_system_idle_ms");
      } catch {
        return;
      }

      // Also treat recent voice transmission as activity
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

    // Poll to detect going idle (works even when app is in background)
    checkIdle();
    const interval = setInterval(checkIdle, POLL_INTERVAL_MS);

    // Instant return-to-active detection when user focuses the window
    window.addEventListener("focus", checkIdle);
    document.addEventListener("visibilitychange", checkIdle);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", checkIdle);
      document.removeEventListener("visibilitychange", checkIdle);
    };
  }, []);
}
