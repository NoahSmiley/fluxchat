import { create } from "zustand";
import type { Server, Channel, Message, MemberWithUser, DMMessage } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../lib/broadcast.js";
import { playMessageSound, showDesktopNotification } from "../lib/notifications.js";

interface ChatState {
  servers: (Server & { role: string })[];
  channels: Channel[];
  messages: Message[];
  members: MemberWithUser[];
  onlineUsers: Set<string>;
  activeServerId: string | null;
  activeChannelId: string | null;
  hasMoreMessages: boolean;
  messageCursor: string | null;
  loadingServers: boolean;
  loadingMessages: boolean;
  channelsLoaded: boolean;

  // Reactions: messageId -> grouped reactions
  reactions: Record<string, { emoji: string; userIds: string[] }[]>;

  // Search
  searchQuery: string;
  searchResults: Message[] | null;

  // DMs
  showingDMs: boolean;
  dmChannels: { id: string; otherUser: { id: string; username: string; image: string | null }; createdAt: string }[];
  activeDMChannelId: string | null;
  dmMessages: DMMessage[];
  dmHasMore: boolean;
  dmCursor: string | null;

  loadServers: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  sendMessage: (content: string) => void;
  editMessage: (messageId: string, newContent: string) => void;
  createServer: (name: string) => Promise<void>;
  joinServer: (inviteCode: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  searchMessages: (query: string) => Promise<void>;
  clearSearch: () => void;
  showDMs: () => void;
  loadDMChannels: () => Promise<void>;
  selectDM: (dmChannelId: string) => Promise<void>;
  openDM: (userId: string) => Promise<void>;
  sendDM: (content: string) => void;
  loadMoreDMMessages: () => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  servers: [],
  channels: [],
  messages: [],
  members: [],
  onlineUsers: new Set(),
  activeServerId: null,
  activeChannelId: null,
  hasMoreMessages: false,
  messageCursor: null,
  loadingServers: false,
  loadingMessages: false,
  channelsLoaded: false,
  reactions: {},
  searchQuery: "",
  searchResults: null,
  showingDMs: false,
  dmChannels: [],
  activeDMChannelId: null,
  dmMessages: [],
  dmHasMore: false,
  dmCursor: null,

  loadServers: async () => {
    set({ loadingServers: true });
    try {
      const servers = await api.getServers();
      set({ servers, loadingServers: false });
    } catch {
      set({ loadingServers: false });
    }
  },

  selectServer: async (serverId) => {
    set({
      activeServerId: serverId,
      activeChannelId: null,
      showingDMs: false,
      activeDMChannelId: null,
      channels: [],
      messages: [],
      members: [],
      reactions: {},
      searchQuery: "",
      searchResults: null,
      dmMessages: [],
      channelsLoaded: false,
    });
    const [channels, members] = await Promise.all([
      api.getChannels(serverId),
      api.getServerMembers(serverId),
    ]);
    set({ channels, members, channelsLoaded: true });

    // Auto-select first text channel
    const textChannel = channels.find((c) => c.type === "text");
    if (textChannel) {
      get().selectChannel(textChannel.id);
    }
  },

  selectChannel: async (channelId) => {
    const prevChannel = get().activeChannelId;
    if (prevChannel) {
      gateway.send({ type: "leave_channel", channelId: prevChannel });
    }

    const channel = get().channels.find((c) => c.id === channelId);

    set({
      activeChannelId: channelId,
      activeDMChannelId: null,
      messages: [],
      hasMoreMessages: false,
      messageCursor: null,
      loadingMessages: false,
      reactions: {},
      searchQuery: "",
      searchResults: null,
      dmMessages: [],
    });

    gateway.send({ type: "join_channel", channelId });

    // Only fetch messages for text channels
    if (channel?.type === "text") {
      set({ loadingMessages: true });
      try {
        const result = await api.getMessages(channelId);
        set({
          messages: result.items,
          hasMoreMessages: result.hasMore,
          messageCursor: result.cursor,
          loadingMessages: false,
        });

        // Load reactions for the fetched messages
        if (result.items.length > 0) {
          try {
            const reactionItems = await api.getReactions(result.items.map((m) => m.id));
            const grouped: Record<string, { emoji: string; userIds: string[] }[]> = {};
            for (const r of reactionItems) {
              if (!grouped[r.messageId]) grouped[r.messageId] = [];
              const existing = grouped[r.messageId].find((g) => g.emoji === r.emoji);
              if (existing) {
                existing.userIds.push(r.userId);
              } else {
                grouped[r.messageId].push({ emoji: r.emoji, userIds: [r.userId] });
              }
            }
            set({ reactions: grouped });
          } catch { /* non-critical */ }
        }
      } catch {
        set({ loadingMessages: false });
      }
    }
  },

  loadMoreMessages: async () => {
    const { activeChannelId, messageCursor, hasMoreMessages, loadingMessages } = get();
    if (!activeChannelId || !hasMoreMessages || loadingMessages) return;

    set({ loadingMessages: true });
    try {
      const result = await api.getMessages(activeChannelId, messageCursor ?? undefined);
      set((state) => ({
        messages: [...result.items, ...state.messages],
        hasMoreMessages: result.hasMore,
        messageCursor: result.cursor,
        loadingMessages: false,
      }));
    } catch {
      set({ loadingMessages: false });
    }
  },

  sendMessage: (content) => {
    const { activeChannelId } = get();
    if (!activeChannelId || !content.trim()) return;

    gateway.send({
      type: "send_message",
      channelId: activeChannelId,
      ciphertext: btoa(content),
      mlsEpoch: 0,
    });
  },

  editMessage: (messageId, newContent) => {
    if (!newContent.trim()) return;
    gateway.send({
      type: "edit_message",
      messageId,
      ciphertext: btoa(newContent),
    });
  },

  createServer: async (name) => {
    const server = await api.createServer({ name });
    set((state) => ({ servers: [...state.servers, { ...server, role: "owner" }] }));
  },

  joinServer: async (inviteCode) => {
    const server = await api.joinServer(inviteCode);
    set((state) => ({ servers: [...state.servers, { ...server, role: "member" }] }));
  },

  addReaction: (messageId, emoji) => {
    gateway.send({ type: "add_reaction", messageId, emoji });
  },

  removeReaction: (messageId, emoji) => {
    gateway.send({ type: "remove_reaction", messageId, emoji });
  },

  searchMessages: async (query) => {
    const { activeChannelId } = get();
    if (!activeChannelId || !query.trim()) return;
    set({ searchQuery: query });
    try {
      const result = await api.searchMessages(activeChannelId, query);
      set({ searchResults: result.items });
    } catch {
      set({ searchResults: [] });
    }
  },

  clearSearch: () => {
    set({ searchQuery: "", searchResults: null });
  },

  showDMs: () => {
    const prevChannel = get().activeChannelId;
    if (prevChannel) {
      gateway.send({ type: "leave_channel", channelId: prevChannel });
    }
    set({
      showingDMs: true,
      activeServerId: null,
      activeChannelId: null,
      channels: [],
      messages: [],
      members: [],
      reactions: {},
      searchQuery: "",
      searchResults: null,
    });
    get().loadDMChannels();
  },

  loadDMChannels: async () => {
    try {
      const dmChannels = await api.getDMChannels();
      set({ dmChannels });
    } catch {
      // ignore
    }
  },

  selectDM: async (dmChannelId) => {
    const prevChannel = get().activeChannelId;
    if (prevChannel) {
      gateway.send({ type: "leave_channel", channelId: prevChannel });
    }
    const prevDM = get().activeDMChannelId;
    if (prevDM) {
      gateway.send({ type: "leave_dm", dmChannelId: prevDM });
    }

    set({
      activeDMChannelId: dmChannelId,
      activeServerId: null,
      activeChannelId: null,
      channels: [],
      messages: [],
      members: [],
      reactions: {},
      searchQuery: "",
      searchResults: null,
      dmMessages: [],
      dmHasMore: false,
      dmCursor: null,
      loadingMessages: true,
    });

    gateway.send({ type: "join_dm", dmChannelId });

    try {
      const result = await api.getDMMessages(dmChannelId);
      set({
        dmMessages: result.items,
        dmHasMore: result.hasMore,
        dmCursor: result.cursor,
        loadingMessages: false,
      });
    } catch {
      set({ loadingMessages: false });
    }
  },

  openDM: async (userId) => {
    try {
      const dm = await api.createDM(userId);
      set((state) => {
        const exists = state.dmChannels.some((d) => d.id === dm.id);
        return { dmChannels: exists ? state.dmChannels : [...state.dmChannels, dm] };
      });
      get().selectDM(dm.id);
    } catch {
      // ignore
    }
  },

  sendDM: (content) => {
    const { activeDMChannelId } = get();
    if (!activeDMChannelId || !content.trim()) return;

    gateway.send({
      type: "send_dm",
      dmChannelId: activeDMChannelId,
      ciphertext: btoa(content),
      mlsEpoch: 0,
    });
  },

  loadMoreDMMessages: async () => {
    const { activeDMChannelId, dmCursor, dmHasMore, loadingMessages } = get();
    if (!activeDMChannelId || !dmHasMore || loadingMessages) return;

    set({ loadingMessages: true });
    try {
      const result = await api.getDMMessages(activeDMChannelId, dmCursor ?? undefined);
      set((state) => ({
        dmMessages: [...result.items, ...state.dmMessages],
        dmHasMore: result.hasMore,
        dmCursor: result.cursor,
        loadingMessages: false,
      }));
    } catch {
      set({ loadingMessages: false });
    }
  },
}));

