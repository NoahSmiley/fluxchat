import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotifStore } from "../notifications.js";

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

  // ── Default values ──

  describe("default values", () => {
    it("defaultChannelSetting defaults to only_mentions", () => {
      expect(useNotifStore.getState().defaultChannelSetting).toBe("only_mentions");
    });

    it("channelSettings defaults to empty object", () => {
      expect(useNotifStore.getState().channelSettings).toEqual({});
    });

    it("categorySettings defaults to empty object", () => {
      expect(useNotifStore.getState().categorySettings).toEqual({});
    });

    it("mutedChannels defaults to empty object", () => {
      expect(useNotifStore.getState().mutedChannels).toEqual({});
    });

    it("mutedCategories defaults to empty object", () => {
      expect(useNotifStore.getState().mutedCategories).toEqual({});
    });

    it("mutedUsers defaults to empty array", () => {
      expect(useNotifStore.getState().mutedUsers).toEqual([]);
    });

    it("mutedMentionChannels defaults to empty object", () => {
      expect(useNotifStore.getState().mutedMentionChannels).toEqual({});
    });

    it("mutedMentionCategories defaults to empty object", () => {
      expect(useNotifStore.getState().mutedMentionCategories).toEqual({});
    });
  });

  // ── setChannelSetting / channelSettings ──

  describe("setChannelSetting", () => {
    it("sets a channel notification level", () => {
      useNotifStore.getState().setChannelSetting("ch1", "all");
      expect(useNotifStore.getState().channelSettings["ch1"]).toBe("all");
    });

    it("overwrites an existing channel setting", () => {
      useNotifStore.getState().setChannelSetting("ch1", "all");
      useNotifStore.getState().setChannelSetting("ch1", "none");
      expect(useNotifStore.getState().channelSettings["ch1"]).toBe("none");
    });

    it("preserves other channel settings", () => {
      useNotifStore.getState().setChannelSetting("ch1", "all");
      useNotifStore.getState().setChannelSetting("ch2", "none");
      expect(useNotifStore.getState().channelSettings["ch1"]).toBe("all");
      expect(useNotifStore.getState().channelSettings["ch2"]).toBe("none");
    });

    it("supports the default value", () => {
      useNotifStore.getState().setChannelSetting("ch1", "default");
      expect(useNotifStore.getState().channelSettings["ch1"]).toBe("default");
    });
  });

  // ── setCategorySetting / categorySettings ──

  describe("setCategorySetting", () => {
    it("sets a category notification level", () => {
      useNotifStore.getState().setCategorySetting("cat1", "all");
      expect(useNotifStore.getState().categorySettings["cat1"]).toBe("all");
    });

    it("overwrites an existing category setting", () => {
      useNotifStore.getState().setCategorySetting("cat1", "all");
      useNotifStore.getState().setCategorySetting("cat1", "only_mentions");
      expect(useNotifStore.getState().categorySettings["cat1"]).toBe("only_mentions");
    });

    it("preserves other category settings", () => {
      useNotifStore.getState().setCategorySetting("cat1", "all");
      useNotifStore.getState().setCategorySetting("cat2", "none");
      expect(useNotifStore.getState().categorySettings["cat1"]).toBe("all");
      expect(useNotifStore.getState().categorySettings["cat2"]).toBe("none");
    });
  });

  // ── setDefaultChannelSetting ──

  describe("setDefaultChannelSetting", () => {
    it("changes the global default", () => {
      useNotifStore.getState().setDefaultChannelSetting("all");
      expect(useNotifStore.getState().defaultChannelSetting).toBe("all");
    });

    it("can set to none", () => {
      useNotifStore.getState().setDefaultChannelSetting("none");
      expect(useNotifStore.getState().defaultChannelSetting).toBe("none");
    });
  });

  // ── muteChannel / unmuteChannel / isChannelMuted ──

  describe("channel muting", () => {
    it("muteChannel with indefinite duration", () => {
      useNotifStore.getState().muteChannel("ch1", -1);
      expect(useNotifStore.getState().isChannelMuted("ch1")).toBe(true);
    });

    it("muteChannel with future timestamp", () => {
      const future = Date.now() + 60_000; // 1 minute from now
      useNotifStore.getState().muteChannel("ch1", future);
      expect(useNotifStore.getState().isChannelMuted("ch1")).toBe(true);
    });

    it("muteChannel with past timestamp is not muted", () => {
      const past = Date.now() - 60_000; // 1 minute ago
      useNotifStore.getState().muteChannel("ch1", past);
      expect(useNotifStore.getState().isChannelMuted("ch1")).toBe(false);
    });

    it("isChannelMuted returns false for unknown channel", () => {
      expect(useNotifStore.getState().isChannelMuted("unknown")).toBe(false);
    });

    it("unmuteChannel removes the mute", () => {
      useNotifStore.getState().muteChannel("ch1", -1);
      expect(useNotifStore.getState().isChannelMuted("ch1")).toBe(true);
      useNotifStore.getState().unmuteChannel("ch1");
      expect(useNotifStore.getState().isChannelMuted("ch1")).toBe(false);
    });

    it("unmuteChannel preserves other muted channels", () => {
      useNotifStore.getState().muteChannel("ch1", -1);
      useNotifStore.getState().muteChannel("ch2", -1);
      useNotifStore.getState().unmuteChannel("ch1");
      expect(useNotifStore.getState().isChannelMuted("ch1")).toBe(false);
      expect(useNotifStore.getState().isChannelMuted("ch2")).toBe(true);
    });
  });

  // ── muteCategory / unmuteCategory / isCategoryMuted ──

  describe("category muting", () => {
    it("muteCategory with indefinite duration", () => {
      useNotifStore.getState().muteCategory("cat1", -1);
      expect(useNotifStore.getState().isCategoryMuted("cat1")).toBe(true);
    });

    it("muteCategory with future timestamp", () => {
      const future = Date.now() + 60_000;
      useNotifStore.getState().muteCategory("cat1", future);
      expect(useNotifStore.getState().isCategoryMuted("cat1")).toBe(true);
    });

    it("muteCategory with past timestamp is not muted", () => {
      const past = Date.now() - 60_000;
      useNotifStore.getState().muteCategory("cat1", past);
      expect(useNotifStore.getState().isCategoryMuted("cat1")).toBe(false);
    });

    it("isCategoryMuted returns false for unknown category", () => {
      expect(useNotifStore.getState().isCategoryMuted("unknown")).toBe(false);
    });

    it("unmuteCategory removes the mute", () => {
      useNotifStore.getState().muteCategory("cat1", -1);
      useNotifStore.getState().unmuteCategory("cat1");
      expect(useNotifStore.getState().isCategoryMuted("cat1")).toBe(false);
    });

    it("unmuteCategory preserves other muted categories", () => {
      useNotifStore.getState().muteCategory("cat1", -1);
      useNotifStore.getState().muteCategory("cat2", -1);
      useNotifStore.getState().unmuteCategory("cat1");
      expect(useNotifStore.getState().isCategoryMuted("cat1")).toBe(false);
      expect(useNotifStore.getState().isCategoryMuted("cat2")).toBe(true);
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
