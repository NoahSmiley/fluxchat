import { useEffect, useRef } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Tracks user activity (mouse, keyboard, click) and auto-sets status to "idle"
 * after 5 minutes of inactivity if the user's chosen status is "online".
 * Restores to "online" when activity resumes.
 */
export function useIdleDetection() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutoIdleRef = useRef(false);

  useEffect(() => {
    function getMyStatus() {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return undefined;
      return useChatStore.getState().userStatuses[userId];
    }

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current);

      // If we auto-set idle, restore to online on activity
      if (isAutoIdleRef.current) {
        isAutoIdleRef.current = false;
        useChatStore.getState().setMyStatus("online");
      }

      const currentStatus = getMyStatus();
      // Only auto-idle if user's status is "online"
      if (currentStatus !== "online") return;

      timerRef.current = setTimeout(() => {
        const s = getMyStatus();
        if (s === "online") {
          isAutoIdleRef.current = true;
          useChatStore.getState().setMyStatus("idle");
        }
      }, IDLE_TIMEOUT_MS);
    }

    const events = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"];
    events.forEach((e) => document.addEventListener(e, resetTimer, { passive: true }));

    // Start the timer initially
    resetTimer();

    return () => {
      events.forEach((e) => document.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
