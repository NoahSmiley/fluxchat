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
      loadingMessages: false,
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

  it("room_created adds channel to list", () => {
    const handler = eventHandler;
    const newRoom = {
      id: "room1",
      serverId: "s1",
      name: "Chill Room",
      type: "voice",
      isRoom: 1,
      isLocked: 0,
      creatorId: "u1",
      parentId: null,
      position: 5,
      bitrate: null,
      createdAt: "2024-01-01",
    };

    handler({ type: "room_created", channel: newRoom });

    const channels = useChatStore.getState().channels;
    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe("room1");
    expect(channels[0].name).toBe("Chill Room");
  });

  it("room_created for different server is ignored", () => {
    const handler = eventHandler;
    const otherRoom = {
      id: "room2",
      serverId: "other-server",
      name: "Other Room",
      type: "voice",
      isRoom: 1,
      isLocked: 0,
    };

    handler({ type: "room_created", channel: otherRoom });

    expect(useChatStore.getState().channels).toHaveLength(0);
  });

  it("room_deleted removes channel", () => {
    useChatStore.setState({
      channels: [
        { id: "ch-text", serverId: "s1", name: "general", type: "text", position: 0, createdAt: "2024-01-01" } as any,
        { id: "room1", serverId: "s1", name: "Room", type: "voice", isRoom: 1, position: 5, createdAt: "2024-01-01" } as any,
      ],
    });

    const handler = eventHandler;
    handler({ type: "room_deleted", channelId: "room1", serverId: "s1" });

    const channels = useChatStore.getState().channels;
    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe("ch-text");
  });

  it("room_deleted switches active channel if deleted was active", () => {
    useChatStore.setState({
      activeChannelId: "room1",
      channels: [
        { id: "ch-text", serverId: "s1", name: "general", type: "text", position: 0, createdAt: "2024-01-01" } as any,
        { id: "room1", serverId: "s1", name: "Room", type: "voice", isRoom: 1, position: 5, createdAt: "2024-01-01" } as any,
      ],
      messages: [{ id: "msg1" }] as any,
    });

    const handler = eventHandler;
    handler({ type: "room_deleted", channelId: "room1", serverId: "s1" });

    expect(useChatStore.getState().activeChannelId).toBe("ch-text");
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("room_lock_toggled updates isLocked", () => {
    useChatStore.setState({
      channels: [
        { id: "room1", serverId: "s1", name: "Room", type: "voice", isRoom: 1, isLocked: false } as any,
      ],
    });

    const handler = eventHandler;
    handler({ type: "room_lock_toggled", channelId: "room1", serverId: "s1", isLocked: true });

    expect(useChatStore.getState().channels[0].isLocked).toBe(true);
  });
});
