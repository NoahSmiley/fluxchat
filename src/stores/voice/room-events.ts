import { Room, RoomEvent, Track, VideoQuality } from "livekit-client";
import { dbg } from "../../lib/debug.js";
import {
  playJoinSound,
  playLeaveSound,
} from "../../lib/audio/voice-effects.js";
import {
  createAudioPipeline,
  destroyAudioPipeline,
  destroyAllPipelines,
} from "../../lib/audio/voice-pipeline.js";
import { stopAudioLevelPolling } from "../../lib/audio/voice-analysis.js";
import { checkLobbyMusic } from "./lobby.js";
import { stopStatsPolling } from "./stats.js";
import { adaptiveTargetBitrate } from "./connection.js";
import type { VoiceState } from "./types.js";
import type { StoreApi } from "zustand";

export function setupRoomEventHandlers(room: Room, storeRef: StoreApi<VoiceState>) {
  const get = () => storeRef.getState();
  const set = (partial: Partial<VoiceState> | ((state: VoiceState) => Partial<VoiceState>)) => {
    storeRef.setState(partial as any);
  };

  room.on(RoomEvent.ParticipantConnected, (p) => {
    dbg("voice", `ParticipantConnected identity=${p.identity} name=${p.name}`);
    playJoinSound();
    get()._updateParticipants();
    checkLobbyMusic();
  });
  room.on(RoomEvent.ParticipantDisconnected, (p) => {
    dbg("voice", `ParticipantDisconnected identity=${p.identity}`);
    playLeaveSound();
    get()._updateParticipants();
    get()._updateScreenSharers();
    checkLobbyMusic();
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    dbg("voice", `ActiveSpeakersChanged count=${speakers.length}`, speakers.map((s) => s.identity));
    get()._updateParticipants();
  });
  room.on(RoomEvent.TrackMuted, (pub, participant) => {
    dbg("voice", `TrackMuted participant=${participant.identity} track=${pub.trackSid} source=${pub.source}`);
    get()._updateParticipants();
  });
  room.on(RoomEvent.TrackUnmuted, (pub, participant) => {
    dbg("voice", `TrackUnmuted participant=${participant.identity} track=${pub.trackSid} source=${pub.source}`);
    get()._updateParticipants();
  });

  // Attach remote audio tracks with Web Audio pipeline
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    dbg("voice", `TrackSubscribed participant=${participant.identity} kind=${track.kind} sid=${track.sid}`, {
      source: _publication.source,
      mimeType: _publication.mimeType,
      simulcasted: _publication.simulcasted,
      trackEnabled: track.mediaStreamTrack?.enabled,
      trackReadyState: track.mediaStreamTrack?.readyState,
    });

    if (track.kind === Track.Kind.Audio) {
      const audioEl = track.attach() as HTMLAudioElement;
      dbg("voice", `TrackSubscribed attached audio for ${participant.identity}`, {
        paused: audioEl.paused,
        readyState: audioEl.readyState,
        srcObject: !!audioEl.srcObject,
        trackEnabled: track.mediaStreamTrack?.enabled,
        trackReadyState: track.mediaStreamTrack?.readyState,
      });

      const { audioSettings: settings, participantVolumes, isDeafened } = get();
      const volume = isDeafened ? 0 : (participantVolumes[participant.identity] ?? 1.0);
      dbg("voice", `TrackSubscribed creating pipeline for ${participant.identity}`, { volume, isDeafened });
      createAudioPipeline(audioEl, track.sid!, settings, volume);

      // Track participant → track mapping
      set((state) => ({
        participantTrackMap: {
          ...state.participantTrackMap,
          [participant.identity]: track.sid!,
        },
      }));
    }
    if (track.kind === Track.Kind.Video) {
      dbg("voice", `TrackSubscribed video from ${participant.identity}, updating screen sharers`);
      if (_publication.source === Track.Source.ScreenShare) {
        _publication.setVideoDimensions({ width: 1920, height: 1080 });
        _publication.setVideoQuality(VideoQuality.HIGH);
      }
      get()._updateScreenSharers();
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
    dbg("voice", `TrackUnsubscribed participant=${participant?.identity} kind=${track.kind} sid=${track.sid}`);
    if (track.kind === Track.Kind.Audio) {
      destroyAudioPipeline(track.sid!);
      if (participant) {
        set((state) => {
          const newMap = { ...state.participantTrackMap };
          delete newMap[participant.identity];
          return { participantTrackMap: newMap };
        });
      }
    }
    const detached = track.detach();
    dbg("voice", `TrackUnsubscribed detached ${detached.length} HTML element(s)`);
    detached.forEach((el) => el.remove());
    if (track.kind === Track.Kind.Video) {
      get()._updateScreenSharers();
    }
  });

  room.on(RoomEvent.LocalTrackPublished, (pub) => {
    dbg("voice", `LocalTrackPublished source=${pub.source} sid=${pub.trackSid}`);
    if (pub.track?.sender && pub.source === Track.Source.Microphone) {
      const params = pub.track.sender.getParameters();
      if (params.encodings && params.encodings.length > 0) {
        const br = adaptiveTargetBitrate;
        params.encodings[0].maxBitrate = br;
        (params.encodings[0] as any).minBitrate = br;
        pub.track.sender.setParameters(params);
        dbg("voice", `LocalTrackPublished enforced CBR ${br}`);
      }
    }
    get()._updateScreenSharers();
  });
  room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    dbg("voice", `LocalTrackUnpublished source=${pub.source} sid=${pub.trackSid}`);
    set({ isScreenSharing: false });
    get()._updateScreenSharers();
  });
  room.on(RoomEvent.TrackPublished, (_pub, participant) => {
    dbg("voice", `TrackPublished remote participant=${participant.identity}`);
    get()._updateScreenSharers();
  });
  room.on(RoomEvent.TrackUnpublished, (_pub, participant) => {
    dbg("voice", `TrackUnpublished remote participant=${participant.identity}`);
    get()._updateScreenSharers();
  });
  room.on(RoomEvent.Disconnected, (reason) => {
    dbg("voice", `Room Disconnected reason=${reason}`);
    destroyAllPipelines();
    stopAudioLevelPolling();
    stopStatsPolling();
    set({
      room: null,
      connectedChannelId: null,
      participants: [],
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      screenSharers: [],
      participantTrackMap: {},
      audioLevels: {},
      speakingUserIds: new Set<string>(),
      pinnedScreenShare: null,
    });
  });
}
