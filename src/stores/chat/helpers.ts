import type { Message } from "@/types/shared.js";
import type { ChatState } from "./types.js";
import type { StoreApi } from "zustand";
import * as api from "@/lib/api/index.js";
import { gateway } from "@/lib/ws.js";
import {
  channelMessageCache,
  serverCache,
  saveChannelCache,
} from "./types.js";

type Set = StoreApi<ChatState>["setState"];
type Get = StoreApi<ChatState>["getState"];

// ── Pure helpers ──────────────────────────────────────────────

/** Build a messageId -> content cache from an array of messages. */
function buildMessageContentCache(messages: Message[]): Record<string, string> {
  const cache: Record<string, string> = {};
  for (const msg of messages) {
    cache[msg.id] = msg.content;
  }
  return cache;
}

/** Group flat reaction rows into per-message grouped reactions. */
function groupReactionItems(
  reactionItems: { messageId: string; emoji: string; userId: string }[],
): Record<string, { emoji: string; userIds: string[] }[]> {
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
  return grouped;
}

/** Merge two search result arrays, deduplicate by id, sort newest first. */
function mergeSearchResults(a: Message[], b: Message[]): Message[] {
  const seen = new Set<string>();
  const merged: Message[] = [];
  for (const msg of [...a, ...b]) {
    if (!seen.has(msg.id)) { seen.add(msg.id); merged.push(msg); }
  }
  merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return merged;
}

// ── Store-bound helpers ───────────────────────────────────────

/** Cache plaintext channel messages into the decryptedCache via set(). */
export function cacheMessageContent(messages: Message[], set: Set) {
  const cache = buildMessageContentCache(messages);
  set((s) => ({
    decryptedCache: { ...s.decryptedCache, ...cache },
  }));
}

// ── Action creators ───────────────────────────────────────────
// These accept set/get from zustand's create() callback and lazy
// accessor functions for cross-store refs that aren't available at
// store creation time.

interface DmStoreRef {
  getState: () => { showingDMs?: boolean };
  setState: (s: Record<string, unknown>) => void;
}

export function createSelectServerAction(
  set: Set,
  get: Get,
  getDmStore: () => DmStoreRef | null,
) {
  return async (serverId: string) => {
    const dmStoreRef = getDmStore();

    // Skip if already viewing this server (avoids redundant state updates that flicker room cards)
    const current = get();
    const dmState = dmStoreRef?.getState();
    if (current.activeServerId === serverId && !dmState?.showingDMs) return;

    // Save current channel cache before switching
    const prevChannel = current.activeChannelId;
    if (prevChannel) saveChannelCache(prevChannel, get());

    // Restore cached server state instantly for flicker-free transition
    const cached = serverCache.get(serverId);

    // Clear DM state when switching to a server
    dmStoreRef?.setState({
      showingDMs: false,
      activeDMChannelId: null,
      dmMessages: [],
    });

    set({
      activeServerId: serverId,
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
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
      api.getCustomEmojis(serverId).catch(() => [] as import("@/types/shared.js").CustomEmoji[]),
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
  };
}

export function createSelectChannelAction(set: Set, get: Get) {
  return async (channelId: string) => {
    // Skip if already viewing this channel
    if (get().activeChannelId === channelId) return;

    const prevChannel = get().activeChannelId;
    if (prevChannel && prevChannel !== channelId) {
      // Save current channel's messages to cache before switching
      saveChannelCache(prevChannel, get());
      // Do not leave_channel -- stay subscribed to all text channels for unread tracking
    }

    const channel = get().channels.find((c) => c.id === channelId);

    // Clear unread/mention state via shared helper
    get().markChannelRead(channelId);

    // Restore from cache for instant display, or start empty
    const cached = channelMessageCache.get(channelId);

    set({
      activeChannelId: channelId,
      messages: cached?.messages ?? [],
      reactions: cached?.reactions ?? {},
      hasMoreMessages: cached?.hasMore ?? false,
      messageCursor: cached?.cursor ?? null,
      loadingMessages: false,
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
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
        cacheMessageContent(result.items, set);

        // Load reactions for the fetched messages
        if (result.items.length > 0) {
          try {
            const reactionItems = await api.getReactions(result.items.map((m) => m.id));
            const grouped = groupReactionItems(reactionItems);
            set({ reactions: grouped });
            // Update cache with reactions
            saveChannelCache(channelId, get());
          } catch { /* non-critical */ }
        }
      } catch {
        set({ loadingMessages: false });
      }
    }
  };
}

export function createSearchMessagesAction(set: Set, get: Get) {
  return async (query: string, filters: ChatState["searchFilters"] = {}) => {
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
      // Server-side FTS -- results are already plaintext
      const cache = buildMessageContentCache(result.items);
      set((s) => ({
        decryptedCache: { ...s.decryptedCache, ...cache },
      }));
      set({ searchResults: result.items });
    } catch {
      set({ searchResults: [] });
    }
  };
}

export function createSearchUserActivityAction(set: Set, get: Get) {
  return async (userId: string, username: string) => {
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
      const merged = mergeSearchResults(fromResult.items, textResult.items);
      const cache = buildMessageContentCache(merged);
      set((s) => ({ decryptedCache: { ...s.decryptedCache, ...cache } }));
      set({ searchResults: merged });
    } catch {
      set({ searchResults: [] });
    }
  };
}
