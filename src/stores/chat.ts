import { create } from "zustand";
import type { Server, Channel, Message, MemberWithUser, DMMessage, Attachment, ActivityInfo } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../lib/broadcast.js";
import { playMessageSound, showDesktopNotification } from "../lib/notifications.js";
import { useCryptoStore } from "./crypto.js";

interface ChatState {
  servers: (Server & { role: string })[];
  channels: Channel[];
  messages: Message[];
  members: MemberWithUser[];
  onlineUsers: Set<string>;
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

  loadServers: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  sendMessage: (content: string) => void;
  editMessage: (messageId: string, newContent: string) => void;
  deleteMessage: (messageId: string) => void;
  uploadFile: (file: File) => Promise<void>;
  removePendingAttachment: (id: string) => void;
  createServer: (name: string) => Promise<void>;
  joinServer: (inviteCode: string) => Promise<void>;
  updateServer: (serverId: string, name: string) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
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
  searchDMMessages: (query: string) => Promise<void>;
  clearDMSearch: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  servers: [],
  channels: [],
  messages: [],
  members: [],
  onlineUsers: new Set(),
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
    // Immediately switch context without clearing existing content
    set({
      activeServerId: serverId,
      showingDMs: false,
      activeDMChannelId: null,
      searchQuery: "",
      searchResults: null,
      dmMessages: [],
    });

    // Load new data, then swap in all at once
    const [channels, members] = await Promise.all([
      api.getChannels(serverId),
      api.getServerMembers(serverId),
    ]);

    // Only apply if we're still viewing this server
    if (get().activeServerId !== serverId) return;

