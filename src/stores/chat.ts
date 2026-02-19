import { create } from "zustand";
import type { Server, Channel, Message, MemberWithUser, DMMessage, Attachment, ActivityInfo, PresenceStatus } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../lib/broadcast.js";
import { playMessageSound, showDesktopNotification } from "../lib/notifications.js";
import { useCryptoStore } from "./crypto.js";
import { useUIStore } from "./ui.js";

// UTF-8-safe base64 encoding/decoding (btoa/atob only handle Latin-1)
export function utf8ToBase64(str: string): string {
  return btoa(String.fromCodePoint(...new TextEncoder().encode(str)));
}
export function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.codePointAt(0)!);
  return new TextDecoder().decode(bytes);
}

interface ChatState {
  servers: (Server & { role: string })[];
  channels: Channel[];
  messages: Message[];
  members: MemberWithUser[];
  onlineUsers: Set<string>; // derived from userStatuses for backwards compat
  userStatuses: Record<string, PresenceStatus>;
  userActivities: Record<string, ActivityInfo>;
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
  searchFilters: {
    fromUserId?: string;
    fromUsername?: string;
    inChannelId?: string;
    inChannelName?: string;
    has?: string;
    mentionsUserId?: string;
    mentionsUsername?: string;
    before?: string;
    on?: string;
    after?: string;
  };
  searchResults: Message[] | null;

  // File uploads
  pendingAttachments: Attachment[];
  uploadProgress: Record<string, number>;

  // DMs
  showingDMs: boolean;
  dmChannels: { id: string; otherUser: { id: string; username: string; image: string | null }; createdAt: string }[];
  activeDMChannelId: string | null;
  dmMessages: DMMessage[];
  dmHasMore: boolean;
  dmCursor: string | null;
  dmSearchQuery: string;
  dmSearchResults: DMMessage[] | null;

  // E2EE: decrypted message cache (messageId → plaintext)
  decryptedCache: Record<string, string>;

  // Unread tracking
  unreadChannels: Set<string>;

  // Typing indicators: channelId -> Set of userIds currently typing
  typingUsers: Record<string, Set<string>>;

  loadServers: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  sendMessage: (content: string) => void;
  editMessage: (messageId: string, newContent: string) => void;
  deleteMessage: (messageId: string) => void;
  uploadFile: (file: File) => Promise<void>;
  removePendingAttachment: (id: string) => void;
  updateServer: (serverId: string, name: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  searchMessages: (query: string, filters?: { fromUserId?: string; fromUsername?: string; inChannelId?: string; inChannelName?: string; has?: string; mentionsUserId?: string; mentionsUsername?: string; before?: string; on?: string; after?: string }) => Promise<void>;
  searchUserActivity: (userId: string, username: string) => Promise<void>;
  clearSearch: () => void;
  showDMs: () => void;
  loadDMChannels: () => Promise<void>;
  selectDM: (dmChannelId: string) => Promise<void>;
  openDM: (userId: string) => Promise<void>;
  sendDM: (content: string) => Promise<void>;
  dmError: string | null;
  clearDmError: () => void;
  retryEncryptionSetup: () => Promise<void>;
  loadMoreDMMessages: () => Promise<void>;
  searchDMMessages: (query: string) => Promise<void>;
  clearDMSearch: () => void;
  setMyStatus: (status: PresenceStatus) => void;
}

// Per-channel message cache for instant channel switching
interface ChannelCache {
  messages: Message[];
  reactions: Record<string, { emoji: string; userIds: string[] }[]>;
  hasMore: boolean;
  cursor: string | null;
}
const channelMessageCache = new Map<string, ChannelCache>();

function saveChannelCache(channelId: string, state: ChatState) {
  channelMessageCache.set(channelId, {
    messages: state.messages,
    reactions: state.reactions,
    hasMore: state.hasMoreMessages,
    cursor: state.messageCursor,
  });
}

// Server-level cache for instant restore when switching back from DMs
interface ServerCache {
  channels: ChatState["channels"];
  members: ChatState["members"];
  activeChannelId: string | null;
}
const serverCache = new Map<string, ServerCache>();

function saveServerCache(state: ChatState) {
  if (state.activeServerId) {
    serverCache.set(state.activeServerId, {
      channels: state.channels,
      members: state.members,
      activeChannelId: state.activeChannelId,
    });
  }
}

// DM message cache for instant switching between DMs
interface DMCache {
  messages: ChatState["dmMessages"];
  hasMore: boolean;
  cursor: string | null;
}
const dmMessageCache = new Map<string, DMCache>();

function saveDMCache(dmChannelId: string, state: ChatState) {
  dmMessageCache.set(dmChannelId, {
    messages: state.dmMessages,
    hasMore: state.dmHasMore,
    cursor: state.dmCursor,
  });
}

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
  typingUsers: {},

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
    const [channels, members] = await Promise.all([
      api.getChannels(serverId),
      api.getServerMembers(serverId),
    ]);

