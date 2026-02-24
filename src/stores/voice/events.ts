import type { VoiceParticipant } from "../../types/shared.js";
import { gateway } from "../../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../../lib/broadcast.js";
import { dbg } from "../../lib/debug.js";
import type { StoreApi } from "zustand";
import type { VoiceState } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// WebSocket Event Handlers
// ═══════════════════════════════════════════════════════════════════

// Lazy ref to auth store (avoids circular import)
let _authStore: { getState: () => { user?: { id: string } | null } } | null = null;
import("../auth.js").then((m) => { _authStore = m.useAuthStore; });

export function initVoiceEvents(store: StoreApi<VoiceState>) {
  // Listen for voice_state events from WebSocket (for sidebar display)
  gateway.on((event) => {
    if (event.type === "voice_state") {
      const { connectedChannelId, room } = store.getState();
      let { participants } = event;
      dbg("voice", `voice_state received ch=${event.channelId} participants=${participants.length} connectedCh=${connectedChannelId}`, participants);

      if (connectedChannelId === event.channelId) {
        // We're connected to this channel — if the server sent an empty list
        // (e.g. after backend restart), ensure our own entry is preserved
        // and re-announce so the server catches up.
        const localId = room?.localParticipant?.identity;
        if (localId && !participants.some((p: VoiceParticipant) => p.userId === localId)) {
          const localName = room?.localParticipant?.name ?? localId.slice(0, 8);
          participants = [...participants, { userId: localId, username: localName, drinkCount: 0 }];
          // Re-announce our presence so the server adds us
          gateway.send({ type: "voice_state_update", channelId: event.channelId, action: "join" });
          dbg("voice", "voice_state: self missing from connected channel — re-announcing join");
        }
      } else {
        // Not connected to this channel — filter out our own userId
        // so stale backend broadcasts don't re-add our avatar after leaving
        const userId = _authStore?.getState()?.user?.id;
        if (userId) {
          participants = participants.filter((p: VoiceParticipant) => p.userId !== userId);
        }
      }
      store.getState()._setChannelParticipants(event.channelId, participants);
    }
  });

  // Re-announce voice state on WebSocket reconnect (e.g. after server restart)
  gateway.onConnect(() => {
    const { connectedChannelId } = store.getState();
    if (connectedChannelId) {
      gateway.send({ type: "voice_state_update", channelId: connectedChannelId, action: "join" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // BroadcastChannel Sync (Popout Windows)
  // ═══════════════════════════════════════════════════════════════════

  function broadcastVoiceState() {
    const state = store.getState();
    const pinnedSharer = state.screenSharers.find(
      (s) => s.participantId === state.pinnedScreenShare,
    );
    broadcastState({
      type: "voice-state",
      connectedChannelId: state.connectedChannelId,
      watchingScreenShare: state.pinnedScreenShare,
      screenSharerParticipantId: pinnedSharer?.participantId ?? null,
      screenSharerUsername: pinnedSharer?.username ?? null,
    });
  }

  if (!isPopout()) {
    // Broadcast voice state on changes
    store.subscribe(() => broadcastVoiceState());

    // Respond to request-state from popout windows
    onCommand((cmd) => {
      if (cmd.type === "request-state") {
        broadcastVoiceState();
      }
    });
  }
}
