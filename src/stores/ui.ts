import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SidebarPosition = "left" | "top" | "right" | "bottom";

interface UIState {
  settingsOpen: boolean;
  sidebarPosition: SidebarPosition;
  openSettings: () => void;
  closeSettings: () => void;
  setSidebarPosition: (pos: SidebarPosition) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      settingsOpen: false,
      sidebarPosition: "left",
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      setSidebarPosition: (pos) => set({ sidebarPosition: pos }),
    }),
    {
      name: "flux-ui",
      partialize: (state) => ({
        sidebarPosition: state.sidebarPosition,
      }),
    }
  )
);