    // Only apply if we're still viewing this server
    if (get().activeServerId !== serverId) return;

    set({ channels, members, channelsLoaded: true });

    // If no cached channel was restored, auto-select first text channel
    if (!cached?.activeChannelId) {
      const textChannel = channels.find((c) => c.type === "text");
      if (textChannel) {
        get().selectChannel(textChannel.id);
      }
    }
  },

  selectChannel: async (channelId) => {
    // Hide economy view when selecting a channel
    useUIStore.getState().hideEconomy();

    // Skip if already viewing this channel
    if (get().activeChannelId === channelId) return;

    const prevChannel = get().activeChannelId;
    if (prevChannel && prevChannel !== channelId) {
      // Save current channel's messages to cache before switching
      if (!prevChannel.startsWith("__game_")) saveChannelCache(prevChannel, get());
      if (!prevChannel.startsWith("__game_")) gateway.send({ type: "leave_channel", channelId: prevChannel });
    }

    // Hardcoded game channels: just set active, no WS/API
    if (channelId.startsWith("__game_")) {
      set({
        activeChannelId: channelId,
        activeDMChannelId: null,
        messages: [],
        reactions: {},
        hasMoreMessages: false,
        messageCursor: null,
        loadingMessages: false,
        searchQuery: "",
        searchFilters: {},
        searchResults: null,
        dmMessages: [],
      });
      return;
    }

    const channel = get().channels.find((c) => c.id === channelId);

    const newUnread = new Set(get().unreadChannels);
    newUnread.delete(channelId);

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
      unreadChannels: newUnread,
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
    } catch {
      // ignore
    }
  },

  selectDM: async (dmChannelId) => {
    // Hide economy view when selecting a DM
    useUIStore.getState().hideEconomy();

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
    } catch {
      // ignore
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
      console.error("DM encryption failed:", e);
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

// Helper to get role map
export function getUserRoleMap(members: MemberWithUser[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of members) {
    map[m.userId] = m.role;
  }
  return map;
}

// Helper to get ring info map
export function getUserRingMap(members: MemberWithUser[]): Record<string, { ringStyle: string; ringSpin: boolean; ringPatternSeed: number | null }> {
  const map: Record<string, { ringStyle: string; ringSpin: boolean; ringPatternSeed: number | null }> = {};
  for (const m of members) {
    map[m.userId] = { ringStyle: m.ringStyle ?? "default", ringSpin: m.ringSpin ?? false, ringPatternSeed: m.ringPatternSeed ?? null };
  }
  return map;
}

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

// On WS connect/reconnect: clear stale presence, mark self online
let activityPollInterval: ReturnType<typeof setInterval> | null = null;
let lastActivityName: string | null = null;

gateway.onConnect(() => {
  const user = authStoreRef?.getState()?.user;
  useChatStore.setState({
    onlineUsers: new Set(user ? [user.id] : []),
    userStatuses: user ? { [user.id]: (user as any).status ?? "online" } : {},
    userActivities: {},
  });

  // Re-subscribe to active channel/DM so the server knows we're watching
  const { activeChannelId, activeDMChannelId } = useChatStore.getState();
  if (activeChannelId) gateway.send({ type: "join_channel", channelId: activeChannelId });
  if (activeDMChannelId) gateway.send({ type: "join_dm", dmChannelId: activeDMChannelId });

  // Initialize E2EE crypto
  useCryptoStore.getState().initialize().catch((e) => console.error("Crypto init failed:", e));

  // Pre-fetch DM channels for instant DM switching
  useChatStore.getState().loadDMChannels();

  // Initialize Spotify
  import("./spotify.js").then(({ useSpotifyStore }) => {
    useSpotifyStore.getState().loadAccount().catch((e) => console.error("Spotify init failed:", e));
  });

  // Start activity polling (detect running games/apps via Tauri)
  if (activityPollInterval) clearInterval(activityPollInterval);
  lastActivityName = null;

  async function pollActivity() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ name: string; activityType: string } | null>("detect_activity");
      const newName = result?.name ?? null;
      if (newName !== lastActivityName) {
        lastActivityName = newName;
        gateway.send({
          type: "update_activity",
          activity: result ? { name: result.name, activityType: result.activityType as "playing" | "listening" } : null,
        });
      }
    } catch { /* Tauri not available or command failed */ }
  }

  pollActivity();
  activityPollInterval = setInterval(pollActivity, 15_000);
});

