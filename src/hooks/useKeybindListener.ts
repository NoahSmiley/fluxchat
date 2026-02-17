import { useEffect, useRef } from "react";
import { useKeybindsStore } from "../stores/keybinds.js";
import { useVoiceStore } from "../stores/voice.js";

const isTauri = !!(window as any).__TAURI_INTERNALS__;

function isTextInput(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

function formatKeyLabel(e: KeyboardEvent): string {
  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  if (e.code === "Space") return "Space";
  return e.code;
}

const MOUSE_LABELS: Record<number, string> = {
  0: "Mouse 1",
  1: "Mouse 3", // middle click is conventionally "mouse 3"
  2: "Mouse 2", // right click is conventionally "mouse 2"
  3: "Mouse 4",
  4: "Mouse 5",
};

function mouseCode(button: number): string {
  return `Mouse${button}`;
}

function mouseLabel(button: number): string {
  return MOUSE_LABELS[button] ?? `Mouse ${button + 1}`;
}

/** Find the PTT or PTM keybind that has a key assigned. */
function getHoldKeybind() {
  const { keybinds } = useKeybindsStore.getState();
  return keybinds.find(
    (kb) =>
      (kb.action === "push-to-talk" || kb.action === "push-to-mute") &&
      kb.key !== null
  );
}

// ── Global key hook management (Tauri / Windows) ────────────────────────────

let globalHookActive = false;

async function startGlobalHook(keyCode: string) {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_global_key_listen", { keyCode });
    globalHookActive = true;
  } catch {
    globalHookActive = false;
  }
}

async function stopGlobalHook() {
  if (!isTauri || !globalHookActive) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_global_key_listen");
  } catch {
    // ignore
  }
  globalHookActive = false;
}

export function useKeybindListener() {
  const heldKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // ── Global key events (Tauri) ─────────────────────────────────────────
    // These fire even when the app window is NOT focused.
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
    // Re-register the global hook whenever voice or keybind state changes.
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
      // Recording mode: capture key for settings UI (ESC cancels)
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

      // Skip if typing in a text field
      if (isTextInput(e.target)) return;

      // Ignore key repeat
      if (e.repeat) return;

      // Not connected to voice — no-op
      const { room } = useVoiceStore.getState();
      if (!room) return;

      const { keybinds } = useKeybindsStore.getState();

      for (const kb of keybinds) {
        if (!kb.key || kb.key !== e.code) continue;

        // If the global hook handles PTT/PTM, skip window-level handling
        // to avoid double-firing when the app is focused.
        if (
          globalHookActive &&
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
          globalHookActive &&
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

    // Suppress context menu when right-click is bound to an action
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
      if (globalHookActive) return;

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