// Helper to get username map
export function getUsernameMap(members: MemberWithUser[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of members) {
    map[m.userId] = m.username;
  }
  return map;
}

// Helper to get image map
export function getUserImageMap(members: MemberWithUser[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const m of members) {
    map[m.userId] = m.image;
  }
  return map;
}

// Lazy ref to auth store to avoid circular imports
let authStoreRef: typeof import("../stores/auth.js").useAuthStore | null = null;
import("../stores/auth.js").then((m) => { authStoreRef = m.useAuthStore; });

// On WS connect/reconnect: clear stale presence, mark self online
gateway.onConnect(() => {
  const user = authStoreRef?.getState()?.user;
  useChatStore.setState({
    onlineUsers: new Set(user ? [user.id] : []),
  });
});

// Listen for WebSocket events
gateway.on((event) => {
  const state = useChatStore.getState();

  switch (event.type) {
    case "message": {
      if (event.message.channelId === state.activeChannelId) {
        useChatStore.setState((s) => ({
          messages: [...s.messages, event.message],
        }));
      }
      // Notification for messages not in active channel or when window unfocused
      const authUser = authStoreRef?.getState()?.user;
      if (authUser && event.message.senderId !== authUser.id) {
        if (event.message.channelId !== state.activeChannelId || !document.hasFocus()) {
          const usernameMap = getUsernameMap(state.members);
          const senderName = usernameMap[event.message.senderId] ?? "Someone";
          let text: string;
          try { text = atob(event.message.ciphertext); } catch { text = "New message"; }
          playMessageSound();
          showDesktopNotification(senderName, text);
        }
      }
      break;
    }

    case "presence":
      useChatStore.setState((s) => {
        const newSet = new Set(s.onlineUsers);
        if (event.status === "online") {
          newSet.add(event.userId);
        } else {
          newSet.delete(event.userId);
        }
        return { onlineUsers: newSet };
      });
      break;

    case "message_edit": {
      useChatStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === event.messageId
            ? { ...m, ciphertext: event.ciphertext, editedAt: event.editedAt }
            : m
        ),
        searchResults: s.searchResults?.map((m) =>
          m.id === event.messageId
            ? { ...m, ciphertext: event.ciphertext, editedAt: event.editedAt }
            : m
        ) ?? null,
      }));
      break;
    }

    case "reaction_add":
      useChatStore.setState((s) => {
        const reactions = { ...s.reactions };
        const groups = reactions[event.messageId] ? [...reactions[event.messageId]] : [];
        const existing = groups.find((g) => g.emoji === event.emoji);
        if (existing) {
          if (!existing.userIds.includes(event.userId)) {
            const idx = groups.indexOf(existing);
            groups[idx] = { ...existing, userIds: [...existing.userIds, event.userId] };
          }
        } else {
          groups.push({ emoji: event.emoji, userIds: [event.userId] });
        }
        reactions[event.messageId] = groups;
        return { reactions };
      });
      break;

    case "reaction_remove":
      useChatStore.setState((s) => {
        const reactions = { ...s.reactions };
        const groups = reactions[event.messageId];
        if (!groups) return s;
        const updated = groups
          .map((g) =>
            g.emoji === event.emoji
              ? { ...g, userIds: g.userIds.filter((id) => id !== event.userId) }
              : g
          )
          .filter((g) => g.userIds.length > 0);
        reactions[event.messageId] = updated;
        return { reactions };
      });
      break;

    case "member_joined": {
      if (event.serverId === state.activeServerId) {
        const alreadyExists = state.members.some((m) => m.userId === event.userId);
        if (!alreadyExists) {
          useChatStore.setState((s) => ({
            members: [...s.members, {
              userId: event.userId,
              serverId: event.serverId,
              username: event.username,
              image: event.image,
              role: event.role as "owner" | "admin" | "member",
              joinedAt: new Date().toISOString(),
            }],
          }));
        }
      }
      break;
    }

    case "channel_update": {
      useChatStore.setState((s) => ({
        channels: s.channels.map((c) =>
          c.id === event.channelId ? { ...c, bitrate: event.bitrate } : c
        ),
      }));
      // Apply bitrate change if connected to this voice channel
      import("./voice.js").then((mod) => {
        const voiceState = mod.useVoiceStore.getState();
        if (voiceState.connectedChannelId === event.channelId && event.bitrate != null) {
          voiceState.applyBitrate(event.bitrate);
        }
      });
      break;
    }

    case "profile_update": {
      useChatStore.setState((s) => ({
        members: s.members.map((m) =>
          m.userId === event.userId
            ? {
                ...m,
                ...(event.username !== undefined ? { username: event.username } : {}),
                ...(event.image !== undefined ? { image: event.image } : {}),
              }
            : m
        ),
      }));
      break;
    }

    case "dm_message": {
      if (event.message.dmChannelId === state.activeDMChannelId) {
        useChatStore.setState((s) => ({
          dmMessages: [...s.dmMessages, event.message],
        }));
      }
      // DM notification
      const dmAuthUser = authStoreRef?.getState()?.user;
      if (dmAuthUser && event.message.senderId !== dmAuthUser.id) {
        if (event.message.dmChannelId !== state.activeDMChannelId || !document.hasFocus()) {
          const dm = state.dmChannels.find((d) => d.id === event.message.dmChannelId);
          const senderName = dm?.otherUser.username ?? "Someone";
          let text: string;
          try { text = atob(event.message.ciphertext); } catch { text = "New message"; }
          playMessageSound();
          showDesktopNotification(senderName, text);
        }
      }
      break;
    }
  }
});

// ── BroadcastChannel: publish state to popout windows ──

if (!isPopout()) {
  useChatStore.subscribe((state) => {
    const channel = state.channels.find((c) => c.id === state.activeChannelId);
    broadcastState({
      type: "chat-state",
      messages: state.messages,
      activeChannelId: state.activeChannelId,
      channelName: channel?.name ?? null,
    });
  });

  onCommand((cmd) => {
    if (cmd.type === "send-message") {
      useChatStore.getState().sendMessage(cmd.content);
    }
    if (cmd.type === "request-state") {
      const state = useChatStore.getState();
      const channel = state.channels.find((c) => c.id === state.activeChannelId);
      broadcastState({
        type: "chat-state",
        messages: state.messages,
        activeChannelId: state.activeChannelId,
        channelName: channel?.name ?? null,
      });
    }
  });
}