// Listen for WebSocket events
gateway.on((event) => {
  const state = useChatStore.getState();

  switch (event.type) {
    case "message": {
      const msg = event.attachments?.length
        ? { ...event.message, attachments: event.attachments }
        : event.message;
      if (msg.channelId === state.activeChannelId) {
        useChatStore.setState((s) => ({
          messages: [...s.messages, msg],
        }));
      } else {
        // Mark channel as unread and update cache
        useChatStore.setState((s) => {
          const newUnread = new Set(s.unreadChannels);
          newUnread.add(msg.channelId);
          return { unreadChannels: newUnread };
        });
        // Append to cached messages for that channel
        const cached = channelMessageCache.get(msg.channelId);
        if (cached) {
          cached.messages = [...cached.messages, msg];
        }
      }
      // Cache plaintext content for display
      useChatStore.setState((s) => ({
        decryptedCache: { ...s.decryptedCache, [msg.id]: msg.content },
      }));
      // Notification
      {
        const authUser = authStoreRef?.getState()?.user;
        if (authUser && msg.senderId !== authUser.id) {
          if (msg.channelId !== state.activeChannelId || !document.hasFocus()) {
            const usernameMap = getUsernameMap(state.members);
            const senderName = usernameMap[msg.senderId] ?? "Someone";
            playMessageSound();
            showDesktopNotification(senderName, msg.content);
          }
        }
      }
      break;
    }

    case "typing":
      useChatStore.setState((s) => {
        const channelTypers = new Set(s.typingUsers[event.channelId] ?? []);
        if (event.active) {
          channelTypers.add(event.userId);
        } else {
          channelTypers.delete(event.userId);
        }
        return { typingUsers: { ...s.typingUsers, [event.channelId]: channelTypers } };
      });
      break;

    case "presence":
      useChatStore.setState((s) => {
        const newSet = new Set(s.onlineUsers);
        const newStatuses = { ...s.userStatuses };
        if (event.status === "offline") {
          newSet.delete(event.userId);
          delete newStatuses[event.userId];
        } else {
          newSet.add(event.userId);
          newStatuses[event.userId] = event.status as PresenceStatus;
        }
        return { onlineUsers: newSet, userStatuses: newStatuses };
      });
      break;

    case "activity_update":
      useChatStore.setState((s) => {
        const activities = { ...s.userActivities };
        if (event.activity) {
          activities[event.userId] = event.activity;
        } else {
          delete activities[event.userId];
        }
        return { userActivities: activities };
      });
      break;

    case "message_edit": {
      useChatStore.setState((s) => ({
        messages: s.messages.map((m) =>
          m.id === event.messageId
            ? { ...m, content: event.content, editedAt: event.editedAt }
            : m
        ),
        searchResults: s.searchResults?.map((m) =>
          m.id === event.messageId
            ? { ...m, content: event.content, editedAt: event.editedAt }
            : m
        ) ?? null,
        decryptedCache: { ...s.decryptedCache, [event.messageId]: event.content },
      }));
      break;
    }

    case "message_delete": {
      useChatStore.setState((s) => ({
        messages: s.messages.filter((m) => m.id !== event.messageId),
        searchResults: s.searchResults?.filter((m) => m.id !== event.messageId) ?? null,
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
              ringStyle: event.ringStyle ?? "default",
              ringSpin: event.ringSpin ?? false,
              steamId: event.steamId ?? null,
              ringPatternSeed: event.ringPatternSeed ?? null,
              bannerCss: event.bannerCss ?? null,
              bannerPatternSeed: event.bannerPatternSeed ?? null,
            }],
          }));
        }
      }
      // Auto-share server encryption key with new member
      useCryptoStore.getState().handleKeyRequested(event.serverId, event.userId);
      break;
    }

    case "server_key_shared": {
      useCryptoStore.getState().handleKeyShared(event.serverId, event.encryptedKey, event.senderId);
      break;
    }

    case "server_key_requested": {
      useCryptoStore.getState().handleKeyRequested(event.serverId, event.userId);
      break;
    }

    case "member_left": {
      if (event.serverId === state.activeServerId) {
        useChatStore.setState((s) => ({
          members: s.members.filter((m) => m.userId !== event.userId),
        }));
      }
      break;
    }

    case "server_updated": {
      useChatStore.setState((s) => ({
        servers: s.servers.map((sv) =>
          sv.id === event.serverId ? { ...sv, name: event.name } : sv
        ),
      }));
      break;
    }

    case "server_deleted": {
      useChatStore.setState((s) => ({
        servers: s.servers.filter((sv) => sv.id !== event.serverId),
        ...(s.activeServerId === event.serverId
          ? { activeServerId: null, activeChannelId: null, channels: [], messages: [], members: [] }
          : {}),
      }));
      break;
    }

    case "member_role_updated": {
      useChatStore.setState((s) => ({
        members: s.members.map((m) =>
          m.userId === event.userId && m.serverId === event.serverId
            ? { ...m, role: event.role as "owner" | "admin" | "member" }
            : m
        ),
        servers: s.servers.map((sv) =>
          sv.id === event.serverId && event.userId === authStoreRef?.getState()?.user?.id
            ? { ...sv, role: event.role }
            : sv
        ),
      }));
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
                ...(event.ringStyle !== undefined ? { ringStyle: event.ringStyle } : {}),
                ...(event.ringSpin !== undefined ? { ringSpin: event.ringSpin } : {}),
                ...(event.ringPatternSeed !== undefined ? { ringPatternSeed: event.ringPatternSeed } : {}),
                ...(event.bannerCss !== undefined ? { bannerCss: event.bannerCss } : {}),
                ...(event.bannerPatternSeed !== undefined ? { bannerPatternSeed: event.bannerPatternSeed } : {}),
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
      } else {
        // Append to DM cache for instant switching later
        const cached = dmMessageCache.get(event.message.dmChannelId);
        if (cached) {
          cached.messages = [...cached.messages, event.message];
        }
      }
      // Decrypt and cache + notification
      {
        const dm = state.dmChannels.find((d) => d.id === event.message.dmChannelId);
        const cryptoState = useCryptoStore.getState();
        (async () => {
          let key: CryptoKey | null = null;
          try {
            if (dm && cryptoState.keyPair) {
              key = await cryptoState.getDMKey(event.message.dmChannelId, dm.otherUser.id);
            }
          } catch { /* no key */ }
          const text = await cryptoState.decryptMessage(event.message.ciphertext, key);
          useChatStore.setState((s) => ({
            decryptedCache: { ...s.decryptedCache, [event.message.id]: text },
          }));
          // DM notification
          const dmAuthUser = authStoreRef?.getState()?.user;
          if (dmAuthUser && event.message.senderId !== dmAuthUser.id) {
            if (event.message.dmChannelId !== state.activeDMChannelId || !document.hasFocus()) {
              const senderName = dm?.otherUser.username ?? "Someone";
              playMessageSound();
              showDesktopNotification(senderName, text);
            }
          }
        })();
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
