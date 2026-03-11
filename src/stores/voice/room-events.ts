import { Room, RoomEvent, Track, VideoQuality } from "livekit-client";
import { dbg } from "@/lib/debug.js";
import { playJoinSound, playLeaveSound, playStreamStartSound } from "@/lib/sounds.js";
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

export function setParticipantGain(identity: string, volume: number) {
  const pipeline = participantAudioPipelines.get(identity);
  if (!pipeline) return;
  if (pipeline.gain && pipeline.ctx) {
    pipeline.gain.gain.setValueAtTime(volume, pipeline.ctx.currentTime);
  } else {
    // Fallback: HTMLAudioElement.volume (0-1 range, no boost beyond 100%)
    pipeline.audioEl.volume = Math.min(Math.max(volume, 0), 1);
  }
}

function cleanupParticipantAudio(identity: string) {
  const pipeline = participantAudioPipelines.get(identity);
  if (pipeline) {
    pipeline.source?.disconnect();
    pipeline.gain?.disconnect();
    pipeline.ctx?.close().catch(() => {});
    participantAudioPipelines.delete(identity);
  }
}

function cleanupAllParticipantAudio() {
  for (const identity of participantAudioPipelines.keys()) {
    cleanupParticipantAudio(identity);
  }
}

export function setupRoomEventHandlers(room: Room, storeRef: StoreApi<VoiceState>, isHybrid = false) {
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
      const vol = get().participantVolumes[participant.identity] ?? 1.0;

      // Create a hidden <audio> element to satisfy browser autoplay with LiveKit's attach()
      const el = track.attach() as unknown;
      const audioEl = el instanceof HTMLAudioElement ? el : null;

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
        // Mute the original element to avoid double audio output
        if (audioEl) audioEl.volume = 0;
        pipeline.ctx = ctx;
        pipeline.gain = gain;
        pipeline.source = source as unknown as MediaElementAudioSourceNode;
        dbg("voice", `TrackSubscribed attached audio with GainNode (MediaStreamSource) for ${participant.identity} vol=${vol}`);
      } catch (e) {
        // Fallback: audio plays through raw element, volume limited to 0-100%
        if (audioEl) audioEl.volume = Math.min(Math.max(vol, 0), 1);
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
      const params = pub.track.sender.getParameters();
      if (params.encodings && params.encodings.length > 0) {
        const br = adaptiveTargetBitrate;
        params.encodings[0].maxBitrate = br;
        (params.encodings[0] as any).minBitrate = br;
        pub.track.sender.setParameters(params);
        dbg("voice", `LocalTrackPublished enforced CBR ${br}`);
      }

      // ── Krisp noise suppression ──
      const { audioSettings } = get();
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
