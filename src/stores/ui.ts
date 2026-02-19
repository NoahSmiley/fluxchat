import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarPosition = "left" | "top" | "right" | "bottom";
export type AppBorderStyle = "none" | "chroma" | "pulse" | "wave" | "ember" | "frost" | "neon" | "galaxy";

interface UIState {
  settingsOpen: boolean;
  serverSettingsOpen: boolean;
  showingEconomy: boolean;
  sidebarPosition: SidebarPosition;
  appBorderStyle: AppBorderStyle;
  openSettings: () => void;
  closeSettings: () => void;
  openServerSettings: () => void;
  closeServerSettings: () => void;
  showEconomy: () => void;
  hideEconomy: () => void;
  toggleEconomy: () => void;
  setSidebarPosition: (pos: SidebarPosition) => void;
  setAppBorderStyle: (style: AppBorderStyle) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      settingsOpen: false,
      serverSettingsOpen: false,
      showingEconomy: false,
      sidebarPosition: "left",
      appBorderStyle: "none",
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      openServerSettings: () => set({ serverSettingsOpen: true }),
      closeServerSettings: () => set({ serverSettingsOpen: false }),
      showEconomy: () => set({ showingEconomy: true }),
      hideEconomy: () => set({ showingEconomy: false }),
      toggleEconomy: () => set((s) => ({ showingEconomy: !s.showingEconomy })),
      setSidebarPosition: (pos) => set({ sidebarPosition: pos }),
      setAppBorderStyle: (style) => set({ appBorderStyle: style }),
    }),
    {
      name: "flux-ui",
      partialize: (state) => ({
        sidebarPosition: state.sidebarPosition,
        appBorderStyle: state.appBorderStyle,
      }),
    }
  )
);
