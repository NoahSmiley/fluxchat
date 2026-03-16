import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatState } from "./types.js";
import { API_BASE } from "@/lib/serverUrl.js";

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
  import("@/stores/voice/store.js").then((mod) => {
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
  import("@/stores/voice/store.js").then((mod) => {
    mod.useVoiceStore.getState().joinVoiceChannel(event.targetChannelId);
  });
}

export function handleSoundboardPlay(event: any) {
  import("@/stores/voice/store.js").then((mod) => {
    const store = mod.useVoiceStore.getState();
    if (store.connectedChannelId !== event.channelId) return;
    store.stopLobbyMusicAction();
    const audioUrl = `${API_BASE}/files/${event.audioAttachmentId}/${event.audioFilename}`;
    const masterVolume = parseFloat(localStorage.getItem("soundboard-master-volume") ?? "1");
    const audio = new Audio(audioUrl);
    audio.volume = Math.min(1, event.volume * masterVolume);
    audio.play().catch(() => {});
  });
}

export function handleVoiceJoinLeave(event: { channelId: string; userId: string; username: string; action: "join" | "leave"; soundUrl?: string }) {
  import("@/stores/voice/store.js").then((mod) => {
    const store = mod.useVoiceStore.getState();
    // Only play sounds if we're in the same voice channel
    if (store.connectedChannelId !== event.channelId) return;
    // Don't play sounds for ourselves
    import("@/stores/auth.js").then(({ useAuthStore }) => {
      const myId = useAuthStore.getState().user?.id;
      if (event.userId === myId) return;
      // Respect deafen state
      if (store.isDeafened) return;

      if (event.soundUrl) {
        // Play custom sound
        const audioUrl = `${API_BASE}${event.soundUrl}`;
        const audio = new Audio(audioUrl);
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } else {
        // Fall back to procedural sounds
        import("@/lib/sounds.js").then((sounds) => {
          if (event.action === "join") sounds.playJoinSound();
          else sounds.playLeaveSound();
        });
      }
    });
  });
}
