import { Track } from "livekit-client";
import { dbg } from "@/lib/debug.js";
import { calculateRms, audioPipelines, getPipelineLevel } from "./voice-pipeline.js";
import { AUDIO_LEVEL_INTERVAL_MS } from "./voice-constants.js";

// ── Audio Level Polling + Noise Gate ──

let audioLevelInterval: ReturnType<typeof setInterval> | null = null;
let gatedSilentSince: number | null = null; // timestamp when audio dropped below threshold
let isGated = false; // whether the noise gate is currently muting the mic

// Per-user speaking hysteresis — instant on, 200ms hold before off
const SPEAKING_THRESHOLD = 0.005;
const SPEAKING_HOLD_MS = 200;
const userLastSpokeMap = new Map<string, number>(); // userId → timestamp of last above-threshold

// Local mic analyser for real-time level metering
let localAnalyserCtx: AudioContext | null = null;
let localAnalyser: AnalyserNode | null = null;
let localAnalyserSource: MediaStreamAudioSourceNode | null = null;
let localAnalyserData: Float32Array<ArrayBuffer> | null = null;
// Reference to the LiveKit mic MediaStreamTrack for noise gate control.
// We gate by setting track.enabled = false (sends silence) instead of
// setMicrophoneEnabled() which changes the publication state visible to others.
let localMicTrack: MediaStreamTrack | null = null;
let localAnalyserClone: MediaStreamTrack | null = null;

export function getLocalMicTrack(): MediaStreamTrack | null {
  return localMicTrack;
}

function setupLocalAnalyser(room: any) {
  teardownLocalAnalyser();
  try {
    let mediaStreamTrack: MediaStreamTrack | undefined;
    for (const pub of room.localParticipant.audioTrackPublications.values()) {
      dbg("voice", `[analyser] found audio pub: ${pub.source} has track: ${!!pub.track}`);
      if (pub.source === Track.Source.Microphone && pub.track) {
        mediaStreamTrack = pub.track.mediaStreamTrack;
        dbg("voice", `[analyser] mic mediaStreamTrack: ${mediaStreamTrack?.kind} readyState: ${mediaStreamTrack?.readyState}`);
        break;
      }
    }
    if (!mediaStreamTrack) {
      dbg("voice", "[analyser] no mic track found, pubs count:", room.localParticipant.audioTrackPublications.size);
      return;
    }

    // Store the original track for noise gate control
    localMicTrack = mediaStreamTrack;

    // Clone the track for the analyser so it always reads real audio levels
    // even when the gate disables the original track
    localAnalyserClone = mediaStreamTrack.clone();

    // Match the track's sample rate (DTLN outputs 16kHz, normal mic is 48kHz)
    const trackSettings = mediaStreamTrack.getSettings();
    const sampleRate = trackSettings.sampleRate || 48000;
    localAnalyserCtx = new AudioContext({ sampleRate });
    // Resume in case it's suspended (browser autoplay policy)
    if (localAnalyserCtx.state === "suspended") {
      localAnalyserCtx.resume();
    }
    localAnalyser = localAnalyserCtx.createAnalyser();
    localAnalyser.fftSize = 256;
    localAnalyserData = new Float32Array(localAnalyser.fftSize);

    const stream = new MediaStream([localAnalyserClone]);
    localAnalyserSource = localAnalyserCtx.createMediaStreamSource(stream);
    localAnalyserSource.connect(localAnalyser);
    dbg("voice", "[analyser] setup complete, ctx state:", localAnalyserCtx.state);
  } catch (e) {
    dbg("voice", "[analyser] Failed to setup:", e);
    teardownLocalAnalyser();
  }
}

function teardownLocalAnalyser() {
  try { localAnalyserSource?.disconnect(); } catch {}
  localAnalyserSource = null;
  localAnalyser = null;
  localAnalyserData = null;
  localMicTrack = null;
  if (localAnalyserClone) {
    localAnalyserClone.stop();
    localAnalyserClone = null;
  }
  if (localAnalyserCtx) {
    // Suspend first to stop audio processing immediately, then close
    localAnalyserCtx.suspend().catch(() => {});
    localAnalyserCtx.close().catch(() => {});
    localAnalyserCtx = null;
  }
}

function getLocalMicLevel(): number {
  if (!localAnalyser || !localAnalyserData) return 0;
  localAnalyser.getFloatTimeDomainData(localAnalyserData);
  return calculateRms(localAnalyserData);
}

