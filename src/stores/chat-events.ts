import type { PresenceStatus } from "../types/shared.js";
import type { StoreApi, UseBoundStore } from "zustand";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../lib/broadcast.js";
import { playMessageSound, showDesktopNotification, shouldNotifyChannel } from "../lib/notifications.js";
import { useCryptoStore } from "./crypto.js";
import { API_BASE } from "../lib/serverUrl.js";
import { dbg } from "../lib/debug.js";
import type { ChatState } from "./chat-types.js";
import {
  EVERYONE_MENTION_RE,
  HERE_MENTION_RE,
  channelMessageCache,
  dmMessageCache,
  getUsernameMap,
} from "./chat-types.js";

// Lazy ref to auth store to avoid circular imports
let authStoreRef: typeof import("../stores/auth.js").useAuthStore | null = null;
import("../stores/auth.js").then((m) => { authStoreRef = m.useAuthStore; });

// Lazy ref to notif store to avoid circular imports
let notifStoreRef: typeof import("../stores/notifications.js").useNotifStore | null = null;
import("../stores/notifications.js").then((m) => { notifStoreRef = m.useNotifStore; });

/** Check whether a channel (or its parent category) is muted. */
function isChannelOrCategoryMuted(
  channelId: string,
  parentId: string | undefined,
  notif: { isChannelMuted: (id: string) => boolean; isCategoryMuted: (id: string) => boolean } | null,
): boolean {
  if (!notif) return false;
  if (notif.isChannelMuted(channelId)) return true;
  if (parentId && notif.isCategoryMuted(parentId)) return true;
  return false;
}

/** Check whether @mention notifications are muted for a channel (or its parent category). */
function isMentionMuted(
  channelId: string,
  parentId: string | undefined,
  notif: { isChannelMentionMuted: (id: string) => boolean; isCategoryMentionMuted: (id: string) => boolean } | null,
): boolean {
  if (!notif) return false;
  return notif.isChannelMentionMuted(channelId) ||
    (!!parentId && notif.isCategoryMentionMuted(parentId));
}

// On WS connect/reconnect: clear stale presence, mark self online
let activityPollInterval: ReturnType<typeof setInterval> | null = null;
let lastActivityName: string | null = null;

