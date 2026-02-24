import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (same pattern as chat.test.ts) ──

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
  getSession: vi.fn(() => Promise.resolve(null)),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn(),
}));

const { mockGatewayOn } = vi.hoisted(() => ({
  mockGatewayOn: vi.fn(),
}));
vi.mock("../../lib/ws.js", () => ({
  gateway: {
    send: vi.fn(),
    on: mockGatewayOn,
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

vi.mock("../dm/store.js", () => ({
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

// Mock the voice store dynamic import used by room_knock_accepted and room_force_move
const { mockJoinVoiceChannel } = vi.hoisted(() => ({
  mockJoinVoiceChannel: vi.fn(),
}));
vi.mock("../voice/store.js", () => ({
  useVoiceStore: {
    getState: vi.fn(() => ({
      joinVoiceChannel: mockJoinVoiceChannel,
    })),
  },
}));

import { useChatStore } from "@/stores/chat/index.js";

// Capture the event handler registered at module load time BEFORE clearAllMocks
let eventHandler: (event: Record<string, unknown>) => void;
{
  const calls = mockGatewayOn.mock.calls;
  for (const call of calls) {
    if (typeof call[0] === "function") {
      eventHandler = call[0];
      break;
    }
  }
  if (!eventHandler!) {
    throw new Error("Event handler not registered on gateway.on during module load");
  }
}

describe("chat store room event handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJoinVoiceChannel.mockReset();
    useChatStore.setState({
      servers: [],
      channels: [],
      messages: [],
      members: [],
      onlineUsers: new Set(),
      userStatuses: {},
      userActivities: {},
      activeServerId: "s1",
      activeChannelId: "ch-text",
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
      typingUsers: {},
      roomKnocks: [],
      roomInvites: [],
    });
  });

  it("room_knock adds to roomKnocks", () => {
    vi.useFakeTimers();
    try {
      const handler = eventHandler;
      handler({
        type: "room_knock",
        channelId: "room1",
        userId: "knocker1",
        username: "knocker",
      });

      const knocks = useChatStore.getState().roomKnocks;
      expect(knocks).toHaveLength(1);
      expect(knocks[0].channelId).toBe("room1");
      expect(knocks[0].userId).toBe("knocker1");
      expect(knocks[0].username).toBe("knocker");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismissKnock removes from roomKnocks", () => {
    useChatStore.setState({
      roomKnocks: [
        { channelId: "room1", userId: "u1", username: "alice", timestamp: 1000 },
        { channelId: "room2", userId: "u2", username: "bob", timestamp: 2000 },
      ],
    });

    useChatStore.getState().dismissKnock(1000);

    const knocks = useChatStore.getState().roomKnocks;
    expect(knocks).toHaveLength(1);
    expect(knocks[0].timestamp).toBe(2000);
  });

  it("room_invite adds to roomInvites", () => {
    vi.useFakeTimers();
    try {
      const handler = eventHandler;
      handler({
        type: "room_invite",
        channelId: "room1",
        channelName: "Fun Room",
        inviterUsername: "alice",
        serverId: "s1",
      });

      const invites = useChatStore.getState().roomInvites;
      expect(invites).toHaveLength(1);
      expect(invites[0].channelId).toBe("room1");
      expect(invites[0].channelName).toBe("Fun Room");
      expect(invites[0].inviterUsername).toBe("alice");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismissRoomInvite removes from roomInvites", () => {
    useChatStore.setState({
      roomInvites: [
        { channelId: "room1", channelName: "Room A", inviterUsername: "alice", serverId: "s1", timestamp: 1000 },
        { channelId: "room2", channelName: "Room B", inviterUsername: "bob", serverId: "s1", timestamp: 2000 },
      ],
    });

    useChatStore.getState().dismissRoomInvite(1000);

    const invites = useChatStore.getState().roomInvites;
    expect(invites).toHaveLength(1);
    expect(invites[0].timestamp).toBe(2000);
  });

  it("room_force_move calls joinVoiceChannel", async () => {
    const handler = eventHandler;
    handler({
      type: "room_force_move",
      targetChannelId: "room2",
      targetChannelName: "Room 2",
    });

    // The handler uses dynamic import, so we need to wait a tick
    await vi.waitFor(() => {
      expect(mockJoinVoiceChannel).toHaveBeenCalledWith("room2");
    });
  });
});
