import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatState } from "./types.js";
import { API_BASE } from "@/lib/serverUrl.js";

// Lazy ref to auth store (avoids circular import)
let _authStore: { getState: () => { user?: { id: string } | null } } | null = null;
import("@/stores/auth.js").then((m) => { _authStore = m.useAuthStore; });

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
    // Don't play sounds for ourselves — local sounds in connection.ts handle the self case.
    // Use both auth store user ID and LiveKit local participant identity for robustness.
    const myId = _authStore?.getState()?.user?.id;
    const localIdentity = store.room?.localParticipant?.identity;
    if (myId && event.userId === myId) return;
    if (localIdentity && event.userId === localIdentity) return;
    // Respect deafen state
    if (store.isDeafened) return;

    if (event.soundUrl) {
      // Play beep/boop indicator first, then the custom sound after a short gap
      // to avoid simultaneous playback causing audio artifacts
      import("@/lib/sounds.js").then((sounds) => {
        if (event.action === "join") sounds.playJoinBeep();
        else sounds.playLeaveBeep();
      });
      // Delay custom sound so the beep finishes cleanly before it starts
      setTimeout(() => {
        const audioUrl = `${API_BASE}${event.soundUrl}`;
        fetch(audioUrl)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.blob();
          })
          .then((blob) => {
            const blobUrl = URL.createObjectURL(blob);
            const audio = new Audio(blobUrl);
            audio.volume = 0.5;
            audio.onended = () => URL.revokeObjectURL(blobUrl);
            audio.onerror = () => URL.revokeObjectURL(blobUrl);
            return audio.play();
          })
          .catch(() => {});
      }, 180);
    } else {
      // Fall back to procedural sounds for other users
      import("@/lib/sounds.js").then((sounds) => {
        if (event.action === "join") sounds.playJoinSound();
        else sounds.playLeaveSound();
      });
    }
  });
}
