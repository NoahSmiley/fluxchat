import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatState } from "./types.js";
import {
  EVERYONE_MENTION_RE,
  HERE_MENTION_RE,
  channelMessageCache,
  dmMessageCache,
  getUsernameMap,
} from "./types.js";
import * as api from "@/lib/api/index.js";
import { playMessageSound, showDesktopNotification, shouldNotifyChannel } from "@/lib/notifications.js";
import { useCryptoStore } from "@/stores/crypto.js";
import type {
  AuthStoreRef,
  NotifStoreRef,
  DMStoreRef,
  IsChannelOrCategoryMutedFn,
  IsMentionMutedFn,
} from "./events.js";

// ── Message event handlers ──

export function handleMessage(
  event: any,
  state: ChatState,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
  authStoreRef: AuthStoreRef,
  notifStoreRef: NotifStoreRef,
  isChannelOrCategoryMuted: IsChannelOrCategoryMutedFn,
  isMentionMuted: IsMentionMutedFn,
) {
  const msg = event.attachments?.length
    ? { ...event.message, attachments: event.attachments }
    : event.message;
  const authUser = authStoreRef?.getState()?.user;
  const isFromSelf = authUser && msg.senderId === authUser.id;
  if (msg.channelId === state.activeChannelId) {
    // Batch: append message + cache decrypted content in one setState
    useChatStore.setState((s) => ({
      messages: [...s.messages, msg],
      decryptedCache: { ...s.decryptedCache, [msg.id]: msg.content },
    }));
  } else {
    // Single batched setState for all non-active-channel updates
    useChatStore.setState((s) => {
      const result: Record<string, unknown> = {
        decryptedCache: { ...s.decryptedCache, [msg.id]: msg.content },
      };

      if (!isFromSelf) {
        const notif = notifStoreRef?.getState() ?? null;
        if (!notif?.isUserMuted(msg.senderId)) {
          const channel = state.channels.find((c) => c.id === msg.channelId);
          const parentId = channel?.parentId ?? undefined;

          // White circle: suppressed by channel/category mute
          if (!isChannelOrCategoryMuted(msg.channelId, parentId, notif)) {
            const newUnread = new Set(s.unreadChannels);
            newUnread.add(msg.channelId);
            result.unreadChannels = newUnread;
          }

          // @mention detection: @everyone, @here, or personal @username
          const isMention = authUser
            ? (EVERYONE_MENTION_RE.test(msg.content) ||
               HERE_MENTION_RE.test(msg.content) ||
               (() => {
                 const escaped = authUser.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                 return new RegExp(`(?<![a-zA-Z0-9_])@${escaped}(?![a-zA-Z0-9_])`, "i").test(msg.content);
               })())
            : false;

          // Red badge: @mentions only, suppressed by mention-mute
          if (isMention && !isMentionMuted(msg.channelId, parentId, notif)) {
            const newMentions = { ...s.mentionCounts };
            newMentions[msg.channelId] = (newMentions[msg.channelId] ?? 0) + 1;
            result.mentionCounts = newMentions;
          }
        }
      }

      return result;
    });

    // Cache messages for instant loading (imperative, outside setState)
    if (!isFromSelf) {
      const cached = channelMessageCache.get(msg.channelId);
      if (cached) cached.messages = [...cached.messages, msg];
    }
  }
  // Notification (respects per-channel settings, mute, and @mention-only default)
  if (!isFromSelf && (msg.channelId !== state.activeChannelId || !document.hasFocus())) {
    const channel = state.channels.find((c) => c.id === msg.channelId);
    if (shouldNotifyChannel(msg.channelId, msg.senderId, msg.content, channel?.parentId, authUser?.username)) {
      const usernameMap = getUsernameMap(state.members);
      playMessageSound();
      showDesktopNotification(usernameMap[msg.senderId] ?? "Someone", msg.content);
    }
  }
}

export function handleTyping(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => {
    const existing = s.typingUsers[event.channelId];
    const has = existing?.has(event.userId) ?? false;
    // Skip if no-op (already in desired state)
    if (event.active ? has : !has) return s;
    const channelTypers = new Set(existing ?? []);
    if (event.active) channelTypers.add(event.userId);
    else channelTypers.delete(event.userId);
    return { typingUsers: { ...s.typingUsers, [event.channelId]: channelTypers } };
  });
}

export function handleMessageEdit(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => {
    const hasMsg = s.messages.some((m) => m.id === event.messageId);
    const hasSearch = s.searchResults?.some((m) => m.id === event.messageId);
    return {
      ...(hasMsg ? { messages: s.messages.map((m) =>
        m.id === event.messageId ? { ...m, content: event.content, editedAt: event.editedAt } : m
      ) } : {}),
      ...(hasSearch ? { searchResults: s.searchResults!.map((m) =>
        m.id === event.messageId ? { ...m, content: event.content, editedAt: event.editedAt } : m
      ) } : {}),
      decryptedCache: { ...s.decryptedCache, [event.messageId]: event.content },
    };
  });
}

export function handleMessageDelete(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => {
    const hasMsg = s.messages.some((m) => m.id === event.messageId);
    const hasSearch = s.searchResults?.some((m) => m.id === event.messageId);
    if (!hasMsg && !hasSearch) return s;
    return {
      ...(hasMsg ? { messages: s.messages.filter((m) => m.id !== event.messageId) } : {}),
      ...(hasSearch ? { searchResults: s.searchResults!.filter((m) => m.id !== event.messageId) } : {}),
    };
  });
}

export function handleReactionAdd(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
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
}

export function handleReactionRemove(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
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
}

export function handleDMMessage(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
  authStoreRef: AuthStoreRef,
  notifStoreRef: NotifStoreRef,
  dmStoreRef: DMStoreRef,
) {
  const dmState = dmStoreRef?.getState();
  if (event.message.dmChannelId === dmState?.activeDMChannelId) {
    dmStoreRef?.setState((s) => ({
      dmMessages: [...s.dmMessages, event.message],
    }));
  } else {
    // Append to DM cache for instant switching later (create entry if missing)
    const cached = dmMessageCache.get(event.message.dmChannelId);
    if (cached) {
      cached.messages = [...cached.messages, event.message];
    } else {
      dmMessageCache.set(event.message.dmChannelId, {
        messages: [event.message],
        hasMore: true,
        cursor: null,
      });
    }
  }
  // Decrypt and cache + notification
  {
    let dm = dmState?.dmChannels.find((d) => d.id === event.message.dmChannelId);
    const cryptoState = useCryptoStore.getState();
    (async () => {
      // If DM channel not known yet (first message from new conversation),
      // refresh the channels list so we can derive the encryption key
      if (!dm) {
        try {
          const channels = await api.getDMChannels();
          dmStoreRef?.setState({ dmChannels: channels });
          dm = channels.find((d: { id: string }) => d.id === event.message.dmChannelId);
        } catch { /* ignore */ }
      }
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
        const notif = notifStoreRef?.getState();
        if (!notif?.isUserMuted(event.message.senderId)) {
          const currentDMId = dmStoreRef?.getState()?.activeDMChannelId;
          if (event.message.dmChannelId !== currentDMId || !document.hasFocus()) {
            const senderName = dm?.otherUser?.username ?? "Someone";
            playMessageSound();
            showDesktopNotification(senderName, text);
          }
        }
      }
    })();
  }
}
