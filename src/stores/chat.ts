import { create } from "zustand";
import type { Message, DMMessage, PresenceStatus } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { useCryptoStore } from "./crypto.js";
import { dbg } from "../lib/debug.js";
import type { ChatState } from "./chat-types.js";
import {
  channelMessageCache,
  serverCache,
  dmMessageCache,
  saveChannelCache,
  saveServerCache,
  saveDMCache,
} from "./chat-types.js";
import { setupChatEvents } from "./chat-events.js";

// Re-export helpers so existing imports continue to work
export { base64ToUtf8, getUsernameMap, getUserImageMap, getUserRoleMap, getUserRingMap } from "./chat-types.js";

// Cache plaintext channel messages into the decryptedCache
function cacheMessageContent(messages: Message[]) {
  const cache: Record<string, string> = {};
  for (const msg of messages) {
    cache[msg.id] = msg.content;
  }
  useChatStore.setState((s) => ({
    decryptedCache: { ...s.decryptedCache, ...cache },
  }));
}

// Bulk-decrypt DM messages into the cache (DMs remain E2EE)
async function decryptDMMessages(messages: DMMessage[], key: CryptoKey | null) {
  const cryptoState = useCryptoStore.getState();
  const cache: Record<string, string> = {};
  await Promise.all(
    messages.map(async (msg) => {
      cache[msg.id] = await cryptoState.decryptMessage(msg.ciphertext, key);
    }),
  );
  useChatStore.setState((s) => ({
    decryptedCache: { ...s.decryptedCache, ...cache },
  }));
}