// Convert sensitivity (0-100) to an audio level threshold (0.0-1.0)
// Uses a quadratic curve so low values are fine-grained (speech range)
// and high values gate more aggressively. RMS of normal speech ≈ 0.01-0.05.
function sensitivityToThreshold(sensitivity: number): number {
  const t = sensitivity / 100;
  return t * t * 0.1; // 10% → 0.001, 50% → 0.025, 100% → 0.1
}

export function startAudioLevelPolling(useVoiceStore: any) {
  stopAudioLevelPolling();

  // Delay analyser setup slightly to ensure mic track is published
  setTimeout(() => {
    const { room } = useVoiceStore.getState();
    if (room) setupLocalAnalyser(room);
  }, 500);

  audioLevelInterval = setInterval(() => {
    const state = useVoiceStore.getState();
    const { room } = state;
    if (!room) return;

    // Set up analyser if not yet ready (mic track may arrive late)
    if (!localAnalyser) setupLocalAnalyser(room);

    const levels: Record<string, number> = {};
    const localLevel = getLocalMicLevel();
    levels[room.localParticipant.identity] = localLevel;

    // Track last non-silence transmission for idle detection
    const VOICE_ACTIVE_THRESHOLD = 0.01;
    if (!state.isMuted && localLevel > VOICE_ACTIVE_THRESHOLD) {
      useVoiceStore.setState({ lastSpokeAt: Date.now() });
    }

    // Use pipeline analysers for remote participants (more reliable than p.audioLevel)
    const { participantTrackMap } = state;
    for (const p of room.remoteParticipants.values()) {
      const trackSid = participantTrackMap[p.identity];
      const pipeline = trackSid ? audioPipelines.get(trackSid) : undefined;
      levels[p.identity] = pipeline ? getPipelineLevel(pipeline) : (p.audioLevel ?? 0);
    }
    useVoiceStore.setState({ audioLevels: levels });

    // ── Speaking hysteresis: instant on, 200ms hold off ──
    const now = Date.now();
    const prevSpeaking = state.speakingUserIds;
    const nextSpeaking = new Set<string>();
    for (const [uid, level] of Object.entries(levels)) {
      if (level > SPEAKING_THRESHOLD) {
        userLastSpokeMap.set(uid, now);
        nextSpeaking.add(uid);
      } else {
        const lastSpoke = userLastSpokeMap.get(uid);
        if (lastSpoke && now - lastSpoke < SPEAKING_HOLD_MS) {
          nextSpeaking.add(uid); // hold speaking state
        }
      }
    }
    // Only update store if the set actually changed (avoids unnecessary re-renders)
    let changed = nextSpeaking.size !== prevSpeaking.size;
    if (!changed) {
      for (const uid of nextSpeaking) {
        if (!prevSpeaking.has(uid)) { changed = true; break; }
      }
    }
    if (changed) {
      useVoiceStore.setState({ speakingUserIds: nextSpeaking });
    }

    // ── Noise gate logic ──
    // Uses localMicTrack.enabled to gate audio (sends silence) without changing
    // the LiveKit publication state. This way other participants don't see
    // mute/unmute flicker from the gate — only manual mute is visible to others.
    const { audioSettings, isMuted } = state;
    if (!audioSettings.inputSensitivityEnabled || isMuted) {
      // Reset gate state; re-enable track if not manually muted
      if (isGated) {
        isGated = false;
        gatedSilentSince = null;
        if (!isMuted && localMicTrack) {
          localMicTrack.enabled = true;
        }
      }
      return;
    }

    const threshold = sensitivityToThreshold(audioSettings.inputSensitivity);

    if (localLevel < threshold) {
      // Audio below threshold
      if (!gatedSilentSince) {
        gatedSilentSince = Date.now();
      } else if (!isGated && Date.now() - gatedSilentSince > audioSettings.noiseGateHoldTime) {
        // Silent for holdTime — gate the mic (send silence via track.enabled)
        isGated = true;
        if (localMicTrack) localMicTrack.enabled = false;
      }
    } else {
      // Audio above threshold — open gate immediately
      gatedSilentSince = null;
      if (isGated) {
        isGated = false;
        if (localMicTrack) localMicTrack.enabled = true;
      }
    }
  }, AUDIO_LEVEL_INTERVAL_MS); // 20fps for smooth visuals
}

export function stopAudioLevelPolling() {
  if (audioLevelInterval) {
    clearInterval(audioLevelInterval);
    audioLevelInterval = null;
  }
  teardownLocalAnalyser();
  isGated = false;
  gatedSilentSince = null;
  userLastSpokeMap.clear();
}
