import { dbg } from "@/lib/debug.js";
import { setAdaptiveTargetBitrate } from "./connection.js";
import type { VoiceState } from "./types.js";
import type { StoreApi } from "zustand";

export function createToggleMute(storeRef: StoreApi<VoiceState>) {
  return () => {
    const { room, isMuted } = storeRef.getState();
    if (!room) return;
    const newMuted = !isMuted;
    dbg("voice", `toggleMute ${newMuted ? "muting" : "unmuting"}`);
    room.localParticipant.setMicrophoneEnabled(!newMuted);
    storeRef.setState({ isMuted: newMuted });
    storeRef.getState()._updateParticipants();
  };
}

export function createSetMuted(storeRef: StoreApi<VoiceState>) {
  return (muted: boolean) => {
    const { room, isMuted } = storeRef.getState();
    if (!room || isMuted === muted) return;
    room.localParticipant.setMicrophoneEnabled(!muted);
    storeRef.setState({ isMuted: muted });
    storeRef.getState()._updateParticipants();
  };
}

export function createToggleDeafen(storeRef: StoreApi<VoiceState>) {
  return () => {
    const { room, isDeafened, isMuted } = storeRef.getState();
    if (!room) return;

    const newDeafened = !isDeafened;
    dbg("voice", `toggleDeafen ${newDeafened ? "deafening" : "undeafening"}`, { wasMuted: isMuted });

    if (newDeafened && !isMuted) {
      room.localParticipant.setMicrophoneEnabled(false);
      storeRef.setState({ isDeafened: newDeafened, isMuted: true });
    } else if (!newDeafened) {
      room.localParticipant.setMicrophoneEnabled(true);
      storeRef.setState({ isDeafened: false, isMuted: false });
    } else {
      storeRef.setState({ isDeafened: newDeafened });
    }
    storeRef.getState()._updateParticipants();
  };
}

export function createSetParticipantVolume(storeRef: StoreApi<VoiceState>) {
  return (participantId: string, volume: number) => {
    storeRef.setState((state) => ({
      participantVolumes: {
        ...state.participantVolumes,
        [participantId]: volume,
      },
    }));
    dbg("voice", `setParticipantVolume stored vol=${volume} participant=${participantId}`);
  };
}

export function createApplyBitrate(storeRef: StoreApi<VoiceState>) {
  return (bitrate: number) => {
    const { room } = storeRef.getState();
    if (!room) return;

    // Reset adaptive state when bitrate is manually set (e.g. channel bitrate change)
    setAdaptiveTargetBitrate(bitrate);

    // Apply constant bitrate via RTCRtpSender (set min = max to force CBR)
    for (const pub of room.localParticipant.audioTrackPublications.values()) {
      const sender = pub.track?.sender;
      if (sender) {
        const params = sender.getParameters();
        if (params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxBitrate = bitrate;
          (params.encodings[0] as any).minBitrate = bitrate;
          sender.setParameters(params);
        }
      }
    }
  };
}
