import { create } from "zustand";
import type { PresenceStatus } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import type { ChatState } from "./chat-types.js";
import { setupChatEvents } from "./chat-events.js";
import {
  cacheMessageContent,
  createSelectServerAction,
  createSelectChannelAction,
  createSearchMessagesAction,
  createSearchUserActivityAction,
} from "./chat-helpers.js";

// Re-export helpers so existing imports continue to work
export { base64ToUtf8, getUsernameMap, getUserImageMap, getUserRoleMap, getUserRingMap } from "./chat-types.js";

// Lazy ref to auth store to avoid circular imports
let authStoreRef: typeof import("../stores/auth.js").useAuthStore | null = null;
import("../stores/auth.js").then((m) => { authStoreRef = m.useAuthStore; });

// Lazy ref to DM store to avoid circular imports
let dmStoreRef: typeof import("./dm.js").useDMStore | null = null;
import("./dm.js").then((m) => { dmStoreRef = m.useDMStore; });

export const useChatStore = create<ChatState>((set, get) => ({
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
  roomKnocks: [],
  roomInvites: [],

  dismissKnock: (timestamp) => {
    set((s) => ({
      roomKnocks: s.roomKnocks.filter((k) => k.timestamp !== timestamp),
    }));
  },

  dismissRoomInvite: (timestamp) => {
    set((s) => ({
      roomInvites: s.roomInvites.filter((i) => i.timestamp !== timestamp),
    }));
  },

  loadServers: async () => {
    set({ loadingServers: true });
    try {
      const servers = await api.getServers();
      set({ servers, loadingServers: false });
    } catch {
      set({ loadingServers: false });
    }
  },

  selectServer: createSelectServerAction(set, get, () => dmStoreRef),

  selectChannel: createSelectChannelAction(set, get),

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
      cacheMessageContent(result.items, set);
    } catch {
      set({ loadingMessages: false });
    }
  },

  sendMessage: async (content) => {
    const { activeChannelId, pendingAttachments } = get();
    if (!activeChannelId || (!content.trim() && pendingAttachments.length === 0)) return;

    const attachmentIds = pendingAttachments.map((a) => a.id);
    gateway.send({
      type: "send_message",
      channelId: activeChannelId,
      content: content || " ",
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
    if (pendingAttachments.length > 0) {
      set({ pendingAttachments: [], uploadProgress: {} });
    }
  },

  editMessage: async (messageId, newContent) => {
    if (!newContent.trim()) return;
    gateway.send({
      type: "edit_message",
      messageId,
      content: newContent,
    });
  },

  deleteMessage: (messageId) => {
    gateway.send({ type: "delete_message", messageId });
  },

  updateServer: async (serverId, name) => {
    const updated = await api.updateServer(serverId, { name });
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === serverId ? { ...s, name: updated.name } : s
      ),
    }));
  },

  leaveServer: async (serverId) => {
    await api.leaveServer(serverId);
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
      ...(state.activeServerId === serverId
        ? { activeServerId: null, activeChannelId: null, channels: [], messages: [], members: [] }
        : {}),
    }));
  },

  uploadFile: async (file) => {
    const filename = file.name;
    set((s) => ({ uploadProgress: { ...s.uploadProgress, [filename]: 0 } }));
    try {
      const attachment = await api.uploadFile(file, (pct) => {
        set((s) => ({ uploadProgress: { ...s.uploadProgress, [filename]: pct } }));
      });
      set((s) => ({
        pendingAttachments: [...s.pendingAttachments, attachment],
        uploadProgress: { ...s.uploadProgress, [filename]: 100 },
      }));
    } catch {
      set((s) => {
        const progress = { ...s.uploadProgress };
        delete progress[filename];
        return { uploadProgress: progress };
      });
    }
  },

  removePendingAttachment: (id) => {
    set((s) => ({
      pendingAttachments: s.pendingAttachments.filter((a) => a.id !== id),
    }));
  },

  addReaction: (messageId, emoji) => {
    gateway.send({ type: "add_reaction", messageId, emoji });
  },

  removeReaction: (messageId, emoji) => {
    gateway.send({ type: "remove_reaction", messageId, emoji });
  },

  searchMessages: createSearchMessagesAction(set, get),

  searchUserActivity: createSearchUserActivityAction(set, get),

  clearSearch: () => {
    set({ searchQuery: "", searchFilters: {}, searchResults: null });
  },

  setMyStatus: (status) => {
    gateway.send({ type: "update_status", status });
    // Update auth store's user.status so self avatar always shows correct status regardless
    // of WebSocket event ordering (server broadcasts "offline" for invisible to all incl. self).
    const authState = authStoreRef?.getState();
    if (authState?.user) {
      authStoreRef!.setState({ user: { ...authState.user, status } });
    }
  },

  fetchCustomEmojis: async (serverId) => {
    const emojis = await api.getCustomEmojis(serverId);
    if (get().activeServerId === serverId) {
      set({ customEmojis: emojis });
    }
  },

  markChannelRead: (channelId) => {
    set((s) => {
      const newUnread = new Set(s.unreadChannels);
      newUnread.delete(channelId);
      const newMentions = { ...s.mentionCounts };
      delete newMentions[channelId];
      return { unreadChannels: newUnread, mentionCounts: newMentions };
    });
  },
}));

// Register gateway event handlers
setupChatEvents(useChatStore);
