import type { PresenceStatus } from "../../types/shared.js";
import type { StoreApi, UseBoundStore } from "zustand";
import { gateway } from "../../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../../lib/broadcast.js";
import { useCryptoStore } from "../crypto.js";
import { dbg } from "../../lib/debug.js";
import type { ChatState } from "./types.js";

// ── Message handlers ──
import {
  handleMessage,
  handleTyping,
  handleMessageEdit,
  handleMessageDelete,
  handleReactionAdd,
  handleReactionRemove,
  handleDMMessage,
} from "./events-messages.js";

// ── Member / presence handlers ──
import {
  handlePresence,
  handleActivityUpdate,
  handleMemberJoined,
  handleServerKeyShared,
  handleServerKeyRequested,
  handleMemberLeft,
  handleServerUpdated,
  handleServerDeleted,
  handleMemberRoleUpdated,
  handleProfileUpdate,
} from "./events-members.js";

// ── Channel / room handlers ──
import {
  handleChannelUpdate,
  handleRoomCreated,
  handleRoomDeleted,
  handleRoomLockToggled,
} from "./events-channels.js";

// ── Voice / room interaction handlers ──
import {
  handleRoomKnock,
  handleRoomKnockAccepted,
  handleRoomInvite,
  handleRoomForceMove,
  handleSoundboardPlay,
} from "./events-voice.js";

// ── Lazy store refs (shared with domain modules via exported types) ──

export type AuthStoreRef = typeof import("../auth.js").useAuthStore | null;
export type NotifStoreRef = typeof import("../notifications.js").useNotifStore | null;
export type DMStoreRef = typeof import("../dm/store.js").useDMStore | null;

let authStoreRef: AuthStoreRef = null;
import("../auth.js").then((m) => { authStoreRef = m.useAuthStore; });

let notifStoreRef: NotifStoreRef = null;
import("../notifications.js").then((m) => { notifStoreRef = m.useNotifStore; });

let dmStoreRef: DMStoreRef = null;
import("../dm/store.js").then((m) => { dmStoreRef = m.useDMStore; });

// ── Shared helpers (exported for domain modules) ──

export type IsChannelOrCategoryMutedFn = typeof isChannelOrCategoryMuted;
export type IsMentionMutedFn = typeof isMentionMuted;

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

// ── Activity polling state ──

let activityPollInterval: ReturnType<typeof setInterval> | null = null;
let lastActivityName: string | null = null;

// ── Main setup ──

export function setupChatEvents(useChatStore: UseBoundStore<StoreApi<ChatState>>) {

// On WS connect/reconnect: clear stale presence, mark self online
gateway.onConnect(() => {
  const user = authStoreRef?.getState()?.user;
  useChatStore.setState({
    onlineUsers: new Set(user ? [user.id] : []),
    userStatuses: user ? { [user.id]: (user.status as PresenceStatus) ?? "online" } : {},
    userActivities: {},
  });

  // Re-subscribe to all text channels for unread tracking, plus the active DM
  const { channels, activeChannelId } = useChatStore.getState();
  const activeDMChannelId = dmStoreRef?.getState()?.activeDMChannelId ?? null;
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
  dmStoreRef?.getState().loadDMChannels();

  // Initialize Spotify
  import("../spotify/store.js").then(({ useSpotifyStore }) => {
    useSpotifyStore.getState().loadAccount().catch((e) => dbg("chat", "Spotify init failed:", e));
  });

  // Start activity polling (detect running games/apps via Tauri)
  if (activityPollInterval) clearInterval(activityPollInterval);
  lastActivityName = null;

  async function pollActivity() {
    try {
      // Skip activity detection when not in a voice channel
      const voiceMod = await import("../voice/store.js");
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

// ── Event dispatcher ──

gateway.on((event) => {
  const state = useChatStore.getState();

  switch (event.type) {
    // Messages
    case "message":
      handleMessage(event, state, useChatStore, authStoreRef, notifStoreRef, isChannelOrCategoryMuted, isMentionMuted);
      break;
    case "typing":
      handleTyping(event, useChatStore);
      break;
    case "message_edit":
      handleMessageEdit(event, useChatStore);
      break;
    case "message_delete":
      handleMessageDelete(event, useChatStore);
      break;
    case "reaction_add":
      handleReactionAdd(event, useChatStore);
      break;
    case "reaction_remove":
      handleReactionRemove(event, useChatStore);
      break;
    case "dm_message":
      handleDMMessage(event, useChatStore, authStoreRef, notifStoreRef, dmStoreRef);
      break;

    // Members & presence
    case "presence":
      handlePresence(event, useChatStore, authStoreRef);
      break;
    case "activity_update":
      handleActivityUpdate(event, useChatStore);
      break;
    case "member_joined":
      handleMemberJoined(event, state, useChatStore);
      break;
    case "server_key_shared":
      handleServerKeyShared(event);
      break;
    case "server_key_requested":
      handleServerKeyRequested(event);
      break;
    case "member_left":
      handleMemberLeft(event, state, useChatStore);
      break;
    case "server_updated":
      handleServerUpdated(event, useChatStore);
      break;
    case "server_deleted":
      handleServerDeleted(event, useChatStore);
      break;
    case "member_role_updated":
      handleMemberRoleUpdated(event, useChatStore, authStoreRef);
      break;
    case "profile_update":
      handleProfileUpdate(event, useChatStore);
      break;

    // Channels & rooms
    case "channel_update":
      handleChannelUpdate(event, useChatStore);
      break;
    case "room_created":
      handleRoomCreated(event, state, useChatStore);
      break;
    case "room_deleted":
      handleRoomDeleted(event, state, useChatStore);
      break;
    case "room_lock_toggled":
      handleRoomLockToggled(event, useChatStore);
      break;

    // Voice / room interactions
    case "room_knock":
      handleRoomKnock(event, useChatStore);
      break;
    case "room_knock_accepted":
      handleRoomKnockAccepted(event);
      break;
    case "room_invite":
      handleRoomInvite(event, useChatStore);
      break;
    case "room_force_move":
      handleRoomForceMove(event);
      break;
    case "soundboard_play":
      handleSoundboardPlay(event);
      break;
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
