import { create } from "zustand";
import { persist } from "zustand/middleware";

export type KeybindAction =
  | "push-to-talk"
  | "push-to-mute"
  | "toggle-mute"
  | "toggle-deafen";

export interface KeybindEntry {
  action: KeybindAction;
  /** KeyboardEvent.code value, e.g. "KeyV", "Space", "F1" */
  key: string | null;
  /** Human-readable label for display, e.g. "V", "Space", "F1" */
  label: string | null;
}

interface KeybindsState {
  keybinds: KeybindEntry[];
  /** Which action is currently being recorded (user clicked "Set Keybind") */
  recording: KeybindAction | null;

  setKeybind: (action: KeybindAction, key: string, label: string) => void;
  clearKeybind: (action: KeybindAction) => void;
  startRecording: (action: KeybindAction) => void;
  stopRecording: () => void;
}

const DEFAULT_KEYBINDS: KeybindEntry[] = [
  { action: "push-to-talk", key: null, label: null },
  { action: "push-to-mute", key: null, label: null },
  { action: "toggle-mute", key: null, label: null },
  { action: "toggle-deafen", key: null, label: null },
];

export const useKeybindsStore = create<KeybindsState>()(
  persist(
    (set) => ({
      keybinds: [...DEFAULT_KEYBINDS],
      recording: null,

      setKeybind: (action, key, label) =>
        set((state) => ({
          keybinds: state.keybinds.map((kb) =>
            kb.action === action ? { ...kb, key, label } : kb
          ),
          recording: null,
        })),

      clearKeybind: (action) =>
        set((state) => ({
          keybinds: state.keybinds.map((kb) =>
            kb.action === action ? { ...kb, key: null, label: null } : kb
          ),
        })),

      startRecording: (action) => set({ recording: action }),
      stopRecording: () => set({ recording: null }),
    }),
    {
      name: "flux-keybinds",
      partialize: (state) => ({ keybinds: state.keybinds }),
    }
  )
);