// Lazy ref to auth store to avoid circular imports
let authStoreRef: typeof import("../stores/auth.js").useAuthStore | null = null;
import("../stores/auth.js").then((m) => { authStoreRef = m.useAuthStore; });

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
  showingDMs: false,
  dmChannels: [],
  activeDMChannelId: null,
  dmMessages: [],
  dmHasMore: false,
  dmCursor: null,
  dmSearchQuery: "",
  dmSearchResults: null,
  decryptedCache: {},
  dmError: null,
  unreadChannels: new Set(),
  mentionCounts: {},
  typingUsers: {},
  customEmojis: [],
  roomKnocks: [],
  roomInvites: [],

  dismissKnock: (timestamp) => {
    useChatStore.setState((s) => ({
      roomKnocks: s.roomKnocks.filter((k) => k.timestamp !== timestamp),
    }));
  },

  dismissRoomInvite: (timestamp) => {
    useChatStore.setState((s) => ({
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

  selectServer: async (serverId) => {
    // Save current channel cache before switching
    const prevChannel = get().activeChannelId;
    if (prevChannel) saveChannelCache(prevChannel, get());

    // Restore cached server state instantly for flicker-free transition
    const cached = serverCache.get(serverId);

    set({
      activeServerId: serverId,
      showingDMs: false,
      activeDMChannelId: null,
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
      dmMessages: [],
      // Restore cached data instantly (or keep current if no cache)
      ...(cached ? {
        channels: cached.channels,
        members: cached.members,
        activeChannelId: cached.activeChannelId,
      } : {}),
    });

    // If we restored a cached channel, rejoin it and restore messages
    if (cached?.activeChannelId) {
      gateway.send({ type: "join_channel", channelId: cached.activeChannelId });
      const cachedMessages = channelMessageCache.get(cached.activeChannelId);
      if (cachedMessages) {
        set({
          messages: cachedMessages.messages,
          reactions: cachedMessages.reactions,
          hasMoreMessages: cachedMessages.hasMore,
          messageCursor: cachedMessages.cursor,
          loadingMessages: false,
        });
      }
    }

    // Fetch fresh data in background
    const [channels, members, customEmojis] = await Promise.all([
      api.getChannels(serverId),
      api.getServerMembers(serverId),
      api.getCustomEmojis(serverId).catch(() => [] as import("../types/shared.js").CustomEmoji[]),
    ]);

    // Only apply if we're still viewing this server
    if (get().activeServerId !== serverId) return;

    set({ channels, members, channelsLoaded: true, customEmojis });

    // Subscribe to all text channels so we receive events for unread tracking
    for (const ch of channels) {
      if (ch.type === "text") gateway.send({ type: "join_channel", channelId: ch.id });
    }

    // If no cached channel was restored, auto-select first text channel
    if (!cached?.activeChannelId) {
      const textChannel = channels.find((c) => c.type === "text");
      if (textChannel) {
        get().selectChannel(textChannel.id);
      }
    }
  },

  selectChannel: async (channelId) => {
    // Skip if already viewing this channel
    if (get().activeChannelId === channelId) return;

    const prevChannel = get().activeChannelId;
    if (prevChannel && prevChannel !== channelId) {
      // Save current channel's messages to cache before switching
      saveChannelCache(prevChannel, get());
      // Do not leave_channel — stay subscribed to all text channels for unread tracking
    }

    const channel = get().channels.find((c) => c.id === channelId);

    // Clear unread/mention state via shared helper
    get().markChannelRead(channelId);

    // Restore from cache for instant display, or start empty
    const cached = channelMessageCache.get(channelId);

    set({
      activeChannelId: channelId,
      activeDMChannelId: null,
      messages: cached?.messages ?? [],
      reactions: cached?.reactions ?? {},
      hasMoreMessages: cached?.hasMore ?? false,
      messageCursor: cached?.cursor ?? null,
      loadingMessages: false,
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
      dmMessages: [],
    });

    gateway.send({ type: "join_channel", channelId });

    // Only fetch messages for text channels
    if (channel?.type === "text") {
      try {
        const result = await api.getMessages(channelId);
        // Only apply if still viewing this channel
        if (get().activeChannelId !== channelId) return;
        set({
          messages: result.items,
          hasMoreMessages: result.hasMore,
          messageCursor: result.cursor,
          loadingMessages: false,
        });
        // Update cache with fresh data
        saveChannelCache(channelId, get());

        // Cache plaintext content for display
        cacheMessageContent(result.items);

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
            // Update cache with reactions
            saveChannelCache(channelId, get());
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
      // Cache plaintext content for display
      cacheMessageContent(result.items);
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

  searchMessages: async (query, filters = {}) => {
    const { activeServerId } = get();
    if (!activeServerId) return;
    const hasFilters = !!(filters.fromUserId || filters.inChannelId || filters.has || filters.mentionsUserId || filters.before || filters.on || filters.after);
    if (!query.trim() && !hasFilters) return;
    set({ searchQuery: query, searchFilters: filters });
    try {
      const result = await api.searchServerMessages(activeServerId, {
        q: query.trim() || undefined,
        senderId: filters.fromUserId,
        channelId: filters.inChannelId,
        has: filters.has,
        mentionsUsername: filters.mentionsUsername,
        before: filters.before,
        on: filters.on,
        after: filters.after,
      });
      // Server-side FTS — results are already plaintext
      const cache: Record<string, string> = {};
      for (const msg of result.items) {
        cache[msg.id] = msg.content;
      }
      useChatStore.setState((s) => ({
        decryptedCache: { ...s.decryptedCache, ...cache },
      }));
      set({ searchResults: result.items });
    } catch {
      set({ searchResults: [] });
    }
  },

  searchUserActivity: async (userId, username) => {
    const { activeServerId } = get();
    if (!activeServerId) return;
    set({
      searchQuery: "",
      searchFilters: { fromUserId: userId, fromUsername: username },
    });
    try {
      // Parallel: messages FROM the user + messages containing their name as text
      // (FTS tokenizes @username as "username", so this catches both @username mentions and bare text)
      const [fromResult, textResult] = await Promise.all([
        api.searchServerMessages(activeServerId, { senderId: userId }),
        api.searchServerMessages(activeServerId, { q: username }),
      ]);
      const seen = new Set<string>();
      const merged: Message[] = [];
      for (const msg of [...fromResult.items, ...textResult.items]) {
        if (!seen.has(msg.id)) { seen.add(msg.id); merged.push(msg); }
      }
      merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const cache: Record<string, string> = {};
      for (const msg of merged) cache[msg.id] = msg.content;
      useChatStore.setState((s) => ({ decryptedCache: { ...s.decryptedCache, ...cache } }));
      set({ searchResults: merged });
    } catch {
      set({ searchResults: [] });
    }
  },

  clearSearch: () => {
    set({ searchQuery: "", searchFilters: {}, searchResults: null });
  },

  showDMs: () => {
    const prevChannel = get().activeChannelId;
    if (prevChannel) {
      saveChannelCache(prevChannel, get());
      gateway.send({ type: "leave_channel", channelId: prevChannel });
    }
    saveServerCache(get());
    set({
      showingDMs: true,
      activeServerId: null,
      activeChannelId: null,
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
    });
    get().loadDMChannels();
  },

  loadDMChannels: async () => {
    try {
      const dmChannels = await api.getDMChannels();
      set({ dmChannels });
    } catch (e) {
      dbg("chat", "Failed to load DM channels", e);
    }
  },

  selectDM: async (dmChannelId) => {
    // Skip if already viewing this DM
    if (get().activeDMChannelId === dmChannelId && get().showingDMs) return;

    const prevChannel = get().activeChannelId;
    if (prevChannel) {
      saveChannelCache(prevChannel, get());
      gateway.send({ type: "leave_channel", channelId: prevChannel });
    }
    saveServerCache(get());
    const prevDM = get().activeDMChannelId;
    if (prevDM && prevDM !== dmChannelId) {
      saveDMCache(prevDM, get());
      gateway.send({ type: "leave_dm", dmChannelId: prevDM });
    }

    // Restore cached DM messages for instant display
    const cachedDM = dmMessageCache.get(dmChannelId);

    set({
      showingDMs: true,
      activeDMChannelId: dmChannelId,
      activeServerId: null,
      activeChannelId: null,
      channels: [],
      messages: [],
      reactions: {},
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
      dmMessages: cachedDM?.messages ?? [],
      dmHasMore: cachedDM?.hasMore ?? false,
      dmCursor: cachedDM?.cursor ?? null,
      loadingMessages: !cachedDM,
    });

    gateway.send({ type: "join_dm", dmChannelId });

    // Fetch fresh data in background (non-blocking if cache exists)
    try {
      const result = await api.getDMMessages(dmChannelId);
      // Only apply if still viewing this DM
      if (get().activeDMChannelId !== dmChannelId) return;
      set({
        dmMessages: result.items,
        dmHasMore: result.hasMore,
        dmCursor: result.cursor,
        loadingMessages: false,
      });
      // Update cache with fresh data
      saveDMCache(dmChannelId, get());
      // Decrypt DM messages
      const dm = get().dmChannels.find((d) => d.id === dmChannelId);
      if (dm) {
        const cryptoState = useCryptoStore.getState();
        try {
          const key = cryptoState.keyPair ? await cryptoState.getDMKey(dmChannelId, dm.otherUser.id) : null;
          decryptDMMessages(result.items, key);
        } catch {
          decryptDMMessages(result.items, null);
        }
      }
    } catch {
      if (get().activeDMChannelId === dmChannelId) {
        set({ loadingMessages: false });
      }
    }
  },

  openDM: async (userId) => {
    try {
      // Check if we already have a DM channel with this user (skip API call)
      const existing = get().dmChannels.find((d) => d.otherUser.id === userId);
      if (existing) {
        get().selectDM(existing.id);
        return;
      }
      const dm = await api.createDM(userId);
      set((state) => {
        const exists = state.dmChannels.some((d) => d.id === dm.id);
        return { dmChannels: exists ? state.dmChannels : [...state.dmChannels, dm] };
      });
      get().selectDM(dm.id);
    } catch (e) {
      dbg("chat", "Failed to open DM", e);
    }
  },

  sendDM: async (content) => {
    const { activeDMChannelId, dmChannels } = get();
    if (!activeDMChannelId || !content.trim()) return;

    const dm = dmChannels.find((d) => d.id === activeDMChannelId);
    const cryptoState = useCryptoStore.getState();
    if (!dm || !cryptoState.keyPair) {
      set({ dmError: "Encryption keys not available. Try reinitializing encryption." });
      return;
    }
    let ciphertext: string;
    try {
      const key = await cryptoState.getDMKey(activeDMChannelId, dm.otherUser.id);
      ciphertext = await cryptoState.encryptMessage(content, key);
    } catch (e) {
      dbg("chat", "DM encryption failed:", e);
      set({ dmError: "Failed to encrypt message. Try reinitializing encryption." });
      return;
    }
    set({ dmError: null });

    gateway.send({
      type: "send_dm",
      dmChannelId: activeDMChannelId,
      ciphertext,
      mlsEpoch: 1,
    });
  },

  clearDmError: () => set({ dmError: null }),

  retryEncryptionSetup: async () => {
    set({ dmError: null });
    const cryptoState = useCryptoStore.getState();
    // Reset initialized flag so initialize() runs again
    useCryptoStore.setState({ initialized: false });
    await cryptoState.initialize();
    if (!useCryptoStore.getState().keyPair) {
      set({ dmError: "Encryption setup failed. Please restart the app." });
    }
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
      // Decrypt loaded DM messages
      const dm = get().dmChannels.find((d) => d.id === activeDMChannelId);
      if (dm) {
        const cryptoState = useCryptoStore.getState();
        try {
          const key = cryptoState.keyPair ? await cryptoState.getDMKey(activeDMChannelId, dm.otherUser.id) : null;
          decryptDMMessages(result.items, key);
        } catch {
          decryptDMMessages(result.items, null);
        }
      }
    } catch {
      set({ loadingMessages: false });
    }
  },

  searchDMMessages: async (query) => {
    const { activeDMChannelId, dmChannels } = get();
    if (!activeDMChannelId || !query.trim()) return;
    set({ dmSearchQuery: query });
    try {
      const result = await api.searchDMMessages(activeDMChannelId, query);
      // Client-side decryption and filtering for E2EE
      const cryptoState = useCryptoStore.getState();
      const dm = dmChannels.find((d) => d.id === activeDMChannelId);
      let key: CryptoKey | null = null;
      try {
        if (dm && cryptoState.keyPair) {
          key = await cryptoState.getDMKey(activeDMChannelId, dm.otherUser.id);
        }
      } catch { /* no key available */ }

      const lowerQuery = query.toLowerCase();
      const matched: DMMessage[] = [];
      for (const msg of result.items) {
        const text = await cryptoState.decryptMessage(msg.ciphertext, key);
        if (text.toLowerCase().includes(lowerQuery)) {
          matched.push(msg);
          useChatStore.setState((s) => ({
            decryptedCache: { ...s.decryptedCache, [msg.id]: text },
          }));
        }
        if (matched.length >= 50) break;
      }
      set({ dmSearchResults: matched });
    } catch {
      set({ dmSearchResults: [] });
    }
  },

  clearDMSearch: () => {
    set({ dmSearchQuery: "", dmSearchResults: null });
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
