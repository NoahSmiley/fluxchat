import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarPosition = "left" | "top" | "right" | "bottom";
export type AppBorderStyle = "none" | "chroma" | "pulse" | "wave" | "ember" | "frost" | "neon" | "galaxy";

interface UIState {
  settingsOpen: boolean;
  serverSettingsOpen: boolean;
  sidebarPosition: SidebarPosition;
  appBorderStyle: AppBorderStyle;
  showDummyUsers: boolean;
  highlightOwnMessages: boolean;
  spellcheck: boolean;
  showSendButton: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  openServerSettings: () => void;
  closeServerSettings: () => void;
  setSidebarPosition: (pos: SidebarPosition) => void;
  setAppBorderStyle: (style: AppBorderStyle) => void;
  toggleDummyUsers: () => void;
  setHighlightOwnMessages: (val: boolean) => void;
  setSpellcheck: (val: boolean) => void;
  setShowSendButton: (val: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      settingsOpen: false,
      serverSettingsOpen: false,
      sidebarPosition: "left",
      appBorderStyle: "none",
      showDummyUsers: false,
      highlightOwnMessages: true,
      spellcheck: true,
      showSendButton: true,
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      openServerSettings: () => set({ serverSettingsOpen: true }),
      closeServerSettings: () => set({ serverSettingsOpen: false }),
      setSidebarPosition: (pos) => set({ sidebarPosition: pos }),
      setAppBorderStyle: (style) => set({ appBorderStyle: style }),
      toggleDummyUsers: () => set((s) => ({ showDummyUsers: !s.showDummyUsers })),
      setHighlightOwnMessages: (val) => set({ highlightOwnMessages: val }),
      setSpellcheck: (val) => set({ spellcheck: val }),
      setShowSendButton: (val) => set({ showSendButton: val }),
    }),
    {
      name: "flux-ui",
      partialize: (state) => ({
        sidebarPosition: state.sidebarPosition,
        appBorderStyle: state.appBorderStyle,
        showDummyUsers: state.showDummyUsers,
        highlightOwnMessages: state.highlightOwnMessages,
        spellcheck: state.spellcheck,
        showSendButton: state.showSendButton,
      }),
    }
  )
);
