import { useEffect, useRef } from "react";
import { useKeybindsStore } from "../stores/keybinds.js";
import { useVoiceStore } from "../stores/voice.js";

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

export function useKeybindListener() {
  const heldKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Recording mode: capture key for settings UI
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

    function handleBlur() {
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
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);
}
