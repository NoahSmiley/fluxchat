import type { StoreApi, UseBoundStore } from "zustand";
import type { ChatState } from "./types.js";

// ── Channel / room event handlers ──

export function handleChannelUpdate(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => ({
    channels: s.channels.map((c) =>
      c.id === event.channelId
        ? { ...c, ...(event.name != null ? { name: event.name } : {}), bitrate: event.bitrate }
        : c
    ),
  }));
  // Apply bitrate change if connected to this voice channel
  import("@/stores/voice/store.js").then((mod) => {
    const voiceState = mod.useVoiceStore.getState();
    if (voiceState.connectedChannelId === event.channelId && event.bitrate != null) {
      voiceState.applyBitrate(event.bitrate);
    }
  });
}

export function handleRoomCreated(
  event: any,
  state: ChatState,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  // Add room to channels if it belongs to the active server (deduplicate)
  if (event.channel.serverId === state.activeServerId) {
    useChatStore.setState((s) => {
      if (s.channels.some((c) => c.id === event.channel.id)) return s;
      return { channels: [...s.channels, event.channel] };
    });
  }
}

export function handleRoomDeleted(
  event: any,
  state: ChatState,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
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
}

export function handleRoomLockToggled(
  event: any,
  useChatStore: UseBoundStore<StoreApi<ChatState>>,
) {
  useChatStore.setState((s) => ({
    channels: s.channels.map((c) =>
      c.id === event.channelId ? { ...c, isLocked: event.isLocked } : c,
    ),
  }));
}