    set({ channels, members, channelsLoaded: true, activeChannelId: null, messages: [], reactions: {} });

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
      hasMoreMessages: false,
      messageCursor: null,
      loadingMessages: false,
      searchQuery: "",
      searchResults: null,
      dmMessages: [],
    });

    gateway.send({ type: "join_channel", channelId });

    // Only fetch messages for text channels
    if (channel?.type === "text") {
      try {
        const result = await api.getMessages(channelId);
        set({
          messages: result.items,
          hasMoreMessages: result.hasMore,
          messageCursor: result.cursor,
          loadingMessages: false,
        });

        // Decrypt all loaded messages
        const cryptoState = useCryptoStore.getState();
        const serverKey = get().activeServerId ? cryptoState.getServerKey(get().activeServerId!) : null;
        decryptMessages(result.items, serverKey);

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
      // Decrypt loaded messages
      const cryptoState = useCryptoStore.getState();
      const serverKey = get().activeServerId ? cryptoState.getServerKey(get().activeServerId!) : null;
      decryptMessages(result.items, serverKey);
    } catch {
      set({ loadingMessages: false });
    }
  },

  sendMessage: async (content) => {
    const { activeChannelId, activeServerId, pendingAttachments } = get();
    if (!activeChannelId || (!content.trim() && pendingAttachments.length === 0)) return;

    const cryptoState = useCryptoStore.getState();
    const key = activeServerId ? cryptoState.getServerKey(activeServerId) : null;
    let ciphertext: string;
    let mlsEpoch: number;
    if (key) {
      ciphertext = await cryptoState.encryptMessage(content || " ", key);
      mlsEpoch = 1;
    } else {
      ciphertext = btoa(content || " ");
      mlsEpoch = 0;
    }

    const attachmentIds = pendingAttachments.map((a) => a.id);
    gateway.send({
      type: "send_message",
      channelId: activeChannelId,
      ciphertext,
      mlsEpoch,
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
    if (pendingAttachments.length > 0) {
      set({ pendingAttachments: [], uploadProgress: {} });
    }
  },

  editMessage: async (messageId, newContent) => {
    if (!newContent.trim()) return;
    const { activeServerId } = get();
    const cryptoState = useCryptoStore.getState();
    const key = activeServerId ? cryptoState.getServerKey(activeServerId) : null;
    const ciphertext = key
      ? await cryptoState.encryptMessage(newContent, key)
      : btoa(newContent);
    gateway.send({
      type: "edit_message",
      messageId,
      ciphertext,
    });
  },

  deleteMessage: (messageId) => {
    gateway.send({ type: "delete_message", messageId });
  },

  createServer: async (name) => {
    const server = await api.createServer({ name });
    set((state) => ({ servers: [...state.servers, { ...server, role: "owner" }] }));
    // Generate and store the encryption group key for this server
    await useCryptoStore.getState().createAndStoreServerKey(server.id);
  },

  joinServer: async (inviteCode) => {
    const server = await api.joinServer(inviteCode);
    set((state) => ({ servers: [...state.servers, { ...server, role: "member" }] }));
    // Request the encryption key from online members
    useCryptoStore.getState().requestServerKey(server.id);
  },

  updateServer: async (serverId, name) => {
    const updated = await api.updateServer(serverId, { name });
    set((state) => ({
      servers: state.servers.map((s) =>
        s.id === serverId ? { ...s, name: updated.name } : s
      ),
    }));
  },

  deleteServer: async (serverId) => {
    await api.deleteServer(serverId);
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
      ...(state.activeServerId === serverId
        ? { activeServerId: null, activeChannelId: null, channels: [], messages: [], members: [] }
        : {}),
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

  searchMessages: async (query) => {
    const { activeChannelId, activeServerId } = get();
    if (!activeChannelId || !query.trim()) return;
    set({ searchQuery: query });
    try {
      const result = await api.searchMessages(activeChannelId, query);
      // Client-side decryption and filtering for E2EE
      const cryptoState = useCryptoStore.getState();
      const key = activeServerId ? cryptoState.getServerKey(activeServerId) : null;
      const lowerQuery = query.toLowerCase();
      const matched: Message[] = [];
      for (const msg of result.items) {
        const text = await cryptoState.decryptMessage(msg.ciphertext, key, msg.mlsEpoch);
        if (text.toLowerCase().includes(lowerQuery)) {
          matched.push(msg);
          // Cache the decrypted text
          useChatStore.setState((s) => ({
            decryptedCache: { ...s.decryptedCache, [msg.id]: text },
          }));
        }
        if (matched.length >= 50) break;
      }
      set({ searchResults: matched });
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
      // Decrypt DM messages
      const dm = get().dmChannels.find((d) => d.id === dmChannelId);
      if (dm) {
        const cryptoState = useCryptoStore.getState();
        try {
          const key = cryptoState.keyPair ? await cryptoState.getDMKey(dmChannelId, dm.otherUser.id) : null;
          decryptMessages(result.items, key);
        } catch {
          decryptMessages(result.items, null);
        }
      }
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

  sendDM: async (content) => {
    const { activeDMChannelId, dmChannels } = get();
    if (!activeDMChannelId || !content.trim()) return;

    const dm = dmChannels.find((d) => d.id === activeDMChannelId);
    const cryptoState = useCryptoStore.getState();
    let ciphertext: string;
    let mlsEpoch: number;
    try {
      if (dm && cryptoState.keyPair) {
        const key = await cryptoState.getDMKey(activeDMChannelId, dm.otherUser.id);
        ciphertext = await cryptoState.encryptMessage(content, key);
        mlsEpoch = 1;
      } else {
        ciphertext = btoa(content);
        mlsEpoch = 0;
      }
    } catch {
      ciphertext = btoa(content);
      mlsEpoch = 0;
    }

    gateway.send({
      type: "send_dm",
      dmChannelId: activeDMChannelId,
      ciphertext,
      mlsEpoch,
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
      // Decrypt loaded DM messages
      const dm = get().dmChannels.find((d) => d.id === activeDMChannelId);
      if (dm) {
        const cryptoState = useCryptoStore.getState();
        try {
          const key = cryptoState.keyPair ? await cryptoState.getDMKey(activeDMChannelId, dm.otherUser.id) : null;
          decryptMessages(result.items, key);
        } catch {
          decryptMessages(result.items, null);
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
        const text = await cryptoState.decryptMessage(msg.ciphertext, key, msg.mlsEpoch);
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

// Bulk-decrypt messages into the cache
async function decryptMessages(messages: (Message | DMMessage)[], key: CryptoKey | null) {
  const cryptoState = useCryptoStore.getState();
  const cache: Record<string, string> = {};
  await Promise.all(
    messages.map(async (msg) => {
      cache[msg.id] = await cryptoState.decryptMessage(msg.ciphertext, key, msg.mlsEpoch);
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
    userActivities: {},
  });

  // Initialize E2EE crypto
  useCryptoStore.getState().initialize().catch((e) => console.error("Crypto init failed:", e));

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
      }
      // Decrypt and cache
      {
        const cryptoState = useCryptoStore.getState();
        const key = state.activeServerId ? cryptoState.getServerKey(state.activeServerId) : null;
        cryptoState.decryptMessage(msg.ciphertext, key, msg.mlsEpoch).then((text) => {
          useChatStore.setState((s) => ({
            decryptedCache: { ...s.decryptedCache, [msg.id]: text },
          }));
          // Notification
          const authUser = authStoreRef?.getState()?.user;
          if (authUser && msg.senderId !== authUser.id) {
            if (msg.channelId !== state.activeChannelId || !document.hasFocus()) {
              const usernameMap = getUsernameMap(state.members);
              const senderName = usernameMap[msg.senderId] ?? "Someone";
              playMessageSound();
              showDesktopNotification(senderName, text);
            }
          }
        });
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
            ? { ...m, ciphertext: event.ciphertext, editedAt: event.editedAt }
            : m
        ),
        searchResults: s.searchResults?.map((m) =>
          m.id === event.messageId
            ? { ...m, ciphertext: event.ciphertext, editedAt: event.editedAt }
            : m
        ) ?? null,
      }));
      // Re-decrypt edited message
      {
        const cryptoState = useCryptoStore.getState();
        const key = state.activeServerId ? cryptoState.getServerKey(state.activeServerId) : null;
        // Edited messages use mlsEpoch 1 if encrypted
        const epoch = key ? 1 : 0;
        cryptoState.decryptMessage(event.ciphertext, key, epoch).then((text) => {
          useChatStore.setState((s) => ({
            decryptedCache: { ...s.decryptedCache, [event.messageId]: text },
          }));
        });
      }
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
          const text = await cryptoState.decryptMessage(event.message.ciphertext, key, event.message.mlsEpoch);
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
