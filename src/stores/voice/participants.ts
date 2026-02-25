import { Track } from "livekit-client";
import type { VoiceState, VoiceUser, ScreenShareInfo } from "./types.js";
import type { VoiceParticipant } from "@/types/shared.js";
import type { StoreApi } from "zustand";

export function createUpdateParticipants(storeRef: StoreApi<VoiceState>) {
  return () => {
    const { room, isMuted: localMuted, isDeafened: localDeafened } = storeRef.getState();
    if (!room) return;

    const users: VoiceUser[] = [];

    const local = room.localParticipant;
    users.push({
      userId: local.identity,
      username: local.name ?? local.identity.slice(0, 8),
      isMuted: localMuted,
      isDeafened: localDeafened,
    });

    for (const participant of room.remoteParticipants.values()) {
      users.push({
        userId: participant.identity,
        username: participant.name ?? participant.identity.slice(0, 8),
        isMuted: !participant.isMicrophoneEnabled,
        isDeafened: false,
      });
    }

    storeRef.setState({ participants: users });
  };
}

export function createUpdateScreenSharers(storeRef: StoreApi<VoiceState>) {
  return () => {
    const { room, screenSharers: previousSharers, pinnedScreenShare } = storeRef.getState();
    if (!room) return;

    const sharers: ScreenShareInfo[] = [];

    // Check local
    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      if (pub.source === Track.Source.ScreenShare) {
        sharers.push({
          participantId: room.localParticipant.identity,
          username: room.localParticipant.name ?? room.localParticipant.identity.slice(0, 8),
        });
        break;
      }
    }

    // Check remote
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.videoTrackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare) {
          sharers.push({
            participantId: participant.identity,
            username: participant.name ?? participant.identity.slice(0, 8),
          });
          break;
        }
      }
    }

    const newIds = new Set(sharers.map((s) => s.participantId));

    let clearPin = false;
    for (const s of previousSharers) {
      if (!newIds.has(s.participantId)) {
        if (pinnedScreenShare === s.participantId) {
          clearPin = true;
        }
      }
    }

    // Auto-pin first sharer if nothing is pinned
    let newPin = clearPin ? null : pinnedScreenShare;
    if (!newPin && sharers.length > 0) {
      newPin = sharers[0].participantId;
    }

    storeRef.setState({
      screenSharers: sharers,
      pinnedScreenShare: newPin,
      // Exit theatre mode if no more screen shares
      ...(sharers.length === 0 ? { theatreMode: false } : {}),
    });
  };
}

export function createSetChannelParticipants(storeRef: StoreApi<VoiceState>) {
  return (channelId: string, participants: VoiceParticipant[]) => {
    storeRef.setState((state) => ({
      channelParticipants: {
        ...state.channelParticipants,
        [channelId]: participants,
      },
    }));
  };
}