export function setupChatEvents(useChatStore: UseBoundStore<StoreApi<ChatState>>) {

gateway.onConnect(() => {
  const user = authStoreRef?.getState()?.user;
  useChatStore.setState({
    onlineUsers: new Set(user ? [user.id] : []),
    userStatuses: user ? { [user.id]: (user.status as PresenceStatus) ?? "online" } : {},
    userActivities: {},
  });

  // Re-subscribe to all text channels for unread tracking, plus the active DM
  const { channels, activeChannelId, activeDMChannelId } = useChatStore.getState();
  const textChannels = channels.filter((c) => c.type === "text");
  if (textChannels.length > 0) {
    for (const ch of textChannels) gateway.send({ type: "join_channel", channelId: ch.id });
  } else if (activeChannelId) {
    // Fallback: no channels loaded yet, just rejoin the active one
    gateway.send({ type: "join_channel", channelId: activeChannelId });
  }
  if (activeDMChannelId) gateway.send({ type: "join_dm", dmChannelId: activeDMChannelId });

  // Initialize E2EE crypto
  useCryptoStore.getState().initialize().catch((e) => dbg("chat", "Crypto init failed:", e));

  // Pre-fetch DM channels for instant DM switching
  useChatStore.getState().loadDMChannels();

  // Initialize Spotify
  import("./spotify.js").then(({ useSpotifyStore }) => {
    useSpotifyStore.getState().loadAccount().catch((e) => dbg("chat", "Spotify init failed:", e));
  });

  // Start activity polling (detect running games/apps via Tauri)
  if (activityPollInterval) clearInterval(activityPollInterval);
  lastActivityName = null;

  async function pollActivity() {
    try {
      // Skip activity detection when not in a voice channel
      const voiceMod = await import("./voice.js");
      if (!voiceMod.useVoiceStore.getState().connectedChannelId) return;
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
      break;
    }

    case "typing":
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
      break;

    case "presence": {
      const selfId = authStoreRef?.getState()?.user?.id;
      // The server broadcasts "offline" to mask invisible users from others, but also sends
      // that broadcast to the user themselves. Skip only those "offline" masking events for self
      // so they don't wipe out our local "invisible" status. Real status updates (e.g. "invisible"
      // sent directly via send_to) are still accepted.
      if (event.userId === selfId && event.status === "offline") break;
      useChatStore.setState((s) => {
        const isOffline = event.status === "offline";
        const wasOnline = s.onlineUsers.has(event.userId);
        const prevStatus = s.userStatuses[event.userId];
        // Skip if already in the desired state
        if (isOffline && !wasOnline) return s;
        if (!isOffline && wasOnline && prevStatus === event.status) return s;
        const newSet = new Set(s.onlineUsers);
        const newStatuses = { ...s.userStatuses };
        if (isOffline) {
          newSet.delete(event.userId);
          delete newStatuses[event.userId];
        } else {
          newSet.add(event.userId);
          newStatuses[event.userId] = event.status as PresenceStatus;
        }
        return { onlineUsers: newSet, userStatuses: newStatuses };
      });
      break;
    }

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
      break;
    }

    case "message_delete": {
      useChatStore.setState((s) => {
        const hasMsg = s.messages.some((m) => m.id === event.messageId);
        const hasSearch = s.searchResults?.some((m) => m.id === event.messageId);
        if (!hasMsg && !hasSearch) return s;
        return {
          ...(hasMsg ? { messages: s.messages.filter((m) => m.id !== event.messageId) } : {}),
          ...(hasSearch ? { searchResults: s.searchResults!.filter((m) => m.id !== event.messageId) } : {}),
        };
      });
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
          c.id === event.channelId
            ? { ...c, ...(event.name != null ? { name: event.name } : {}), bitrate: event.bitrate }
            : c
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
        let dm = state.dmChannels.find((d) => d.id === event.message.dmChannelId);
        const cryptoState = useCryptoStore.getState();
        (async () => {
          // If DM channel not known yet (first message from new conversation),
          // refresh the channels list so we can derive the encryption key
          if (!dm) {
            try {
              const channels = await api.getDMChannels();
              useChatStore.setState({ dmChannels: channels });
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
              if (event.message.dmChannelId !== useChatStore.getState().activeDMChannelId || !document.hasFocus()) {
                const senderName = dm?.otherUser?.username ?? "Someone";
                playMessageSound();
                showDesktopNotification(senderName, text);
              }
            }
          }
        })();
      }
      break;
    }

    case "room_created": {
      // Add room to channels if it belongs to the active server (deduplicate)
      if (event.channel.serverId === state.activeServerId) {
        useChatStore.setState((s) => {
          if (s.channels.some((c) => c.id === event.channel.id)) return s;
          return { channels: [...s.channels, event.channel] };
        });
      }
      break;
    }

    case "room_deleted": {
      if (event.serverId === state.activeServerId) {
        // Find a text channel to fall back to
        const fallbackChannel = state.channels.find(
          (c) => c.type === "text" && c.serverId === event.serverId,
        );

        useChatStore.setState((s) => ({
          channels: s.channels.filter((c) => c.id !== event.channelId),
          ...(s.activeChannelId === event.channelId
            ? { activeChannelId: fallbackChannel?.id ?? null, messages: [], reactions: {} }
            : {}),
        }));
      }
      break;
    }

    case "room_lock_toggled": {
      useChatStore.setState((s) => ({
        channels: s.channels.map((c) =>
          c.id === event.channelId ? { ...c, isLocked: event.isLocked } : c,
        ),
      }));
      break;
    }

    case "room_knock": {
      const timestamp = Date.now();
      useChatStore.setState((s) => ({
        roomKnocks: [...s.roomKnocks, { channelId: event.channelId, userId: event.userId, username: event.username, timestamp }],
      }));
      // Auto-dismiss after 15s
      setTimeout(() => {
        useChatStore.getState().dismissKnock(timestamp);
      }, 15000);
      break;
    }

    case "room_knock_accepted": {
      // Auto-join the room
      import("./voice.js").then((mod) => {
        mod.useVoiceStore.getState().joinVoiceChannel(event.channelId);
      });
      break;
    }

    case "room_invite": {
      const timestamp = Date.now();
      useChatStore.setState((s) => ({
        roomInvites: [...s.roomInvites, { channelId: event.channelId, channelName: event.channelName, inviterUsername: event.inviterUsername, serverId: event.serverId, timestamp }],
      }));
      // Auto-dismiss after 15s
      setTimeout(() => {
        useChatStore.getState().dismissRoomInvite(timestamp);
      }, 15000);
      break;
    }

    case "room_force_move": {
      import("./voice.js").then((mod) => {
        mod.useVoiceStore.getState().joinVoiceChannel(event.targetChannelId);
      });
      break;
    }

    case "soundboard_play": {
      import("./voice.js").then((mod) => {
        const store = mod.useVoiceStore.getState();
        if (store.connectedChannelId !== event.channelId) return;
        store.stopLobbyMusicAction();
        const audioUrl = `${API_BASE}/files/${event.audioAttachmentId}/${event.audioFilename}`;
        const audio = new Audio(audioUrl);
        const masterVolume = parseFloat(localStorage.getItem("soundboard-master-volume") ?? "1");
        audio.volume = Math.min(1, event.volume * masterVolume);
        audio.play().catch(() => {});
      });
      break;
    }
  }
});

// ── BroadcastChannel: publish state to popout windows ──

if (!isPopout()) {
  useChatStore.subscribe((state, prevState) => {
    // Only broadcast when the fields popout windows care about actually changed
    if (state.messages === prevState.messages &&
        state.activeChannelId === prevState.activeChannelId &&
        state.channels === prevState.channels) return;
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

} // end setupChatEvents
