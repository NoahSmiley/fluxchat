import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChannelNotifSetting = "all" | "only_mentions" | "none" | "default";
export type CategoryNotifSetting = "all" | "only_mentions" | "none";
export type GlobalNotifSetting = "all" | "only_mentions" | "none";

interface NotifState {
  channelSettings:        Record<string, ChannelNotifSetting>;
  categorySettings:       Record<string, CategoryNotifSetting>;
  mutedChannels:          Record<string, number>;   // unix ms timestamp, -1 = indefinite
  mutedCategories:        Record<string, number>;
  mutedUsers:             string[];                 // user IDs
  mutedMentionChannels:   Record<string, boolean>;  // channels where @mention badge is also suppressed
  mutedMentionCategories: Record<string, boolean>;  // categories where @mention badge is also suppressed
  defaultChannelSetting:  GlobalNotifSetting;       // global default for server text channel notifications

  setChannelSetting:        (channelId: string, setting: ChannelNotifSetting)  => void;
  setCategorySetting:       (categoryId: string, setting: CategoryNotifSetting) => void;
  setDefaultChannelSetting: (setting: GlobalNotifSetting) => void;
  muteChannel:    (channelId: string, untilMs: number)  => void;
  unmuteChannel:  (channelId: string)  => void;
  muteCategory:   (categoryId: string, untilMs: number) => void;
  unmuteCategory: (categoryId: string) => void;
  muteUser:       (userId: string) => void;
  unmuteUser:     (userId: string) => void;
  setMuteChannelMentions:   (channelId: string, muted: boolean)  => void;
  setMuteCategoryMentions:  (categoryId: string, muted: boolean) => void;
  isChannelMuted:           (channelId: string)  => boolean;
  isCategoryMuted:          (categoryId: string) => boolean;
  isUserMuted:              (userId: string)     => boolean;
  isChannelMentionMuted:    (channelId: string)  => boolean;
  isCategoryMentionMuted:   (categoryId: string) => boolean;
  getEffectiveChannelSetting: (
    channelId: string,
    categoryId?: string | null
  ) => "all" | "only_mentions" | "none";
}

export const useNotifStore = create<NotifState>()(
  persist(
    (set, get) => ({
      channelSettings:        {},
      categorySettings:       {},
      mutedChannels:          {},
      mutedCategories:        {},
      mutedUsers:             [],
      mutedMentionChannels:   {},
      mutedMentionCategories: {},
      defaultChannelSetting:  "only_mentions",

      setChannelSetting: (channelId, setting) =>
        set((s) => ({ channelSettings: { ...s.channelSettings, [channelId]: setting } })),

      setCategorySetting: (categoryId, setting) =>
        set((s) => ({ categorySettings: { ...s.categorySettings, [categoryId]: setting } })),

      setDefaultChannelSetting: (setting) => set({ defaultChannelSetting: setting }),

      muteChannel: (channelId, untilMs) =>
        set((s) => ({ mutedChannels: { ...s.mutedChannels, [channelId]: untilMs } })),

      unmuteChannel: (channelId) =>
        set((s) => {
          const next = { ...s.mutedChannels };
          delete next[channelId];
          return { mutedChannels: next };
        }),

      muteCategory: (categoryId, untilMs) =>
        set((s) => ({ mutedCategories: { ...s.mutedCategories, [categoryId]: untilMs } })),

      unmuteCategory: (categoryId) =>
        set((s) => {
          const next = { ...s.mutedCategories };
          delete next[categoryId];
          return { mutedCategories: next };
        }),

      muteUser: (userId) =>
        set((s) => ({ mutedUsers: s.mutedUsers.includes(userId) ? s.mutedUsers : [...s.mutedUsers, userId] })),

      unmuteUser: (userId) =>
        set((s) => ({ mutedUsers: s.mutedUsers.filter((id) => id !== userId) })),

      setMuteChannelMentions: (channelId, muted) =>
        set((s) => ({ mutedMentionChannels: { ...s.mutedMentionChannels, [channelId]: muted } })),

      setMuteCategoryMentions: (categoryId, muted) =>
        set((s) => ({ mutedMentionCategories: { ...s.mutedMentionCategories, [categoryId]: muted } })),

      isChannelMuted: (channelId) => {
        const until = get().mutedChannels[channelId];
        if (until === undefined) return false;
        if (until === -1) return true;
        return Date.now() < until;
      },

      isCategoryMuted: (categoryId) => {
        const until = get().mutedCategories[categoryId];
        if (until === undefined) return false;
        if (until === -1) return true;
        return Date.now() < until;
      },

      isUserMuted: (userId) => get().mutedUsers.includes(userId),

      isChannelMentionMuted:  (channelId)  => get().mutedMentionChannels[channelId]   === true,
      isCategoryMentionMuted: (categoryId) => get().mutedMentionCategories[categoryId] === true,

      getEffectiveChannelSetting: (channelId, categoryId) => {
        const channelPref = get().channelSettings[channelId] ?? "default";
        if (channelPref !== "default") return channelPref;
        if (categoryId) {
          const catPref = get().categorySettings[categoryId];
          if (catPref) return catPref;
        }
        return get().defaultChannelSetting;
      },
    }),
    {
      name: "flux-notif-prefs",
      partialize: (state) => ({
        channelSettings:        state.channelSettings,
        categorySettings:       state.categorySettings,
        mutedChannels:          state.mutedChannels,
        mutedCategories:        state.mutedCategories,
        mutedUsers:             state.mutedUsers,
        mutedMentionChannels:   state.mutedMentionChannels,
        mutedMentionCategories: state.mutedMentionCategories,
        defaultChannelSetting:  state.defaultChannelSetting,
      }),
    }
  )
);
