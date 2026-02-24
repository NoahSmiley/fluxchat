import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChatStore, getUsernameMap, getUserImageMap, getUserRoleMap } from "../chat/index.js";

// Mock dependencies
vi.mock("../../lib/api/index.js", () => ({
  getServers: vi.fn(),
  getChannels: vi.fn(),
  getServerMembers: vi.fn(),
  getMessages: vi.fn(),
  getReactions: vi.fn(),
  searchServerMessages: vi.fn(),
  getDMChannels: vi.fn(),
  getDMMessages: vi.fn(),
  createDM: vi.fn(),
  searchDMMessages: vi.fn(),
  updateServer: vi.fn(),
  leaveServer: vi.fn(),
  uploadFile: vi.fn(),
  getStoredToken: vi.fn(() => null),
  setStoredToken: vi.fn(),
  // Also needed by auth.ts which auto-initializes on import
  getSession: vi.fn(() => Promise.resolve(null)),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock("../../lib/ws.js", () => ({
  gateway: {
    send: vi.fn(),
    on: vi.fn(),
    onConnect: vi.fn(),
  },
}));

vi.mock("../../lib/broadcast.js", () => ({
  broadcastState: vi.fn(),
  onCommand: vi.fn(),
  isPopout: vi.fn(() => true),
}));

vi.mock("../../lib/notifications.js", () => ({
  playMessageSound: vi.fn(),
  showDesktopNotification: vi.fn(),
}));

vi.mock("../crypto.js", () => ({
  useCryptoStore: {
    getState: vi.fn(() => ({
      keyPair: null,
      initialize: vi.fn(),
      getDMKey: vi.fn(),
      encryptMessage: vi.fn(),
      decryptMessage: vi.fn(() => "[encrypted]"),
      handleKeyRequested: vi.fn(),
      handleKeyShared: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../ui.js", () => ({
  useUIStore: {
    getState: vi.fn(() => ({
      hideEconomy: vi.fn(),
    })),
  },
}));

vi.mock("../../lib/serverUrl.js", () => ({
  API_BASE: "/api",
  getGatewayUrl: vi.fn(() => "ws://localhost:3001/gateway"),
}));

vi.mock("../dm.js", () => ({
  useDMStore: {
    getState: vi.fn(() => ({
      showingDMs: false,
      activeDMChannelId: null,
      dmChannels: [],
      dmMessages: [],
      loadDMChannels: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

import * as api from "../../lib/api/index.js";
import { gateway } from "../../lib/ws.js";

const mockedApi = vi.mocked(api);
const mockedGateway = vi.mocked(gateway);

describe("useChatStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChatStore.setState({
      servers: [],
      channels: [],
      messages: [],
      members: [],
      onlineUsers: new Set(),
      userStatuses: {},
      userActivities: {},
      activeServerId: null,
      activeChannelId: null,
      hasMoreMessages: false,
      messageCursor: null,
      loadingServers: false,
      loadingMessages: false,
      channelsLoaded: false,
      reactions: {},
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
      pendingAttachments: [],
      uploadProgress: {},
      decryptedCache: {},
      unreadChannels: new Set(),
      mentionCounts: {},
      typingUsers: {},
      customEmojis: [],
    });
  });

  it("loadServers populates servers array", async () => {
    const mockServers = [
      { id: "s1", name: "Server 1", ownerId: "u1", inviteCode: "abc", createdAt: "2024-01-01", role: "owner" },
      { id: "s2", name: "Server 2", ownerId: "u2", inviteCode: "def", createdAt: "2024-01-01", role: "member" },
    ];
    mockedApi.getServers.mockResolvedValue(mockServers);

    await useChatStore.getState().loadServers();

    expect(useChatStore.getState().servers).toEqual(mockServers);
    expect(useChatStore.getState().loadingServers).toBe(false);
  });

  it("sendMessage calls gateway.send with correct payload", () => {
    useChatStore.setState({ activeChannelId: "ch1", pendingAttachments: [] });

    useChatStore.getState().sendMessage("Hello world");

    expect(mockedGateway.send).toHaveBeenCalledWith({
      type: "send_message",
      channelId: "ch1",
      content: "Hello world",
    });
  });

  it("sendMessage does nothing without active channel", () => {
    useChatStore.setState({ activeChannelId: null });

    useChatStore.getState().sendMessage("Hello");

    expect(mockedGateway.send).not.toHaveBeenCalled();
  });

  it("sendMessage does nothing with empty content and no attachments", () => {
    useChatStore.setState({ activeChannelId: "ch1", pendingAttachments: [] });

    useChatStore.getState().sendMessage("   ");

    expect(mockedGateway.send).not.toHaveBeenCalled();
  });

  it("editMessage sends edit via gateway", () => {
    useChatStore.getState().editMessage("msg1", "Updated content");

    expect(mockedGateway.send).toHaveBeenCalledWith({
      type: "edit_message",
      messageId: "msg1",
      content: "Updated content",
    });
  });

  it("deleteMessage sends delete via gateway", () => {
    useChatStore.getState().deleteMessage("msg1");

    expect(mockedGateway.send).toHaveBeenCalledWith({
      type: "delete_message",
      messageId: "msg1",
    });
  });

  it("addReaction sends reaction via gateway", () => {
    useChatStore.getState().addReaction("msg1", "👍");

    expect(mockedGateway.send).toHaveBeenCalledWith({
      type: "add_reaction",
      messageId: "msg1",
      emoji: "👍",
    });
  });

  it("clearSearch resets search state", () => {
    useChatStore.setState({
      searchQuery: "hello",
      searchFilters: { fromUserId: "u1" },
      searchResults: [],
    });

    useChatStore.getState().clearSearch();

    expect(useChatStore.getState().searchQuery).toBe("");
    expect(useChatStore.getState().searchFilters).toEqual({});
    expect(useChatStore.getState().searchResults).toBeNull();
  });

  it("unread tracking clears on channel select", async () => {
    useChatStore.setState({
      activeServerId: "s1",
      channels: [{ id: "ch1", name: "general", serverId: "s1", type: "text" as const, bitrate: null, parentId: null, position: 0, isRoom: false, creatorId: null, isLocked: false, createdAt: "2024-01-01" }],
      unreadChannels: new Set(["ch1", "ch2"]),
    });
    mockedApi.getMessages.mockResolvedValue({ items: [], hasMore: false, cursor: null });

    await useChatStore.getState().selectChannel("ch1");

    expect(useChatStore.getState().unreadChannels.has("ch1")).toBe(false);
    expect(useChatStore.getState().unreadChannels.has("ch2")).toBe(true);
  });

  it("setMyStatus sends status update via gateway", () => {
    useChatStore.getState().setMyStatus("idle");

    expect(mockedGateway.send).toHaveBeenCalledWith({
      type: "update_status",
      status: "idle",
    });
  });
});

describe("chat store helper functions", () => {
  const members = [
    { userId: "u1", serverId: "s1", username: "alice", image: "a.png", role: "owner" as const, joinedAt: "2024-01-01", ringStyle: "default" as const, ringSpin: false, steamId: null, ringPatternSeed: null, bannerCss: null, bannerPatternSeed: null },
    { userId: "u2", serverId: "s1", username: "bob", image: null, role: "member" as const, joinedAt: "2024-01-01", ringStyle: "default" as const, ringSpin: false, steamId: null, ringPatternSeed: null, bannerCss: null, bannerPatternSeed: null },
  ];

  it("getUsernameMap returns userId->username mapping", () => {
    const map = getUsernameMap(members);
    expect(map).toEqual({ u1: "alice", u2: "bob" });
  });

  it("getUserImageMap returns userId->image mapping", () => {
    const map = getUserImageMap(members);
    expect(map).toEqual({ u1: "a.png", u2: null });
  });

  it("getUserRoleMap returns userId->role mapping", () => {
    const map = getUserRoleMap(members);
    expect(map).toEqual({ u1: "owner", u2: "member" });
  });
});
