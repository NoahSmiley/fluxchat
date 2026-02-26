import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ActiveTheme, CustomTheme } from "@/lib/themes.js";

export type SidebarPosition = "left" | "top" | "right" | "bottom";
export type AppBorderStyle = "none" | "chroma" | "pulse" | "wave" | "ember" | "frost" | "neon" | "galaxy";

interface UIState {
  settingsOpen: boolean;
  settingsTab: string | null;
  serverSettingsOpen: boolean;
  roadmapOpen: boolean;
  sidebarPosition: SidebarPosition;
  appBorderStyle: AppBorderStyle;
  highlightOwnMessages: boolean;
  spellcheck: boolean;
  showSendButton: boolean;
  betaUpdates: boolean;
  activeTheme: ActiveTheme;
  customThemes: CustomTheme[];
  openSettings: () => void;
  openSettingsTab: (tab: string) => void;
  closeSettings: () => void;
  openServerSettings: () => void;
  closeServerSettings: () => void;
  openRoadmap: () => void;
  closeRoadmap: () => void;
  setSidebarPosition: (pos: SidebarPosition) => void;
  setAppBorderStyle: (style: AppBorderStyle) => void;
  setHighlightOwnMessages: (val: boolean) => void;
  setSpellcheck: (val: boolean) => void;
  setShowSendButton: (val: boolean) => void;
  setBetaUpdates: (val: boolean) => void;
  setActiveTheme: (theme: ActiveTheme) => void;
  addCustomTheme: (theme: CustomTheme) => void;
  updateCustomTheme: (id: string, updates: Partial<Pick<CustomTheme, "name" | "colors">>) => void;
  deleteCustomTheme: (id: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      settingsOpen: false,
      settingsTab: null,
      serverSettingsOpen: false,
      roadmapOpen: false,
      sidebarPosition: "left",
      appBorderStyle: "none",
      highlightOwnMessages: true,
      spellcheck: true,
      showSendButton: true,
      betaUpdates: false,
      activeTheme: { type: "preset", id: "liminal" } as ActiveTheme,
      customThemes: [] as CustomTheme[],
      openSettings: () => set({ settingsOpen: true, settingsTab: null }),
      openSettingsTab: (tab) => set({ settingsOpen: true, settingsTab: tab }),
      closeSettings: () => set({ settingsOpen: false, settingsTab: null }),
      openServerSettings: () => set({ serverSettingsOpen: true }),
      closeServerSettings: () => set({ serverSettingsOpen: false }),
      openRoadmap: () => set({ roadmapOpen: true }),
      closeRoadmap: () => set({ roadmapOpen: false }),
      setSidebarPosition: (pos) => set({ sidebarPosition: pos }),
      setAppBorderStyle: (style) => set({ appBorderStyle: style }),
      setHighlightOwnMessages: (val) => set({ highlightOwnMessages: val }),
      setSpellcheck: (val) => set({ spellcheck: val }),
      setShowSendButton: (val) => set({ showSendButton: val }),
      setBetaUpdates: (val) => set({ betaUpdates: val }),
      setActiveTheme: (theme) => set({ activeTheme: theme }),
      addCustomTheme: (theme) =>
        set((s) => ({ customThemes: [...s.customThemes, theme] })),
      updateCustomTheme: (id, updates) =>
        set((s) => ({
          customThemes: s.customThemes.map((t) =>
            t.id === id ? { ...t, ...updates } : t,
          ),
        })),
      deleteCustomTheme: (id) => {
        const { activeTheme, customThemes } = get();
        const next: Partial<UIState> = {
          customThemes: customThemes.filter((t) => t.id !== id),
        };
        if (activeTheme.type === "custom" && activeTheme.id === id) {
          next.activeTheme = { type: "preset", id: "liminal" };
        }
        set(next);
      },
    }),
    {
      name: "flux-ui",
      partialize: (state) => ({
        sidebarPosition: state.sidebarPosition,
        appBorderStyle: state.appBorderStyle,
        highlightOwnMessages: state.highlightOwnMessages,
        spellcheck: state.spellcheck,
        showSendButton: state.showSendButton,
        betaUpdates: state.betaUpdates,
        activeTheme: state.activeTheme,
        customThemes: state.customThemes,
      }),
    }
  )
);
