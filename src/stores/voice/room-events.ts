import { Room, RoomEvent, Track, VideoQuality } from "livekit-client";
import { dbg } from "@/lib/debug.js";
import { playJoinSound, playLeaveSound } from "@/lib/sounds.js";
import { checkLobbyMusic } from "./lobby.js";
import { stopStatsPolling } from "./stats.js";
import { adaptiveTargetBitrate } from "./connection.js";
import type { VoiceState } from "./types.js";
import type { StoreApi } from "zustand";

const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_HOLD_MS = 200;
const POLL_INTERVAL_MS = 50; // 20fps

// ── Per-participant audio pipelines (GainNode for volume control) ──
interface ParticipantAudio {
  ctx: AudioContext;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
}
const participantAudioPipelines = new Map<string, ParticipantAudio>();

export function setParticipantGain(identity: string, volume: number) {
  const pipeline = participantAudioPipelines.get(identity);
  if (pipeline) {
    pipeline.gain.gain.setValueAtTime(volume, pipeline.ctx.currentTime);
  }
}

function cleanupParticipantAudio(identity: string) {
  const pipeline = participantAudioPipelines.get(identity);
  if (pipeline) {
    pipeline.source.disconnect();
    pipeline.gain.disconnect();
    pipeline.ctx.close().catch(() => {});
    participantAudioPipelines.delete(identity);
  }
}

function cleanupAllParticipantAudio() {
  for (const identity of participantAudioPipelines.keys()) {
    cleanupParticipantAudio(identity);
  }
}

export function setupRoomEventHandlers(room: Room, storeRef: StoreApi<VoiceState>) {
  const get = () => storeRef.getState();
  const set = (partial: Partial<VoiceState> | ((state: VoiceState) => Partial<VoiceState>)) => {
    storeRef.setState(partial as any);
  };

  // ── Local mic audio level via Web Audio API (instant) ──
  let localAnalyser: AnalyserNode | null = null;
  let localAudioCtx: AudioContext | null = null;
  let localSource: MediaStreamAudioSourceNode | null = null;
  const analyserData = new Uint8Array(256);

  function attachLocalAnalyser() {
    cleanupLocalAnalyser();
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const mst = pub?.track?.mediaStreamTrack;
    if (!mst) return;
    try {
      localAudioCtx = new AudioContext();
      localSource = localAudioCtx.createMediaStreamSource(new MediaStream([mst]));
      localAnalyser = localAudioCtx.createAnalyser();
      localAnalyser.fftSize = 256;
      localSource.connect(localAnalyser);
    } catch { /* ignore */ }
  }

  function cleanupLocalAnalyser() {
    localSource?.disconnect();
    localAnalyser?.disconnect();
    localAudioCtx?.close().catch(() => {});
    localAnalyser = null;
    localAudioCtx = null;
    localSource = null;
  }

  function getLocalLevel(): number {
    if (!localAnalyser) return 0;
    localAnalyser.getByteTimeDomainData(analyserData);
    let sum = 0;
    for (let i = 0; i < analyserData.length; i++) {
      const v = (analyserData[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / analyserData.length);
  }

  // Attach analyser once mic track is published
  room.on(RoomEvent.LocalTrackPublished, (pub) => {
    if (pub.source === Track.Source.Microphone) attachLocalAnalyser();
  });
  room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    if (pub.source === Track.Source.Microphone) cleanupLocalAnalyser();
  });
  // Also attach if mic is already published
  if (room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track) {
    attachLocalAnalyser();
  }

  // ── Polling loop for speaking indicators ──
  const speakingHoldTimers = new Map<string, number>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const pollAudioLevels = () => {
    const speaking = new Set<string>();
    const now = Date.now();

    // Local participant: use Web Audio analyser for instant detection
    const localId = room.localParticipant.identity;
    const localLevel = get().isMuted ? 0 : getLocalLevel();

    if (localLevel > SPEAKING_THRESHOLD) {
      speaking.add(localId);
      speakingHoldTimers.set(localId, now);
      set({ lastSpokeAt: now });
    } else if (speakingHoldTimers.has(localId)) {
      if (now - speakingHoldTimers.get(localId)! < SPEAKING_HOLD_MS) {
        speaking.add(localId);
      } else {
        speakingHoldTimers.delete(localId);
      }
    }

    // Remote participants: use LiveKit's audioLevel (server-driven, best available)
    for (const p of room.remoteParticipants.values()) {
      const level = p.audioLevel ?? 0;

      if (level > SPEAKING_THRESHOLD) {
        speaking.add(p.identity);
        speakingHoldTimers.set(p.identity, now);
      } else if (speakingHoldTimers.has(p.identity)) {
        if (now - speakingHoldTimers.get(p.identity)! < SPEAKING_HOLD_MS) {
          speaking.add(p.identity);
        } else {
          speakingHoldTimers.delete(p.identity);
        }
      }
    }

    set({ speakingUserIds: speaking });
  };

  pollTimer = setInterval(pollAudioLevels, POLL_INTERVAL_MS);

  // Clean up on disconnect (single handler for both local resources and store state)
  room.on(RoomEvent.Disconnected, (reason) => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    cleanupLocalAnalyser();
    cleanupAllParticipantAudio();
    speakingHoldTimers.clear();
    dbg("voice", `Room Disconnected reason=${reason}`);
    stopStatsPolling();
    set({
      room: null,
      connectedChannelId: null,
      participants: [],
      isMuted: false,
      isDeafened: false,
      isScreenSharing: false,
      screenSharers: [],
      speakingUserIds: new Set<string>(),
      pinnedScreenShare: null,
    });
  });

  room.on(RoomEvent.ParticipantConnected, (p) => {
    dbg("voice", `ParticipantConnected identity=${p.identity} name=${p.name}`);
    get()._updateParticipants();
    checkLobbyMusic();
    playJoinSound();
  });
  room.on(RoomEvent.ParticipantDisconnected, (p) => {
    dbg("voice", `ParticipantDisconnected identity=${p.identity}`);
    get()._updateParticipants();
    get()._updateScreenSharers();
    checkLobbyMusic();
    playLeaveSound();
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
      get()._updateParticipants();
      const elements = track.attach();
      const audioEl = elements.find((el): el is HTMLAudioElement => el instanceof HTMLAudioElement);
      if (audioEl) {
        try {
          // Route through GainNode for per-participant volume control (supports 0-200%)
          const ctx = new AudioContext();
          const source = ctx.createMediaElementSource(audioEl);
          const gain = ctx.createGain();
          const vol = get().participantVolumes[participant.identity] ?? 1.0;
          gain.gain.setValueAtTime(vol, ctx.currentTime);
          source.connect(gain);
          gain.connect(ctx.destination);
          cleanupParticipantAudio(participant.identity);
          participantAudioPipelines.set(participant.identity, { ctx, gain, source });
          dbg("voice", `TrackSubscribed attached audio with GainNode for ${participant.identity} vol=${vol}`);
        } catch (e) {
          dbg("voice", `TrackSubscribed GainNode setup failed for ${participant.identity}, using raw attach`, e);
        }
      } else {
        dbg("voice", `TrackSubscribed attached audio for ${participant.identity} (no HTMLAudioElement)`);
      }
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
    if (track.kind === Track.Kind.Audio && participant) {
      cleanupParticipantAudio(participant.identity);
      get()._updateParticipants();
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
}
