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
});
