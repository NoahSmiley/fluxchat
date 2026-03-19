import { Room, RoomEvent, Track, VideoQuality } from "livekit-client";
import { dbg } from "@/lib/debug.js";
import { playStreamStartSound } from "@/lib/sounds.js";
import { checkLobbyMusic } from "./lobby.js";
import { stopStatsPolling } from "./stats.js";
import { adaptiveTargetBitrate, activeKrispProcessor, activeVadProcessor, setActiveKrispProcessor, setActiveVadProcessor } from "./connection.js";
import { attachNoiseFilter, detachNoiseFilter } from "@/lib/noiseProcessor.js";
import { resetAdaptiveBitrate } from "@/lib/adaptiveBitrate.js";
import type { VoiceState } from "./types.js";
import type { StoreApi } from "zustand";

const SPEAKING_ON_THRESHOLD = 0.06; // must exceed this to start speaking
const SPEAKING_OFF_THRESHOLD = 0.025; // must drop below this to stop speaking (hysteresis)
const SPEAKING_HOLD_MS = 500; // hold speaking state for 500ms after audio drops
const POLL_INTERVAL_MS = 50; // 20fps
const EMA_ALPHA = 0.35; // exponential moving average smoothing (lower = smoother, more lag)

// ── Per-participant audio pipelines (GainNode for volume control) ──
interface ParticipantAudio {
  audioEl: HTMLAudioElement;
  ctx?: AudioContext;
  gain?: GainNode;
  source?: MediaElementAudioSourceNode;
}
const participantAudioPipelines = new Map<string, ParticipantAudio>();

// Current master speaker volume (updated by store action)
let masterSpeakerVolume = 1.0;

export function setParticipantGain(identity: string, volume: number) {
  const effective = volume * masterSpeakerVolume;
  const pipeline = participantAudioPipelines.get(identity);
  if (!pipeline) return;
  if (pipeline.gain && pipeline.ctx) {
    pipeline.gain.gain.setValueAtTime(effective, pipeline.ctx.currentTime);
  } else {
    // Fallback: HTMLAudioElement.volume (0-1 range, no boost beyond 100%)
    pipeline.audioEl.volume = Math.min(Math.max(effective, 0), 1);
  }
}

function cleanupParticipantAudio(identity: string) {
  const pipeline = participantAudioPipelines.get(identity);
  if (pipeline) {
    pipeline.source?.disconnect();
    pipeline.gain?.disconnect();
    pipeline.ctx?.close().catch(() => {});
    // Fully stop the audio element to prevent leaked playback
    pipeline.audioEl.pause();
    pipeline.audioEl.volume = 0;
    pipeline.audioEl.srcObject = null;
    pipeline.audioEl.remove();
    participantAudioPipelines.delete(identity);
  }
}

function cleanupAllParticipantAudio() {
  for (const identity of participantAudioPipelines.keys()) {
    cleanupParticipantAudio(identity);
  }
}

/** Mute or restore all participant audio (used by deafen toggle). */
export function setAllParticipantGains(muted: boolean, volumes: Record<string, number>) {
  for (const [identity, pipeline] of participantAudioPipelines) {
    const vol = muted ? 0 : (volumes[identity] ?? 1.0) * masterSpeakerVolume;
    if (pipeline.gain && pipeline.ctx) {
      pipeline.gain.gain.setValueAtTime(vol, pipeline.ctx.currentTime);
    } else {
      pipeline.audioEl.volume = Math.min(Math.max(vol, 0), 1);
    }
  }
}

/** Update master speaker volume and re-apply all gains. */
export function setMasterSpeakerGain(volume: number, participantVolumes: Record<string, number>, isDeafened: boolean) {
  masterSpeakerVolume = volume;
  setAllParticipantGains(isDeafened, participantVolumes);
}

// ── Local mic gain pipeline ──
let localMicCtx: AudioContext | null = null;
let localMicGain: GainNode | null = null;
let localMicSource: MediaStreamAudioSourceNode | null = null;

