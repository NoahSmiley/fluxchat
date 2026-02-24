import { dbg } from "@/lib/debug.js";
import {
  playMuteSound,
  playUnmuteSound,
  playDeafenSound,
  playUndeafenSound,
} from "@/lib/audio/voice-effects.js";
import {
  audioPipelines,
  setGainValue,
} from "@/lib/audio/voice-pipeline.js";
import { getLocalMicTrack } from "@/lib/audio/voice-analysis.js";
import { setAdaptiveTargetBitrate } from "./connection.js";
import type { VoiceState } from "./types.js";
import type { StoreApi } from "zustand";

export function createToggleMute(storeRef: StoreApi<VoiceState>) {
  return () => {
    const { room, isMuted } = storeRef.getState();
    if (!room) return;
    const newMuted = !isMuted;
    dbg("voice", `toggleMute ${newMuted ? "muting" : "unmuting"}`);
    // Ensure noise gate track state is in sync when unmuting
    const micTrack = getLocalMicTrack();
    if (!newMuted && micTrack) micTrack.enabled = true;
    room.localParticipant.setMicrophoneEnabled(!newMuted);
    if (newMuted) playMuteSound(); else playUnmuteSound();
    storeRef.setState({ isMuted: newMuted });
    storeRef.getState()._updateParticipants();
  };
}

export function createSetMuted(storeRef: StoreApi<VoiceState>) {
  return (muted: boolean) => {
    const { room, isMuted } = storeRef.getState();
    if (!room || isMuted === muted) return;
    // Ensure noise gate track state is in sync when unmuting
    const micTrack = getLocalMicTrack();
    if (!muted && micTrack) micTrack.enabled = true;
    room.localParticipant.setMicrophoneEnabled(!muted);
    storeRef.setState({ isMuted: muted });
    storeRef.getState()._updateParticipants();
  };
}

export function createToggleDeafen(storeRef: StoreApi<VoiceState>) {
  return () => {
    const { room, isDeafened, isMuted, participantVolumes, participantTrackMap } = storeRef.getState();
    if (!room) return;

    const newDeafened = !isDeafened;
    dbg("voice", `toggleDeafen ${newDeafened ? "deafening" : "undeafening"}`, { wasMuted: isMuted });

    if (newDeafened) {
      playDeafenSound();
      // Mute all audio via gain nodes
      for (const pipeline of audioPipelines.values()) {
        setGainValue(pipeline, 0);
      }
    } else {
      playUndeafenSound();
      // Restore per-user volumes
      for (const [identity, trackSid] of Object.entries(participantTrackMap)) {
        const pipeline = audioPipelines.get(trackSid);
        if (pipeline) {
          setGainValue(pipeline, participantVolumes[identity] ?? 1.0);
        }
      }
    }

    if (newDeafened && !isMuted) {
      room.localParticipant.setMicrophoneEnabled(false);
      storeRef.setState({ isDeafened: newDeafened, isMuted: true });
    } else if (!newDeafened) {
      // Undeafening also unmutes the mic — ensure gate track state is in sync
      const micTrack = getLocalMicTrack();
      if (micTrack) micTrack.enabled = true;
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
    const { participantTrackMap, isDeafened, room } = storeRef.getState();

    storeRef.setState((state) => ({
      participantVolumes: {
        ...state.participantVolumes,
        [participantId]: volume,
      },
    }));

    if (isDeafened) return;

    // Primary lookup: participantTrackMap → audioPipeline
    let trackSid = participantTrackMap[participantId];
    let pipeline = trackSid ? audioPipelines.get(trackSid) : undefined;

    // Fallback: if the track map doesn't have this participant, search
    // through the room's remote participants directly and repair the map
    if (!pipeline && room) {
      const remote = room.remoteParticipants.get(participantId);
      if (remote) {
        for (const pub of remote.audioTrackPublications.values()) {
          if (pub.track?.sid) {
            const fallbackPipeline = audioPipelines.get(pub.track.sid);
            if (fallbackPipeline) {
              pipeline = fallbackPipeline;
              trackSid = pub.track.sid;
              // Repair the stale track map
              storeRef.setState((state) => ({
                participantTrackMap: { ...state.participantTrackMap, [participantId]: pub.track!.sid! },
              }));
              dbg("voice", `setParticipantVolume repaired trackMap for ${participantId} → ${trackSid}`);
              break;
            }
          }
        }
      }
    }

    if (pipeline) {
      if (pipeline.context.state === "suspended") pipeline.context.resume();
      setGainValue(pipeline, volume);
      dbg("voice", `setParticipantVolume applied vol=${volume} ctx=${pipeline.context.state} participant=${participantId}`);
    } else {
      dbg("voice", `setParticipantVolume NO PIPELINE for ${participantId} trackSid=${trackSid} mapKeys=[${Object.keys(participantTrackMap)}] pipelineKeys=[${[...audioPipelines.keys()]}]`);
    }
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
