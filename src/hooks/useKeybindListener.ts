import { useEffect, useRef } from "react";
import { useKeybindsStore } from "@/stores/keybinds.js";
import { useVoiceStore } from "@/stores/voice/index.js";
import {
  isTauri,
  isTextInput,
  formatKeyLabel,
  mouseCode,
  mouseLabel,
  getHoldKeybind,
  isGlobalHookActive,
  startGlobalHook,
  stopGlobalHook,
} from "./keybind-config.js";

export function useKeybindListener() {
  const heldKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // ── Global key events (Tauri) — fire even when app window is NOT focused
    let unlistenDown: (() => void) | null = null;
    let unlistenUp: (() => void) | null = null;

    if (isTauri) {
      (async () => {
        const { listen } = await import("@tauri-apps/api/event");

        unlistenDown = await listen("global-key-down", () => {
          const { room } = useVoiceStore.getState();
          if (!room) return;

          const kb = getHoldKeybind();
          if (!kb) return;

          if (kb.action === "push-to-talk") {
            useVoiceStore.getState().setMuted(false);
          } else if (kb.action === "push-to-mute") {
            useVoiceStore.getState().setMuted(true);
          }
        });

        unlistenUp = await listen("global-key-up", () => {
          const { room } = useVoiceStore.getState();
          if (!room) return;

          const kb = getHoldKeybind();
          if (!kb) return;

          if (kb.action === "push-to-talk") {
            useVoiceStore.getState().setMuted(true);
          } else if (kb.action === "push-to-mute") {
            useVoiceStore.getState().setMuted(false);
          }
        });

        // Start the global hook if already connected to voice with a hold keybind
        const { room } = useVoiceStore.getState();
        const kb = getHoldKeybind();
        if (room && kb?.key) {
          startGlobalHook(kb.key);
        }
      })();
    }

    // ── Sync global hook with voice connection & keybind changes ──────────
    let prevRoom: unknown = useVoiceStore.getState().room;
    const unsubVoice = useVoiceStore.subscribe((state) => {
      if (state.room === prevRoom) return;
      prevRoom = state.room;

      const kb = getHoldKeybind();
      if (state.room && kb?.key) {
        startGlobalHook(kb.key);
      } else {
        stopGlobalHook();
      }
    });

    let prevKeybinds = useKeybindsStore.getState().keybinds;
    const unsubKeybinds = useKeybindsStore.subscribe((state) => {
      if (state.keybinds === prevKeybinds) return;
      prevKeybinds = state.keybinds;

      const { room } = useVoiceStore.getState();
      const kb = getHoldKeybind();
      if (room && kb?.key) {
        startGlobalHook(kb.key);
      } else {
        stopGlobalHook();
      }
    });

    // ── Window-level keyboard events ──────────────────────────────────────
    function handleKeyDown(e: KeyboardEvent) {
      const { recording, setKeybind, stopRecording } = useKeybindsStore.getState();
      if (recording) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") {
          stopRecording();
          return;
        }
        setKeybind(recording, e.code, formatKeyLabel(e));
        return;
      }

      if (isTextInput(e.target)) return;
      if (e.repeat) return;

      const { room } = useVoiceStore.getState();
      if (!room) return;

      const { keybinds } = useKeybindsStore.getState();

      for (const kb of keybinds) {
        if (!kb.key || kb.key !== e.code) continue;

        // Skip PTT/PTM at window level when global hook handles it
        if (
          isGlobalHookActive() &&
          (kb.action === "push-to-talk" || kb.action === "push-to-mute")
        ) {
          continue;
        }

        e.preventDefault();

        switch (kb.action) {
          case "push-to-talk":
            heldKeysRef.current.add(e.code);
            useVoiceStore.getState().setMuted(false);
            break;
          case "push-to-mute":
            heldKeysRef.current.add(e.code);
            useVoiceStore.getState().setMuted(true);
            break;
          case "toggle-mute":
            useVoiceStore.getState().toggleMute();
            break;
          case "toggle-deafen":
            useVoiceStore.getState().toggleDeafen();
            break;
        }
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (useKeybindsStore.getState().recording) return;

      if (!heldKeysRef.current.has(e.code)) return;
      heldKeysRef.current.delete(e.code);

      const { room } = useVoiceStore.getState();
      if (!room) return;

      const { keybinds } = useKeybindsStore.getState();
      for (const kb of keybinds) {
        if (!kb.key || kb.key !== e.code) continue;

        switch (kb.action) {
          case "push-to-talk":
            useVoiceStore.getState().setMuted(true);
            break;
          case "push-to-mute":
            useVoiceStore.getState().setMuted(false);
            break;
        }
      }
    }

    // ── Window-level mouse events ─────────────────────────────────────────
    function handleMouseDown(e: MouseEvent) {
      const code = mouseCode(e.button);

      // Recording mode: capture mouse button for settings UI
      const { recording, setKeybind } = useKeybindsStore.getState();
      if (recording) {
        e.preventDefault();
        e.stopPropagation();
        setKeybind(recording, code, mouseLabel(e.button));
        return;
      }

      // Not connected to voice — no-op
      const { room } = useVoiceStore.getState();
      if (!room) return;

      const { keybinds } = useKeybindsStore.getState();

      for (const kb of keybinds) {
        if (!kb.key || kb.key !== code) continue;

        if (
          isGlobalHookActive() &&
          (kb.action === "push-to-talk" || kb.action === "push-to-mute")
        ) {
          continue;
        }

        e.preventDefault();

        switch (kb.action) {
          case "push-to-talk":
            heldKeysRef.current.add(code);
            useVoiceStore.getState().setMuted(false);
            break;
          case "push-to-mute":
            heldKeysRef.current.add(code);
            useVoiceStore.getState().setMuted(true);
            break;
          case "toggle-mute":
            useVoiceStore.getState().toggleMute();
            break;
          case "toggle-deafen":
            useVoiceStore.getState().toggleDeafen();
            break;
        }
      }
    }

    function handleMouseUp(e: MouseEvent) {
      if (useKeybindsStore.getState().recording) return;

      const code = mouseCode(e.button);
      if (!heldKeysRef.current.has(code)) return;
      heldKeysRef.current.delete(code);

      const { room } = useVoiceStore.getState();
      if (!room) return;

      const { keybinds } = useKeybindsStore.getState();
      for (const kb of keybinds) {
        if (!kb.key || kb.key !== code) continue;

        switch (kb.action) {
          case "push-to-talk":
            useVoiceStore.getState().setMuted(true);
            break;
          case "push-to-mute":
            useVoiceStore.getState().setMuted(false);
            break;
        }
      }
    }

    // Suppress context menu when right-click is bound
    function handleContextMenu(e: MouseEvent) {
      const { keybinds } = useKeybindsStore.getState();
      const rightClickBound = keybinds.some((kb) => kb.key === "Mouse2");
      if (rightClickBound) {
        e.preventDefault();
      }
    }

    // ── Blur handler ──────────────────────────────────────────────────────
    function handleBlur() {
      // When the global hook is active, PTT/PTM works across focus — no blur reset needed.
      if (isGlobalHookActive()) return;

      if (heldKeysRef.current.size === 0) return;
      heldKeysRef.current.clear();

      const { room } = useVoiceStore.getState();
      if (!room) return;

      const { keybinds } = useKeybindsStore.getState();
      const hasPTT = keybinds.some((kb) => kb.action === "push-to-talk" && kb.key !== null);
      if (hasPTT) {
        useVoiceStore.getState().setMuted(true);
      }
      const hasPTM = keybinds.some((kb) => kb.action === "push-to-mute" && kb.key !== null);
      if (hasPTM) {
        useVoiceStore.getState().setMuted(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("blur", handleBlur);
      unlistenDown?.();
      unlistenUp?.();
      unsubVoice();
      unsubKeybinds();
      stopGlobalHook();
    };
  }, []);
}
