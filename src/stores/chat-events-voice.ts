import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatState } from "./chat-types.js";
import { API_BASE } from "../lib/serverUrl.js";

// ── Voice / room interaction event handlers ──

export function handleRoomKnock(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  const timestamp = Date.now();
  useChatStore.setState((s) => ({
    roomKnocks: [...s.roomKnocks, { channelId: event.channelId, userId: event.userId, username: event.username, timestamp }],
  }));
  // Auto-dismiss after 15s
  setTimeout(() => {
    useChatStore.getState().dismissKnock(timestamp);
  }, 15000);
}

export function handleRoomKnockAccepted(event: any) {
  // Auto-join the room
  import("./voice.js").then((mod) => {
    mod.useVoiceStore.getState().joinVoiceChannel(event.channelId);
  });
}

export function handleRoomInvite(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  const timestamp = Date.now();
  useChatStore.setState((s) => ({
    roomInvites: [...s.roomInvites, { channelId: event.channelId, channelName: event.channelName, inviterUsername: event.inviterUsername, serverId: event.serverId, timestamp }],
  }));
  // Auto-dismiss after 15s
  setTimeout(() => {
    useChatStore.getState().dismissRoomInvite(timestamp);
  }, 15000);
}

export function handleRoomForceMove(event: any) {
  import("./voice.js").then((mod) => {
    mod.useVoiceStore.getState().joinVoiceChannel(event.targetChannelId);
  });
}

export function handleSoundboardPlay(event: any) {
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
}