export function setupLocalMicGain(mediaStreamTrack: MediaStreamTrack, micVolume: number): MediaStreamTrack | null {
  cleanupLocalMicGain();
  try {
    localMicCtx = new AudioContext();
    localMicSource = localMicCtx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    localMicGain = localMicCtx.createGain();
    localMicGain.gain.value = micVolume;
    const dest = localMicCtx.createMediaStreamDestination();
    localMicSource.connect(localMicGain);
    localMicGain.connect(dest);
    return dest.stream.getAudioTracks()[0];
  } catch (e) {
    dbg("voice", "setupLocalMicGain failed", e);
    cleanupLocalMicGain();
    return null;
  }
}

export function setLocalMicGain(volume: number) {
  if (localMicGain && localMicCtx) {
    localMicGain.gain.setValueAtTime(volume, localMicCtx.currentTime);
  }
}

export function cleanupLocalMicGain() {
  localMicSource?.disconnect();
  localMicGain?.disconnect();
  localMicCtx?.close().catch(() => {});
  localMicCtx = null;
  localMicGain = null;
  localMicSource = null;
}

export function setupRoomEventHandlers(room: Room, storeRef: StoreApi<VoiceState>, isHybrid = false) {
  const get = () => storeRef.getState();
  const set = (partial: Partial<VoiceState> | ((state: VoiceState) => Partial<VoiceState>)) => {
    storeRef.setState(partial as any);
  };

  // Initialize master speaker volume from saved settings
  masterSpeakerVolume = get().audioSettings.speakerVolume;

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
  const smoothedLevels = new Map<string, number>(); // EMA-smoothed audio levels
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // Track who is currently considered speaking (avoids creating new Set every poll)
  let currentSpeaking = new Set<string>();

  /** Apply exponential moving average to smooth noisy audio levels */
  function smoothLevel(identity: string, rawLevel: number): number {
    const prev = smoothedLevels.get(identity) ?? 0;
    const smoothed = EMA_ALPHA * rawLevel + (1 - EMA_ALPHA) * prev;
    smoothedLevels.set(identity, smoothed);
    return smoothed;
  }

  /** Evaluate a single participant's speaking state with hysteresis */
  function evaluateSpeaking(
    identity: string,
    level: number,
    now: number,
    nextSpeaking: Set<string>,
  ) {
    const wasSpeaking = currentSpeaking.has(identity);
    // Hysteresis: higher threshold to start, lower to stop
    const threshold = wasSpeaking ? SPEAKING_OFF_THRESHOLD : SPEAKING_ON_THRESHOLD;

    if (level > threshold) {
      nextSpeaking.add(identity);
      speakingHoldTimers.set(identity, now);
    } else if (speakingHoldTimers.has(identity)) {
      if (now - speakingHoldTimers.get(identity)! < SPEAKING_HOLD_MS) {
        nextSpeaking.add(identity);
      } else {
        speakingHoldTimers.delete(identity);
      }
    }
  }

  const pollAudioLevels = () => {
    const nextSpeaking = new Set<string>();
    const now = Date.now();

    // Local participant: use Web Audio analyser for instant detection
    const localId = room.localParticipant.identity;
    const localLevel = get().isMuted ? 0 : smoothLevel(localId, getLocalLevel());
    evaluateSpeaking(localId, localLevel, now, nextSpeaking);
    if (nextSpeaking.has(localId) && !currentSpeaking.has(localId)) {
      set({ lastSpokeAt: now });
    }

    // Remote participants: use LiveKit's audioLevel (server-driven)
    for (const p of room.remoteParticipants.values()) {
      evaluateSpeaking(p.identity, smoothLevel(p.identity, p.audioLevel ?? 0), now, nextSpeaking);
    }

    // Only update React state if the speaking set actually changed
    if (nextSpeaking.size !== currentSpeaking.size ||
        [...nextSpeaking].some((id) => !currentSpeaking.has(id))) {
      currentSpeaking = nextSpeaking;
      set({ speakingUserIds: nextSpeaking });
    } else {
      currentSpeaking = nextSpeaking;
    }
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
    cleanupLocalMicGain();
    speakingHoldTimers.clear();
    smoothedLevels.clear();

    // Clean up audio processors
    detachNoiseFilter(activeKrispProcessor).catch(() => {});
    setActiveKrispProcessor(null);
    activeVadProcessor?.destroy().catch(() => {});
    setActiveVadProcessor(null);
    resetAdaptiveBitrate();

    // Also disconnect screen room if audio room drops (hybrid mode)
    const { screenRoom } = get();
    if (screenRoom) {
      screenRoom.removeAllListeners();
      screenRoom.disconnect();
    }

    dbg("voice", `Room Disconnected reason=${reason}`);
    stopStatsPolling();
    set({
      room: null,
      screenRoom: null,
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
    // Join sound now played via voice_join_leave WebSocket event (supports custom sounds)
  });
  room.on(RoomEvent.ParticipantDisconnected, (p) => {
    dbg("voice", `ParticipantDisconnected identity=${p.identity}`);
    get()._updateParticipants();
    get()._updateScreenSharers();
    checkLobbyMusic();
    // Leave sound now played via voice_join_leave WebSocket event (supports custom sounds)
  });
  room.on(RoomEvent.ParticipantMetadataChanged, (_prevMetadata, participant) => {
    dbg("voice", `ParticipantMetadataChanged participant=${participant.identity} metadata=${participant.metadata}`);
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
  room.on(RoomEvent.TrackSubscribed, async (track, _publication, participant) => {
    dbg("voice", `TrackSubscribed participant=${participant.identity} kind=${track.kind} sid=${track.sid}`, {
      source: _publication.source,
      mimeType: _publication.mimeType,
      simulcasted: _publication.simulcasted,
      trackEnabled: track.mediaStreamTrack?.enabled,
      trackReadyState: track.mediaStreamTrack?.readyState,
    });

    if (track.kind === Track.Kind.Audio) {
      get()._updateParticipants();
      const mst = track.mediaStreamTrack;
      if (!mst) {
        dbg("voice", `TrackSubscribed no mediaStreamTrack for ${participant.identity}`);
        return;
      }

      cleanupParticipantAudio(participant.identity);
      const partVol = get().participantVolumes[participant.identity] ?? 1.0;
      const vol = get().isDeafened ? 0 : partVol * masterSpeakerVolume;

      // Create a hidden <audio> element to satisfy browser autoplay with LiveKit's attach()
      const el = track.attach() as unknown;
      const audioEl = el instanceof HTMLAudioElement ? el : null;
      // Mute the element IMMEDIATELY to prevent double audio during async GainNode setup
      if (audioEl) audioEl.volume = 0;

      const pipeline: ParticipantAudio = { audioEl: audioEl ?? new Audio() };
      try {
        // Use createMediaStreamSource (more reliable for WebRTC than createMediaElementSource)
        const ctx = new AudioContext();
        await ctx.resume();
        const source = ctx.createMediaStreamSource(new MediaStream([mst]));
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(vol, ctx.currentTime);
        source.connect(gain);
        gain.connect(ctx.destination);
        pipeline.ctx = ctx;
        pipeline.gain = gain;
        pipeline.source = source as unknown as MediaElementAudioSourceNode;
        dbg("voice", `TrackSubscribed attached audio with GainNode (MediaStreamSource) for ${participant.identity} vol=${vol}`);
      } catch (e) {
        // Fallback: audio plays through raw element, volume limited to 0-100%
        if (pipeline.audioEl) pipeline.audioEl.volume = Math.min(Math.max(vol, 0), 1);
        dbg("voice", `TrackSubscribed GainNode failed for ${participant.identity}, using element volume`, e);
      }
      participantAudioPipelines.set(participant.identity, pipeline);
    }
    if (track.kind === Track.Kind.Video && !isHybrid) {
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
    if (track.kind === Track.Kind.Video && !isHybrid) {
      get()._updateScreenSharers();
    }
  });

  room.on(RoomEvent.LocalTrackPublished, async (pub) => {
    dbg("voice", `LocalTrackPublished source=${pub.source} sid=${pub.trackSid}`);
    if (pub.track?.sender && pub.source === Track.Source.Microphone) {
      // ── Mic volume gain ──
      const { audioSettings } = get();
      if (audioSettings.micVolume !== 1.0) {
        const mst = pub.track.mediaStreamTrack;
        if (mst) {
          const adjustedTrack = setupLocalMicGain(mst, audioSettings.micVolume);
          if (adjustedTrack) {
            await pub.track.sender.replaceTrack(adjustedTrack);
            dbg("voice", `LocalTrackPublished mic gain applied vol=${audioSettings.micVolume}`);
          }
        }
      }

      const params = pub.track.sender.getParameters();
      if (params.encodings && params.encodings.length > 0) {
        const br = adaptiveTargetBitrate;
        params.encodings[0].maxBitrate = br;
        (params.encodings[0] as any).minBitrate = br;
        pub.track.sender.setParameters(params);
        dbg("voice", `LocalTrackPublished enforced CBR ${br}`);
      }

      // ── Krisp noise suppression ──
      if (audioSettings.noiseSuppression) {
        const processor = await attachNoiseFilter(pub);
        if (processor) setActiveKrispProcessor(processor);
      }
    }
    if (!isHybrid) get()._updateScreenSharers();
  });
  room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    dbg("voice", `LocalTrackUnpublished source=${pub.source} sid=${pub.trackSid}`);
    if (!isHybrid) {
      set({ isScreenSharing: false });
      get()._updateScreenSharers();
    }
  });
  room.on(RoomEvent.TrackPublished, (_pub, participant) => {
    dbg("voice", `TrackPublished remote participant=${participant.identity}`);
    if (_pub.source === Track.Source.ScreenShare) playStreamStartSound();
    if (!isHybrid) get()._updateScreenSharers();
  });
  room.on(RoomEvent.TrackUnpublished, (_pub, participant) => {
    dbg("voice", `TrackUnpublished remote participant=${participant.identity}`);
    if (!isHybrid) get()._updateScreenSharers();
  });
}

// ── Screen Room Event Handlers (hybrid mode — video only) ──
export function setupScreenRoomEventHandlers(screenRoom: Room, storeRef: StoreApi<VoiceState>) {
  const get = () => storeRef.getState();
  const set = (partial: Partial<VoiceState> | ((state: VoiceState) => Partial<VoiceState>)) => {
    storeRef.setState(partial as any);
  };

  screenRoom.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind === Track.Kind.Video) {
      dbg("voice", `[screenRoom] TrackSubscribed video from ${participant.identity}`);
      if (_publication.source === Track.Source.ScreenShare) {
        _publication.setVideoDimensions({ width: 1920, height: 1080 });
        _publication.setVideoQuality(VideoQuality.HIGH);
      }
      get()._updateScreenSharers();
    }
  });

  screenRoom.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
    if (track.kind === Track.Kind.Video) {
      dbg("voice", `[screenRoom] TrackUnsubscribed video from ${participant?.identity}`);
      const detached = track.detach();
      detached.forEach((el) => el.remove());
      get()._updateScreenSharers();
    }
  });

  screenRoom.on(RoomEvent.LocalTrackPublished, (pub) => {
    dbg("voice", `[screenRoom] LocalTrackPublished source=${pub.source}`);
    if (pub.source === Track.Source.ScreenShare) {
      set({ isScreenSharing: true });
    }
    get()._updateScreenSharers();
  });

  screenRoom.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    dbg("voice", `[screenRoom] LocalTrackUnpublished source=${pub.source}`);
    if (pub.source === Track.Source.ScreenShare) {
      set({ isScreenSharing: false });
    }
    get()._updateScreenSharers();
  });

  screenRoom.on(RoomEvent.TrackPublished, (_pub, participant) => {
    dbg("voice", `[screenRoom] TrackPublished remote participant=${participant.identity}`);
    if (_pub.source === Track.Source.ScreenShare) playStreamStartSound();
    get()._updateScreenSharers();
  });

  screenRoom.on(RoomEvent.TrackUnpublished, (_pub, participant) => {
    dbg("voice", `[screenRoom] TrackUnpublished remote participant=${participant.identity}`);
    get()._updateScreenSharers();
  });

  screenRoom.on(RoomEvent.Disconnected, (reason) => {
    dbg("voice", `[screenRoom] Disconnected reason=${reason}`);
    // Reset screen share state only — don't trigger full leave
    set({
      screenRoom: null,
      isScreenSharing: false,
      screenSharers: [],
      pinnedScreenShare: null,
    });
  });
}
