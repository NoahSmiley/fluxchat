import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotifStore } from "@/stores/notifications.js";

describe("useNotifStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to clean initial state
    useNotifStore.setState({
      channelSettings: {},
      categorySettings: {},
      mutedChannels: {},
      mutedCategories: {},
      mutedUsers: [],
      mutedMentionChannels: {},
      mutedMentionCategories: {},
      defaultChannelSetting: "only_mentions",
    });
  });

  // ── muteUser / unmuteUser / isUserMuted ──

  describe("user muting", () => {
    it("muteUser adds user to muted list", () => {
      useNotifStore.getState().muteUser("u1");
      expect(useNotifStore.getState().isUserMuted("u1")).toBe(true);
    });

    it("muteUser does not duplicate user", () => {
      useNotifStore.getState().muteUser("u1");
      useNotifStore.getState().muteUser("u1");
      expect(useNotifStore.getState().mutedUsers).toEqual(["u1"]);
    });

    it("isUserMuted returns false for unknown user", () => {
      expect(useNotifStore.getState().isUserMuted("unknown")).toBe(false);
    });

    it("unmuteUser removes user from muted list", () => {
      useNotifStore.getState().muteUser("u1");
      useNotifStore.getState().unmuteUser("u1");
      expect(useNotifStore.getState().isUserMuted("u1")).toBe(false);
    });

    it("unmuteUser preserves other muted users", () => {
      useNotifStore.getState().muteUser("u1");
      useNotifStore.getState().muteUser("u2");
      useNotifStore.getState().unmuteUser("u1");
      expect(useNotifStore.getState().isUserMuted("u1")).toBe(false);
      expect(useNotifStore.getState().isUserMuted("u2")).toBe(true);
    });
  });

  // ── setMuteChannelMentions / isChannelMentionMuted ──

  describe("channel mention muting", () => {
    it("setMuteChannelMentions mutes mentions for a channel", () => {
      useNotifStore.getState().setMuteChannelMentions("ch1", true);
      expect(useNotifStore.getState().isChannelMentionMuted("ch1")).toBe(true);
    });

    it("setMuteChannelMentions can unmute mentions for a channel", () => {
      useNotifStore.getState().setMuteChannelMentions("ch1", true);
      useNotifStore.getState().setMuteChannelMentions("ch1", false);
      expect(useNotifStore.getState().isChannelMentionMuted("ch1")).toBe(false);
    });

    it("isChannelMentionMuted returns false for unknown channel", () => {
      expect(useNotifStore.getState().isChannelMentionMuted("unknown")).toBe(false);
    });

    it("preserves other channel mention settings", () => {
      useNotifStore.getState().setMuteChannelMentions("ch1", true);
      useNotifStore.getState().setMuteChannelMentions("ch2", false);
      expect(useNotifStore.getState().isChannelMentionMuted("ch1")).toBe(true);
      expect(useNotifStore.getState().isChannelMentionMuted("ch2")).toBe(false);
    });
  });

  // ── setMuteCategoryMentions / isCategoryMentionMuted ──

  describe("category mention muting", () => {
    it("setMuteCategoryMentions mutes mentions for a category", () => {
      useNotifStore.getState().setMuteCategoryMentions("cat1", true);
      expect(useNotifStore.getState().isCategoryMentionMuted("cat1")).toBe(true);
    });

    it("setMuteCategoryMentions can unmute mentions for a category", () => {
      useNotifStore.getState().setMuteCategoryMentions("cat1", true);
      useNotifStore.getState().setMuteCategoryMentions("cat1", false);
      expect(useNotifStore.getState().isCategoryMentionMuted("cat1")).toBe(false);
    });

    it("isCategoryMentionMuted returns false for unknown category", () => {
      expect(useNotifStore.getState().isCategoryMentionMuted("unknown")).toBe(false);
    });
  });

  // ── getEffectiveChannelSetting ──

  describe("getEffectiveChannelSetting", () => {
    it("returns global default when no channel or category setting", () => {
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1")
      ).toBe("only_mentions");
    });

    it("returns global default when channel is set to default and no category", () => {
      useNotifStore.getState().setChannelSetting("ch1", "default");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1")
      ).toBe("only_mentions");
    });

    it("returns channel setting when explicitly set (not default)", () => {
      useNotifStore.getState().setChannelSetting("ch1", "all");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1")
      ).toBe("all");
    });

    it("returns channel setting even if category is also set", () => {
      useNotifStore.getState().setChannelSetting("ch1", "none");
      useNotifStore.getState().setCategorySetting("cat1", "all");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1", "cat1")
      ).toBe("none");
    });

    it("falls back to category setting when channel is default", () => {
      useNotifStore.getState().setChannelSetting("ch1", "default");
      useNotifStore.getState().setCategorySetting("cat1", "all");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1", "cat1")
      ).toBe("all");
    });

    it("falls back to category setting when channel has no setting", () => {
      useNotifStore.getState().setCategorySetting("cat1", "none");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1", "cat1")
      ).toBe("none");
    });

    it("falls back to global default when channel is default and category is null", () => {
      useNotifStore.getState().setChannelSetting("ch1", "default");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1", null)
      ).toBe("only_mentions");
    });

    it("falls back to global default when channel is default and category has no setting", () => {
      useNotifStore.getState().setChannelSetting("ch1", "default");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1", "cat-no-setting")
      ).toBe("only_mentions");
    });

    it("respects changed global default", () => {
      useNotifStore.getState().setDefaultChannelSetting("all");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1")
      ).toBe("all");
    });

    it("full cascade: channel default -> category none -> global ignored", () => {
      useNotifStore.getState().setDefaultChannelSetting("all");
      useNotifStore.getState().setCategorySetting("cat1", "none");
      useNotifStore.getState().setChannelSetting("ch1", "default");
      expect(
        useNotifStore.getState().getEffectiveChannelSetting("ch1", "cat1")
      ).toBe("none");
    });
  });

  // ── Persistence ──

  describe("persistence", () => {
    it("store uses flux-notif-prefs as persistence key", () => {
      // Set some state to trigger persistence
      useNotifStore.getState().setChannelSetting("ch1", "all");
      useNotifStore.getState().muteUser("u1");

      // The persist middleware writes to localStorage under the configured name
      const stored = localStorage.getItem("flux-notif-prefs");
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.state.channelSettings).toEqual({ ch1: "all" });
      expect(parsed.state.mutedUsers).toEqual(["u1"]);
    });

    it("persists all partialized fields", () => {
      useNotifStore.getState().setChannelSetting("ch1", "all");
      useNotifStore.getState().setCategorySetting("cat1", "none");
      useNotifStore.getState().muteChannel("ch2", -1);
      useNotifStore.getState().muteCategory("cat2", -1);
      useNotifStore.getState().muteUser("u1");
      useNotifStore.getState().setMuteChannelMentions("ch3", true);
      useNotifStore.getState().setMuteCategoryMentions("cat3", true);
      useNotifStore.getState().setDefaultChannelSetting("all");

      const stored = localStorage.getItem("flux-notif-prefs");
      const parsed = JSON.parse(stored!);

      expect(parsed.state.channelSettings).toEqual({ ch1: "all" });
      expect(parsed.state.categorySettings).toEqual({ cat1: "none" });
      expect(parsed.state.mutedChannels).toEqual({ ch2: -1 });
      expect(parsed.state.mutedCategories).toEqual({ cat2: -1 });
      expect(parsed.state.mutedUsers).toEqual(["u1"]);
      expect(parsed.state.mutedMentionChannels).toEqual({ ch3: true });
      expect(parsed.state.mutedMentionCategories).toEqual({ cat3: true });
      expect(parsed.state.defaultChannelSetting).toBe("all");
    });
  });
});
