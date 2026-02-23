import { create } from "zustand";
import { Room, RoomEvent, Track, VideoPreset, VideoQuality, ExternalE2EEKeyProvider } from "livekit-client";
import type { VoiceParticipant } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../lib/broadcast.js";
import { DtlnTrackProcessor } from "../lib/dtln/DtlnTrackProcessor.js";
import type { TrackProcessor, AudioProcessorOptions } from "livekit-client";

// ── Noise Suppression Model Selection ──
export type NoiseSuppressionModel = "off" | "speex" | "rnnoise" | "dtln" | "deepfilter" | "nsnet2";
import { useKeybindsStore } from "./keybinds.js";
import { useCryptoStore } from "./crypto.js";
import { exportKeyAsBase64 } from "../lib/crypto.js";
import { dbg } from "../lib/debug.js";
import { collectWebRTCStats, resetStatsDelta, type WebRTCQualityStats } from "../lib/webrtcStats.js";

// ── Sound Effects ──

function playTone(frequencies: number[], duration = 0.08) {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.value = 0.15;
  let t = ctx.currentTime;
  for (const freq of frequencies) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + duration);
    t += duration + 0.02;
  }
  gain.gain.setValueAtTime(0.15, t - 0.02);
  gain.gain.linearRampToValueAtTime(0, t + 0.05);
  setTimeout(() => ctx.close(), (t - ctx.currentTime + 0.1) * 1000);
}

function playJoinSound() {
  playTone([480]);
}

function playLeaveSound() {
  playTone([380]);
}

function playScreenShareStartSound() {
  playTone([660, 880], 0.06);
}

function playScreenShareStopSound() {
  playTone([880, 660], 0.06);
}

function playMuteSound() {
  playTone([480, 320], 0.05);
}

function playUnmuteSound() {
  playTone([320, 480], 0.05);
}

function playDeafenSound() {
  playTone([400, 280, 200], 0.04);
}

function playUndeafenSound() {
  playTone([200, 280, 400], 0.04);
}

// ── Audio Pipeline (Web Audio API) ──

interface AudioPipeline {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  element: HTMLAudioElement;
  highPass: BiquadFilterNode;
  lowPass: BiquadFilterNode;
  deEsser: BiquadFilterNode | null;
  compressor: DynamicsCompressorNode | null;
  gain: GainNode;
  analyser: AnalyserNode;
  analyserData: Float32Array;
}

const audioPipelines = new Map<string, AudioPipeline>();

// Monotonically increasing counter to detect stale joinVoiceChannel calls
let joinNonce = 0;

function createAudioPipeline(
  audioElement: HTMLAudioElement,
  trackSid: string,
  settings: AudioSettings,
  volume: number,
): AudioPipeline {
  const mst = (audioElement.srcObject as MediaStream)?.getAudioTracks()[0];
  dbg("voice", `createAudioPipeline sid=${trackSid}`, {
    elementPaused: audioElement.paused,
    elementReadyState: audioElement.readyState,
    elementSrcObject: !!audioElement.srcObject,
    trackKind: mst?.kind,
    trackEnabled: mst?.enabled,
    trackReadyState: mst?.readyState,
    trackMuted: mst?.muted,
    trackLabel: mst?.label,
    volume,
    highPass: settings.highPassFrequency,
    lowPass: settings.lowPassFrequency,
    pipelinesActive: audioPipelines.size,
  });

  // Silence the attached element — all playback goes through the Web Audio pipeline.
  // Use volume=0 (not mute/pause/remove) so the element keeps "playing" and
  // the WebRTC track stays active and feeds data to our MediaStreamSource.
  audioElement.volume = 0;
  dbg("voice", `createAudioPipeline silenced element volume=${audioElement.volume}`);

  const context = new AudioContext();
  dbg("voice", `createAudioPipeline audioContext created state=${context.state} sampleRate=${context.sampleRate}`);
  if (context.state === "suspended") {
    context.resume().then(() => {
      dbg("voice", `createAudioPipeline audioContext resumed state=${context.state}`);
    });
  }

  // Use createMediaStreamSource with the raw MediaStreamTrack — this works
  // reliably with WebRTC tracks (unlike createMediaElementSource which
  // doesn't capture audio from srcObject-based elements).
  const stream = new MediaStream([mst!]);
  const source = context.createMediaStreamSource(stream);
  dbg("voice", `createAudioPipeline mediaStreamSource created channelCount=${source.channelCount}`);

  // Explicit mono→stereo: duplicate channel 0 to both L and R
  // so audio always plays through both ears regardless of source channel count
  const splitter = context.createChannelSplitter(1);
  const merger = context.createChannelMerger(2);
  source.connect(splitter);
  splitter.connect(merger, 0, 0); // → left
  splitter.connect(merger, 0, 1); // → right

  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = settings.highPassFrequency > 0 ? settings.highPassFrequency : 0;

  const lowPass = context.createBiquadFilter();
  lowPass.type = "lowpass";
  lowPass.frequency.value = settings.lowPassFrequency > 0 ? settings.lowPassFrequency : 24000;

  const gain = context.createGain();
  // Fade in over 50ms to prevent click/pop when pipeline starts
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(volume, context.currentTime + 0.05);

  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const analyserData = new Float32Array(analyser.fftSize);

  // Build chain: merger -> highPass -> lowPass -> [deEsser] -> [compressor] -> analyser -> gain -> destination
  merger.connect(highPass);
  highPass.connect(lowPass);

  let lastNode: AudioNode = lowPass;

  // De-esser: highshelf filter that attenuates sibilance (4-8kHz range)
  let deEsser: BiquadFilterNode | null = null;
  if (settings.deEsserEnabled) {
    deEsser = context.createBiquadFilter();
    deEsser.type = "highshelf";
    deEsser.frequency.value = 5500;
    deEsser.gain.value = -(settings.deEsserStrength / 100) * 12; // 0 to -12dB
    lastNode.connect(deEsser);
    lastNode = deEsser;
  }

  // Compressor: dynamics compression
  let compressor: DynamicsCompressorNode | null = null;
  if (settings.compressorEnabled) {
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = settings.compressorThreshold;
    compressor.ratio.value = settings.compressorRatio;
    compressor.attack.value = settings.compressorAttack;
    compressor.release.value = settings.compressorRelease;
    compressor.knee.value = 10;
    lastNode.connect(compressor);
    lastNode = compressor;
  }

  lastNode.connect(analyser);
  analyser.connect(gain);
  gain.connect(context.destination);

  const pipeline: AudioPipeline = { context, source, element: audioElement, highPass, lowPass, deEsser, compressor, gain, analyser, analyserData };
  audioPipelines.set(trackSid, pipeline);

  // Diagnostic: check if audio data is flowing after 1 second
  setTimeout(() => {
    if (!audioPipelines.has(trackSid)) return;
    analyser.getFloatTimeDomainData(analyserData);
    let sum = 0;
    for (let i = 0; i < analyserData.length; i++) sum += analyserData[i] * analyserData[i];
    const rms = Math.sqrt(sum / analyserData.length);
    dbg("voice", `createAudioPipeline DIAG sid=${trackSid}`, {
      contextState: context.state,
      rms: rms.toFixed(6),
      hasSignal: rms > 0.0001,
      gainValue: gain.gain.value,
      elementPaused: audioElement.paused,
      elementEnded: audioElement.ended,
      elementCurrentTime: audioElement.currentTime,
      trackEnabled: mst?.enabled,
      trackReadyState: mst?.readyState,
      trackMuted: mst?.muted,
    });
  }, 1500);

  return pipeline;
}

function getPipelineLevel(pipeline: AudioPipeline): number {
  pipeline.analyser.getFloatTimeDomainData(pipeline.analyserData);
  let sum = 0;
  for (let i = 0; i < pipeline.analyserData.length; i++) {
    sum += pipeline.analyserData[i] * pipeline.analyserData[i];
  }
  return Math.sqrt(sum / pipeline.analyserData.length);
}

function destroyAudioPipeline(trackSid: string) {
  const pipeline = audioPipelines.get(trackSid);
  if (pipeline) {
    dbg("voice", `destroyAudioPipeline sid=${trackSid}`, { remaining: audioPipelines.size - 1 });
    // Mute gain instantly to prevent static/click on teardown
    try { pipeline.gain.gain.setValueAtTime(0, pipeline.context.currentTime); } catch {}
    // Disconnect all nodes from destination
    try { pipeline.gain.disconnect(); } catch {}
    try { pipeline.source.disconnect(); } catch {}
    pipeline.element.pause();
    pipeline.element.srcObject = null;
    pipeline.context.close();
    audioPipelines.delete(trackSid);
  }
}

/** Rebuild all active audio pipelines (e.g. when compressor/de-esser is toggled) */
function rebuildAllPipelines(settings: AudioSettings, get: () => VoiceState) {
  const { participantVolumes, participantTrackMap, isDeafened } = get();
  for (const [trackSid, pipeline] of audioPipelines.entries()) {
    const element = pipeline.element;
    // Find participant identity for this trackSid to get their volume
    let volume = 1.0;
    for (const [identity, sid] of Object.entries(participantTrackMap)) {
      if (sid === trackSid) {
        volume = isDeafened ? 0 : (participantVolumes[identity] ?? 1.0);
        break;
      }
    }
    destroyAudioPipeline(trackSid);
    // Only rebuild if the element still has a source
    if (element.srcObject) {
      createAudioPipeline(element, trackSid, settings, volume);
    }
  }
}

function destroyAllPipelines() {
  dbg("voice", `destroyAllPipelines count=${audioPipelines.size}`);
  for (const trackSid of [...audioPipelines.keys()]) {
    destroyAudioPipeline(trackSid);
  }
}

// ── AI Noise Suppression (multiple models) ──

let noiseProcessor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> | null = null;
let activeNoiseModel: NoiseSuppressionModel = "off";
let noiseSwitchNonce = 0; // concurrency guard for model switching
let dryWetProcessor: import("../lib/DryWetTrackProcessor.js").DryWetTrackProcessor | null = null;
let gainTrackProcessor: import("../lib/GainTrackProcessor.js").GainTrackProcessor | null = null;

async function createNoiseProcessor(model: NoiseSuppressionModel): Promise<TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>> {
  switch (model) {
    case "speex": {
      const { SpeexTrackProcessor } = await import("../lib/speex/SpeexTrackProcessor.js");
      return new SpeexTrackProcessor();
    }
    case "dtln":
      return new DtlnTrackProcessor();
    case "rnnoise": {
      const { RnnoiseTrackProcessor } = await import("../lib/rnnoise/RnnoiseTrackProcessor.js");
      return new RnnoiseTrackProcessor();
    }
    case "deepfilter": {
      const { DeepFilterTrackProcessor } = await import("../lib/deepfilter/DeepFilterTrackProcessor.js");
      return new DeepFilterTrackProcessor();
    }
    case "nsnet2": {
      const { NSNet2TrackProcessor } = await import("../lib/nsnet2/NSNet2TrackProcessor.js");
      return new NSNet2TrackProcessor();
    }
    default:
      throw new Error(`Unknown noise suppression model: ${model}`);
  }
}

async function getOrCreateNoiseProcessor(model: NoiseSuppressionModel) {
  if (model === "off") {
    await destroyNoiseProcessor();
    return null;
  }
  // If switching models, destroy old first
  if (noiseProcessor && activeNoiseModel !== model) {
    await destroyNoiseProcessor();
  }
  if (!noiseProcessor) {
    noiseProcessor = await createNoiseProcessor(model);
    activeNoiseModel = model;
  }
  return noiseProcessor;
}

async function destroyNoiseProcessor() {
  if (noiseProcessor) {
    await (noiseProcessor as any).destroy?.();
    noiseProcessor = null;
    activeNoiseModel = "off";
  }
}

// ── Bitrate Constants ──

const DEFAULT_BITRATE = 256_000;

// ── Adaptive Bitrate ──

let adaptiveTargetBitrate = DEFAULT_BITRATE;
let adaptiveCurrentBitrate = DEFAULT_BITRATE;
let highLossCount = 0;
let lowLossCount = 0;

function resetAdaptiveBitrate() {
  adaptiveTargetBitrate = DEFAULT_BITRATE;
  adaptiveCurrentBitrate = DEFAULT_BITRATE;
  highLossCount = 0;
  lowLossCount = 0;
}

// ── WebRTC Stats Polling ──

let statsInterval: ReturnType<typeof setInterval> | null = null;

function startStatsPolling() {
  stopStatsPolling();
  resetStatsDelta();
  statsInterval = setInterval(async () => {
    const { room } = useVoiceStore.getState();
    if (!room) return;
    try {
      const stats = await collectWebRTCStats(room);

      // Adaptive bitrate based on packet loss
      if (stats.audioPacketLoss > 5) {
        highLossCount++;
        lowLossCount = 0;
        if (highLossCount >= 2) {
          const reduced = Math.round(adaptiveCurrentBitrate * 0.75);
          adaptiveCurrentBitrate = Math.max(32_000, reduced);
          useVoiceStore.getState().applyBitrate(adaptiveCurrentBitrate);
        }
      } else if (stats.audioPacketLoss < 1) {
        lowLossCount++;
        highLossCount = 0;
        if (lowLossCount >= 5) {
          const increased = Math.round(adaptiveCurrentBitrate * 1.1);
          const newBitrate = Math.min(adaptiveTargetBitrate, increased);
          if (newBitrate !== adaptiveCurrentBitrate) {
            adaptiveCurrentBitrate = newBitrate;
            useVoiceStore.getState().applyBitrate(adaptiveCurrentBitrate);
          }
        }
      } else {
        highLossCount = 0;
        lowLossCount = 0;
      }

      // Only update store stats if overlay is visible
      if (useVoiceStore.getState().showStatsOverlay) {
        useVoiceStore.setState({ webrtcStats: stats });
      }
    } catch (e) {
      dbg("voice", "stats polling error", e);
    }
  }, 2000);
}

function stopStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  resetStatsDelta();
  resetAdaptiveBitrate();
}

// ── Lobby Music (Easter Egg) ──

let lobbyMusicTimer: ReturnType<typeof setTimeout> | null = null;
let lobbyMusicAudio: HTMLAudioElement | null = null;
let lobbyMusicGain: GainNode | null = null;
let lobbyMusicCtx: AudioContext | null = null;

function checkLobbyMusic() {
  if (localStorage.getItem("flux-lobby-music-enabled") === "false") return;

  const { room } = useVoiceStore.getState();
  if (!room) return;

  const isAlone = room.remoteParticipants.size === 0;

  if (isAlone) {
    if (!lobbyMusicTimer && !lobbyMusicAudio) {
      lobbyMusicTimer = setTimeout(() => {
        lobbyMusicTimer = null;
        startLobbyMusic();
      }, 30_000);
    }
  } else {
    if (lobbyMusicTimer) {
      clearTimeout(lobbyMusicTimer);
      lobbyMusicTimer = null;
    }
    if (lobbyMusicAudio) {
      fadeOutLobbyMusic();
    }
  }
}

function startLobbyMusic() {
  if (lobbyMusicAudio) return;

  const vol = useVoiceStore.getState().lobbyMusicVolume;
  const audio = new Audio("/lobby-music.mp3");
  audio.loop = true;

  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 3);

  source.connect(gain);
  gain.connect(ctx.destination);

  audio.play().catch(() => {
    ctx.close().catch(() => {});
    useVoiceStore.setState({ lobbyMusicPlaying: false });
  });

  lobbyMusicAudio = audio;
  lobbyMusicGain = gain;
  lobbyMusicCtx = ctx;
  useVoiceStore.setState({ lobbyMusicPlaying: true });
}

function fadeOutLobbyMusic() {
  if (!lobbyMusicGain || !lobbyMusicCtx || !lobbyMusicAudio) return;

  const gain = lobbyMusicGain;
  const ctx = lobbyMusicCtx;
  const audio = lobbyMusicAudio;

  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);

  setTimeout(() => {
    audio.pause();
    audio.src = "";
    ctx.close().catch(() => {});
  }, 2200);

  lobbyMusicAudio = null;
  lobbyMusicGain = null;
  lobbyMusicCtx = null;
  useVoiceStore.setState({ lobbyMusicPlaying: false });
}

function stopLobbyMusic() {
  if (lobbyMusicTimer) {
    clearTimeout(lobbyMusicTimer);
    lobbyMusicTimer = null;
  }
  if (lobbyMusicAudio) {
    lobbyMusicAudio.pause();
    lobbyMusicAudio.src = "";
  }
  if (lobbyMusicCtx) {
    lobbyMusicCtx.close().catch(() => {});
  }
  lobbyMusicAudio = null;
  lobbyMusicGain = null;
  lobbyMusicCtx = null;
  useVoiceStore.setState({ lobbyMusicPlaying: false });
}

// Clean up lobby music on app close
window.addEventListener("beforeunload", stopLobbyMusic);

function setLobbyMusicGain(volume: number) {
  if (lobbyMusicGain && lobbyMusicCtx) {
    lobbyMusicGain.gain.setValueAtTime(lobbyMusicGain.gain.value, lobbyMusicCtx.currentTime);
    lobbyMusicGain.gain.linearRampToValueAtTime(volume, lobbyMusicCtx.currentTime + 0.1);
  }
}

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
let localAnalyserData: Float32Array | null = null;
// Reference to the LiveKit mic MediaStreamTrack for noise gate control.
// We gate by setting track.enabled = false (sends silence) instead of
// setMicrophoneEnabled() which changes the publication state visible to others.
let localMicTrack: MediaStreamTrack | null = null;
let localAnalyserClone: MediaStreamTrack | null = null;

function setupLocalAnalyser(room: any) {
  teardownLocalAnalyser();
  try {
    let mediaStreamTrack: MediaStreamTrack | undefined;
    for (const pub of room.localParticipant.audioTrackPublications.values()) {
      console.log("[analyser] found audio pub:", pub.source, "has track:", !!pub.track);
      if (pub.source === Track.Source.Microphone && pub.track) {
        mediaStreamTrack = pub.track.mediaStreamTrack;
        console.log("[analyser] mic mediaStreamTrack:", mediaStreamTrack?.kind, "readyState:", mediaStreamTrack?.readyState);
        break;
      }
    }
    if (!mediaStreamTrack) {
      console.warn("[analyser] no mic track found, pubs count:", room.localParticipant.audioTrackPublications.size);
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
    console.log("[analyser] setup complete, ctx state:", localAnalyserCtx.state);
  } catch (e) {
    console.error("[analyser] Failed to setup:", e);
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
  let sum = 0;
  for (let i = 0; i < localAnalyserData.length; i++) {
    sum += localAnalyserData[i] * localAnalyserData[i];
  }
  return Math.sqrt(sum / localAnalyserData.length); // RMS level (0-1)
}

// Convert sensitivity (0-100) to an audio level threshold (0.0-1.0)
// Uses a quadratic curve so low values are fine-grained (speech range)
// and high values gate more aggressively. RMS of normal speech ≈ 0.01-0.05.
function sensitivityToThreshold(sensitivity: number): number {
  const t = sensitivity / 100;
  return t * t * 0.1; // 10% → 0.001, 50% → 0.025, 100% → 0.1
}

function startAudioLevelPolling() {
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
  }, 50); // 20fps for smooth visuals
}

function stopAudioLevelPolling() {
  if (audioLevelInterval) {
    clearInterval(audioLevelInterval);
    audioLevelInterval = null;
  }
  teardownLocalAnalyser();
  isGated = false;
  gatedSilentSince = null;
  userLastSpokeMap.clear();
}

// ── Types ──

interface VoiceUser {
  userId: string;
  username: string;
  speaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
}

interface AudioSettings {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  dtx: boolean;
  highPassFrequency: number;
  lowPassFrequency: number;
  inputSensitivity: number; // 0-100, where 0 = always transmit, 100 = most aggressive gate
  inputSensitivityEnabled: boolean; // false = always transmit (no gate)
  noiseSuppressionModel: NoiseSuppressionModel; // AI noise suppression model
  suppressionStrength: number; // 0-100, dry/wet mix for AI noise suppression
  vadThreshold: number; // 0-100, voice activity detection threshold (RNNoise only)
  micInputGain: number; // 0-200, mic pre-gain percentage
  noiseGateHoldTime: number; // 50-1000ms, hold time before gate closes
  compressorEnabled: boolean;
  compressorThreshold: number; // -50 to 0 dB
  compressorRatio: number; // 1-20
  compressorAttack: number; // seconds
  compressorRelease: number; // seconds
  deEsserEnabled: boolean;
  deEsserStrength: number; // 0-100
}

interface ScreenShareInfo {
  participantId: string;
  username: string;
}

export type ScreenShareQuality = "1080p60" | "1080p30" | "720p60" | "720p30" | "480p30" | "Lossless";

interface ScreenSharePreset {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  codec: "h264" | "vp9";
  scalabilityMode: string;
  degradationPreference: "balanced" | "maintain-resolution" | "maintain-framerate";
  contentHint: "detail" | "motion" | "text";
}

const SCREEN_SHARE_PRESETS: Record<ScreenShareQuality, ScreenSharePreset> = {
  // Discord-like defaults: H.264 (hardware-accelerated), balanced degradation
  // H.264 uses L1T1 (no SVC layering) — browsers don't support H.264 temporal layers well
  "1080p60": { width: 1920, height: 1080, frameRate: 60, maxBitrate: 6_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "motion" },
  "1080p30": { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  "720p60":  { width: 1280, height: 720,  frameRate: 60, maxBitrate: 4_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "motion" },
  "720p30":  { width: 1280, height: 720,  frameRate: 30, maxBitrate: 2_500_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  "480p30":  { width: 854,  height: 480,  frameRate: 30, maxBitrate: 1_500_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  // Lossless: VP9 + maintain-resolution for maximum quality (CPU-heavy)
  "Lossless":{ width: 1920, height: 1080, frameRate: 60, maxBitrate: 20_000_000, codec: "vp9",  scalabilityMode: "L1T3", degradationPreference: "maintain-resolution", contentHint: "detail" },
};

interface VoiceState {
  // Connection state
  room: Room | null;
  connectedChannelId: string | null;
  connecting: boolean;
  connectionError: string | null;

  // Local user controls
  isMuted: boolean;
  isDeafened: boolean;

  // Audio settings
  audioSettings: AudioSettings;

  // Per-user volume
  participantVolumes: Record<string, number>;
  participantTrackMap: Record<string, string>;

  // Audio levels (0-1 per participant, updated at 20fps)
  audioLevels: Record<string, number>;
  // Debounced speaking state — instant on, 200ms hold off (no flicker)
  speakingUserIds: Set<string>;

  // Screen share
  isScreenSharing: boolean;
  screenSharers: ScreenShareInfo[];
  pinnedScreenShare: string | null;
  theatreMode: boolean;
  screenShareQuality: ScreenShareQuality;

  // Participants in the current room (from LiveKit)
  participants: VoiceUser[];

  // Voice channel occupancy (from WebSocket, for sidebar)
  channelParticipants: Record<string, VoiceParticipant[]>;

  // Timestamp of last non-silence mic transmission (ms, 0 if never) — used by idle detection
  lastSpokeAt: number;

  // WebRTC stats overlay
  webrtcStats: WebRTCQualityStats | null;
  showStatsOverlay: boolean;

  // Lobby music (easter egg)
  lobbyMusicPlaying: boolean;
  lobbyMusicVolume: number;

  // Actions
  joinVoiceChannel: (channelId: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setMuted: (muted: boolean) => void;
  updateAudioSetting: (key: keyof AudioSettings, value: boolean | number | string) => void;
  applyBitrate: (bitrate: number) => void;
  toggleScreenShare: (displaySurface?: "monitor" | "window") => Promise<void>;
  setParticipantVolume: (participantId: string, volume: number) => void;
  pinScreenShare: (participantId: string) => void;
  unpinScreenShare: () => void;
  toggleTheatreMode: () => void;
  setScreenShareQuality: (quality: ScreenShareQuality) => void;
  incrementDrinkCount: () => void;
  setLobbyMusicVolume: (volume: number) => void;
  stopLobbyMusicAction: () => void;
  toggleStatsOverlay: () => void;

  // Internal
  _updateParticipants: () => void;
  _updateScreenSharers: () => void;
  _setChannelParticipants: (channelId: string, participants: VoiceParticipant[]) => void;
}

const DEFAULT_SETTINGS: AudioSettings = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  dtx: false,
  highPassFrequency: 0,
  lowPassFrequency: 0,
  inputSensitivity: 40,
  inputSensitivityEnabled: true,
  noiseSuppressionModel: "dtln",
  suppressionStrength: 100,
  vadThreshold: 85,
  micInputGain: 100,
  noiseGateHoldTime: 200,
  compressorEnabled: false,
  compressorThreshold: -24,
  compressorRatio: 12,
  compressorAttack: 0.003,
  compressorRelease: 0.25,
  deEsserEnabled: false,
  deEsserStrength: 50,
};

// ── Audio Settings Persistence ──
const SETTINGS_STORAGE_KEY = "flux-audio-settings";

function loadAudioSettings(): AudioSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveAudioSettings(settings: AudioSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  room: null,
  connectedChannelId: null,
  connecting: false,
  connectionError: null,
  isMuted: false,
  isDeafened: false,
  audioSettings: loadAudioSettings(),
  participantVolumes: {},
  participantTrackMap: {},
  audioLevels: {},
  speakingUserIds: new Set<string>(),
  isScreenSharing: false,
  screenSharers: [],
  pinnedScreenShare: null,
  theatreMode: false,
  screenShareQuality: "720p30",
  participants: [],
  channelParticipants: {},
  lastSpokeAt: 0,
  lobbyMusicPlaying: false,
  webrtcStats: null,
  showStatsOverlay: false,
  lobbyMusicVolume: parseFloat(localStorage.getItem("flux-lobby-music-volume") ?? "0.15"),

  joinVoiceChannel: async (channelId: string) => {
    const { room: existingRoom, connectedChannelId, audioSettings } = get();

    dbg("voice", `joinVoiceChannel requested channel=${channelId}`, {
      currentChannel: connectedChannelId,
      hasExistingRoom: !!existingRoom,
    });

    if (connectedChannelId === channelId) {
      dbg("voice", "joinVoiceChannel skipped — already connected");
      return;
    }

    // Room switch: silently disconnect without sounds or full state reset
    const isSwitching = !!existingRoom && !!connectedChannelId;
    if (existingRoom) {
      dbg("voice", `joinVoiceChannel ${isSwitching ? "switching" : "disconnecting"} from previous room`);

      // Remove all event listeners FIRST so the Disconnected handler
      // doesn't fire and interfere with the new room setup
      existingRoom.removeAllListeners();

      // Stop local mic track completely (not just mute — fully stop to prevent static)
      try {
        for (const pub of existingRoom.localParticipant.audioTrackPublications.values()) {
          if (pub.track) {
            pub.track.stop();
          }
        }
      } catch {}

      stopAudioLevelPolling();
      stopLobbyMusic();
      await destroyNoiseProcessor();
      dryWetProcessor = null;
      gainTrackProcessor = null;
      destroyAllPipelines();

      // Detach all remote tracks
      for (const participant of existingRoom.remoteParticipants.values()) {
        for (const pub of participant.audioTrackPublications.values()) {
          if (pub.track) pub.track.detach().forEach((el) => el.remove());
        }
        for (const pub of participant.videoTrackPublications.values()) {
          if (pub.track) pub.track.detach().forEach((el) => el.remove());
        }
      }

      // Await disconnect so old room is fully torn down before new one starts
      await existingRoom.disconnect();
      // Defer the leave message — send it right before joining the new room
      // so the user stays in the old room's participant list until they appear in the new one
      // (prevents the old room from flashing away in the sidebar)
      // Set connecting: true in the same update to avoid a flash where both
      // connectedChannelId and connecting are falsy
      set({ room: null, connectedChannelId: null, connecting: true, connectionError: null });
    }

    // Store the previous channel ID so we can send the deferred leave later
    const previousChannelId = isSwitching ? connectedChannelId : null;

    // Bump nonce so any previous in-flight join becomes stale
    const myNonce = ++joinNonce;
    const isStale = () => myNonce !== joinNonce;

    if (!isSwitching) set({ connecting: true, connectionError: null });

    try {
      dbg("voice", "joinVoiceChannel fetching voice token...");
      const { token, url } = await api.getVoiceToken(channelId);

      if (isStale()) {
        dbg("voice", "joinVoiceChannel aborted after token fetch — newer join in progress");
        set({ connecting: false });
        return;
      }

      dbg("voice", `joinVoiceChannel got token, url=${url}`);

      // Get channel bitrate from chat store
      const { useChatStore } = await import("./chat.js");
      const chatState = useChatStore.getState();
      const channel = chatState.channels.find((c) => c.id === channelId);
      const channelBitrate = channel?.bitrate ?? DEFAULT_BITRATE;

      // Initialize adaptive bitrate ceiling to channel bitrate
      adaptiveTargetBitrate = channelBitrate;
      adaptiveCurrentBitrate = channelBitrate;

      // E2EE: get server encryption key for voice
      const cryptoState = useCryptoStore.getState();
      const serverId = chatState.activeServerId;
      const serverKey = serverId ? cryptoState.getServerKey(serverId) : null;

      let e2eeOptions: { keyProvider: ExternalE2EEKeyProvider; worker: Worker } | undefined;
      dbg("voice", "joinVoiceChannel E2EE check", { hasServerKey: !!serverKey, serverId });
      if (serverKey) {
        try {
          const keyProvider = new ExternalE2EEKeyProvider();
          const keyBase64 = await exportKeyAsBase64(serverKey);
          await keyProvider.setKey(keyBase64);
          e2eeOptions = {
            keyProvider,
            worker: new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" }),
          };
          dbg("voice", "joinVoiceChannel E2EE initialized");
        } catch (e) {
          dbg("voice", "joinVoiceChannel E2EE setup failed", e);
          console.warn("Voice E2EE setup failed, continuing without:", e);
        }
      }

      dbg("voice", "joinVoiceChannel creating Room", {
        channelBitrate,
        e2ee: !!e2eeOptions,
        audioSettings: {
          echoCancellation: audioSettings.echoCancellation,
          noiseSuppression: audioSettings.noiseSuppression,
          autoGainControl: audioSettings.autoGainControl,
          dtx: audioSettings.dtx,
          noiseSuppressionModel: audioSettings.noiseSuppressionModel,
        },
      });

      const room = new Room({
        // Disable adaptive stream so subscribers always receive max quality
        // (otherwise LiveKit auto-downgrades based on video element size)
        adaptiveStream: false,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: audioSettings.echoCancellation,
          noiseSuppression: audioSettings.noiseSuppression,
          autoGainControl: audioSettings.autoGainControl,
          sampleRate: 48000,
          channelCount: 2,
        },
        publishDefaults: {
          audioPreset: {
            maxBitrate: channelBitrate,
          },
          dtx: audioSettings.dtx,
          red: true,
          forceStereo: true,
          stopMicTrackOnMute: false,
          // H.264 by default — hardware-accelerated on most GPUs, much lower CPU than VP9
          videoCodec: "h264",
          screenShareEncoding: {
            maxBitrate: 6_000_000,
            maxFramerate: 60,
            priority: "high",
          },
          screenShareSimulcastLayers: [],
          scalabilityMode: "L1T1",
          degradationPreference: "balanced",
          backupCodec: { codec: "vp8" },
        },
        ...(e2eeOptions ? { e2ee: e2eeOptions } : {}),
      });

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
          // attach() creates an auto-playing <audio> element that activates the WebRTC track.
          // We pass it to createAudioPipeline which uses createMediaElementSource to capture
          // the element's output into our Web Audio graph — the element no longer plays directly,
          // preventing double audio while keeping the track active.
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
          // Request max quality immediately to speed up stream loading
          // (don't wait for component mount + requestAnimationFrame)
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
        // Detach any HTML elements (audio + video tracks)
        const detached = track.detach();
        dbg("voice", `TrackUnsubscribed detached ${detached.length} HTML element(s)`);
        detached.forEach((el) => el.remove());
        if (track.kind === Track.Kind.Video) {
          get()._updateScreenSharers();
        }
      });

      room.on(RoomEvent.LocalTrackPublished, (pub) => {
        dbg("voice", `LocalTrackPublished source=${pub.source} sid=${pub.trackSid}`);
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

      dbg("voice", "joinVoiceChannel connecting to LiveKit...");
      await room.connect(url, token);

      if (isStale()) {
        dbg("voice", "joinVoiceChannel aborted after room.connect — newer join in progress");
        room.disconnect();
        set({ connecting: false });
        return;
      }

      dbg("voice", "joinVoiceChannel connected!", {
        localIdentity: room.localParticipant.identity,
        localName: room.localParticipant.name,
        remoteParticipants: room.remoteParticipants.size,
        roomName: room.name,
        roomSid: room.sid,
      });

      await room.localParticipant.setMicrophoneEnabled(true);
      dbg("voice", "joinVoiceChannel microphone enabled");

      // Set up AI noise suppression on the microphone track
      if (audioSettings.noiseSuppressionModel !== "off") {
        try {
          dbg("voice", `joinVoiceChannel setting up ${audioSettings.noiseSuppressionModel} noise filter`);
          const processor = await getOrCreateNoiseProcessor(audioSettings.noiseSuppressionModel);
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track && processor) {
            // Apply VAD threshold if using RNNoise
            if (audioSettings.noiseSuppressionModel === "rnnoise" && "setVadThreshold" in processor) {
              (processor as any).setVadThreshold(audioSettings.vadThreshold / 100);
            }

            // Always wrap with DryWetTrackProcessor so micInputGain works at any suppression strength
            const strength = audioSettings.suppressionStrength / 100;
            const { DryWetTrackProcessor } = await import("../lib/DryWetTrackProcessor.js");
            dryWetProcessor = new DryWetTrackProcessor(processor, strength);
            dryWetProcessor.setPreGain(audioSettings.micInputGain / 100);
            await micPub.track.setProcessor(dryWetProcessor as any);
            dbg("voice", `joinVoiceChannel ${audioSettings.noiseSuppressionModel} noise filter active`);
          } else {
            dbg("voice", "joinVoiceChannel noise filter skipped — no mic track publication");
          }
        } catch (e) {
          dbg("voice", "joinVoiceChannel noise filter setup failed", e);
          console.error(`Failed to enable ${audioSettings.noiseSuppressionModel} noise filter:`, e);
          await destroyNoiseProcessor();
          dryWetProcessor = null;
          set({ audioSettings: { ...get().audioSettings, noiseSuppressionModel: "off" } });
        }
      } else if (audioSettings.micInputGain !== 100) {
        // No noise suppression but mic gain is non-unity — use GainTrackProcessor
        try {
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track) {
            const { GainTrackProcessor } = await import("../lib/GainTrackProcessor.js");
            gainTrackProcessor = new GainTrackProcessor(audioSettings.micInputGain / 100);
            await micPub.track.setProcessor(gainTrackProcessor as any);
            dbg("voice", "joinVoiceChannel GainTrackProcessor active (no noise model)");
          }
        } catch (e) {
          dbg("voice", "joinVoiceChannel GainTrackProcessor setup failed", e);
          gainTrackProcessor = null;
        }
      }

      // Optimistically add self to channelParticipants so the avatar shows immediately
      // (the backend voice_state broadcast will replace this with authoritative data)
      const localIdentity = room.localParticipant.identity;
      const localName = room.localParticipant.name ?? localIdentity.slice(0, 8);
      const optimisticParticipants = { ...get().channelParticipants };
      // Remove self from previous channel if switching
      if (previousChannelId && optimisticParticipants[previousChannelId]) {
        optimisticParticipants[previousChannelId] = optimisticParticipants[previousChannelId].filter(
          (p) => p.userId !== localIdentity,
        );
      }
      optimisticParticipants[channelId] = [
        ...(optimisticParticipants[channelId] || []).filter((p) => p.userId !== localIdentity),
        { userId: localIdentity, username: localName, drinkCount: 0 },
      ];
      dbg("voice", `optimistic update: ch=${channelId} participants=${optimisticParticipants[channelId].length}`, optimisticParticipants[channelId]);

      set({
        room,
        connectedChannelId: channelId,
        connecting: false,
        isMuted: false,
        isDeafened: false,
        isScreenSharing: false,
        screenSharers: [],
        participantTrackMap: {},
        pinnedScreenShare: null,
        channelParticipants: optimisticParticipants,
      });

      get()._updateParticipants();
      get()._updateScreenSharers();
      startAudioLevelPolling();
      startStatsPolling(); // Always run stats for adaptive bitrate
      checkLobbyMusic();

      // If push-to-talk is configured, start muted
      const { keybinds } = useKeybindsStore.getState();
      const hasPTT = keybinds.some((kb) => kb.action === "push-to-talk" && kb.key !== null);
      if (hasPTT) {
        dbg("voice", "joinVoiceChannel PTT detected, starting muted");
        room.localParticipant.setMicrophoneEnabled(false);
        set({ isMuted: true });
      }

      playJoinSound();
      // Send deferred leave for the old room right before announcing the new join,
      // so the sidebar transitions atomically (old room loses user, new room gains user)
      if (previousChannelId) {
        gateway.send({ type: "voice_state_update", channelId: previousChannelId, action: "leave" });
      }
      gateway.send({ type: "voice_state_update", channelId, action: "join" });
      dbg("voice", `joinVoiceChannel COMPLETE channel=${channelId}`);
    } catch (err) {
      // If a newer join/leave invalidated this attempt, don't show an error
      if (isStale()) {
        dbg("voice", "joinVoiceChannel error ignored — stale attempt", err instanceof Error ? err.message : err);
        return;
      }
      dbg("voice", "joinVoiceChannel FAILED", err instanceof Error ? err.message : err);
      set({
        connecting: false,
        connectionError: err instanceof Error ? err.message : "Failed to connect to voice",
      });
    }
  },

  leaveVoiceChannel: () => {
    // Cancel any in-flight joinVoiceChannel
    ++joinNonce;

    const { room, connectedChannelId, channelParticipants } = get();
    const localId = room?.localParticipant?.identity;

    dbg("voice", `leaveVoiceChannel channel=${connectedChannelId}`, {
      hasRoom: !!room,
      localId,
      pipelinesActive: audioPipelines.size,
    });

    playLeaveSound();
    stopAudioLevelPolling();
    stopStatsPolling();
    stopLobbyMusic();

    // Stop Spotify playback when leaving voice
    try {
      import("./spotify.js").then(({ useSpotifyStore }) => {
        useSpotifyStore.getState().leaveSession();
      });
    } catch {}

    // Clean up noise suppression processor
    destroyNoiseProcessor();
    dryWetProcessor = null;
    gainTrackProcessor = null;

    // Destroy all audio pipelines
    destroyAllPipelines();

    if (room) {
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          if (publication.track) {
            publication.track.detach().forEach((el) => el.remove());
          }
        }
        for (const publication of participant.videoTrackPublications.values()) {
          if (publication.track) {
            publication.track.detach().forEach((el) => el.remove());
          }
        }
      }
      room.disconnect();
    }
    if (connectedChannelId) {
      gateway.send({ type: "voice_state_update", channelId: connectedChannelId, action: "leave" });
    }

    const updatedParticipants = { ...channelParticipants };
    if (connectedChannelId && updatedParticipants[connectedChannelId] && localId) {
      updatedParticipants[connectedChannelId] = updatedParticipants[connectedChannelId].filter(
        (p) => p.userId !== localId,
      );
    }

    set({
      room: null,
      connectedChannelId: null,
      participants: [],
      channelParticipants: updatedParticipants,
      isMuted: false,
      isDeafened: false,
      connecting: false,
      isScreenSharing: false,
      screenSharers: [],
      participantTrackMap: {},
      audioLevels: {},
      speakingUserIds: new Set<string>(),
      pinnedScreenShare: null,
      webrtcStats: null,
    });
  },

  toggleMute: () => {
    const { room, isMuted } = get();
    if (!room) return;
    const newMuted = !isMuted;
    dbg("voice", `toggleMute ${newMuted ? "muting" : "unmuting"}`);
    // Ensure noise gate track state is in sync when unmuting
    if (!newMuted && localMicTrack) localMicTrack.enabled = true;
    room.localParticipant.setMicrophoneEnabled(!newMuted);
    if (newMuted) playMuteSound(); else playUnmuteSound();
    set({ isMuted: newMuted });
    get()._updateParticipants();
  },

  setMuted: (muted: boolean) => {
    const { room, isMuted } = get();
    if (!room || isMuted === muted) return;
    // Ensure noise gate track state is in sync when unmuting
    if (!muted && localMicTrack) localMicTrack.enabled = true;
    room.localParticipant.setMicrophoneEnabled(!muted);
    set({ isMuted: muted });
    get()._updateParticipants();
  },

  toggleDeafen: () => {
    const { room, isDeafened, isMuted, participantVolumes, participantTrackMap } = get();
    if (!room) return;

    const newDeafened = !isDeafened;
    dbg("voice", `toggleDeafen ${newDeafened ? "deafening" : "undeafening"}`, { wasMuted: isMuted });

    if (newDeafened) {
      playDeafenSound();
      // Mute all audio via gain nodes
      for (const pipeline of audioPipelines.values()) {
        pipeline.gain.gain.setValueAtTime(0, pipeline.context.currentTime);
      }
    } else {
      playUndeafenSound();
      // Restore per-user volumes
      for (const [identity, trackSid] of Object.entries(participantTrackMap)) {
        const pipeline = audioPipelines.get(trackSid);
        if (pipeline) {
          pipeline.gain.gain.setValueAtTime(participantVolumes[identity] ?? 1.0, pipeline.context.currentTime);
        }
      }
    }

    if (newDeafened && !isMuted) {
      room.localParticipant.setMicrophoneEnabled(false);
      set({ isDeafened: newDeafened, isMuted: true });
    } else if (!newDeafened) {
      // Undeafening also unmutes the mic — ensure gate track state is in sync
      if (localMicTrack) localMicTrack.enabled = true;
      room.localParticipant.setMicrophoneEnabled(true);
      set({ isDeafened: false, isMuted: false });
    } else {
      set({ isDeafened: newDeafened });
    }
    get()._updateParticipants();
  },

  setParticipantVolume: (participantId: string, volume: number) => {
    dbg("voice", `setParticipantVolume participant=${participantId} volume=${volume}`);
    const { participantTrackMap, isDeafened } = get();

    set((state) => ({
      participantVolumes: {
        ...state.participantVolumes,
        [participantId]: volume,
      },
    }));

    if (isDeafened) return;

    const trackSid = participantTrackMap[participantId];
    if (trackSid) {
      const pipeline = audioPipelines.get(trackSid);
      if (pipeline) {
        if (pipeline.context.state === "suspended") pipeline.context.resume();
        pipeline.gain.gain.value = volume;
      }
    }
  },

  updateAudioSetting: (key: keyof AudioSettings, value: boolean | number | string) => {
    dbg("voice", `updateAudioSetting ${key}=${value}`);
    const { room, audioSettings } = get();
    const newSettings = { ...audioSettings, [key]: value } as AudioSettings;
    set({ audioSettings: newSettings });
    saveAudioSettings(newSettings);

    // Input sensitivity settings are handled by the polling loop, no action needed
    if (key === "inputSensitivity" || key === "inputSensitivityEnabled") {
      // If disabling the gate, release it immediately
      if (key === "inputSensitivityEnabled" && !value && isGated && room) {
        isGated = false;
        gatedSilentSince = null;
        room.localParticipant.setMicrophoneEnabled(true);
      }
      return;
    }

    // Noise gate hold time is used by the polling loop directly
    if (key === "noiseGateHoldTime") return;

    // Suppression strength — update DryWetTrackProcessor live
    if (key === "suppressionStrength") {
      if (dryWetProcessor) {
        dryWetProcessor.strength = (value as number) / 100;
      }
      return;
    }

    // VAD threshold — post message to RNNoise worklet
    if (key === "vadThreshold") {
      if (activeNoiseModel === "rnnoise" && noiseProcessor) {
        const innerProc = dryWetProcessor
          ? dryWetProcessor.getInnerProcessor()
          : noiseProcessor;
        if (innerProc && "setVadThreshold" in innerProc) {
          (innerProc as any).setVadThreshold((value as number) / 100);
        }
      }
      return;
    }

    // Mic input gain — update DryWetTrackProcessor pre-gain or GainTrackProcessor
    if (key === "micInputGain") {
      if (dryWetProcessor) {
        dryWetProcessor.setPreGain((value as number) / 100);
      } else if (newSettings.noiseSuppressionModel === "off" && room) {
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.track) {
          if ((value as number) !== 100) {
            // Need gain processing — create or update GainTrackProcessor
            if (gainTrackProcessor) {
              gainTrackProcessor.setGain((value as number) / 100);
            } else {
              const setupGain = async () => {
                try {
                  const { GainTrackProcessor } = await import("../lib/GainTrackProcessor.js");
                  gainTrackProcessor = new GainTrackProcessor((value as number) / 100);
                  await micPub.track!.setProcessor(gainTrackProcessor as any);
                } catch (e) {
                  console.warn("Failed to setup GainTrackProcessor:", e);
                  gainTrackProcessor = null;
                }
              };
              setupGain();
            }
          } else if (gainTrackProcessor) {
            // Gain is 100% (unity) — remove processor
            micPub.track.stopProcessor().then(() => {
              gainTrackProcessor = null;
            }).catch(() => {
              gainTrackProcessor = null;
            });
          }
        }
      }
      return;
    }

    // Compressor settings — update DynamicsCompressorNode params on all active pipelines
    if (key === "compressorThreshold" || key === "compressorRatio" || key === "compressorAttack" || key === "compressorRelease") {
      for (const pipeline of audioPipelines.values()) {
        if (pipeline.compressor) {
          if (key === "compressorThreshold") pipeline.compressor.threshold.value = value as number;
          if (key === "compressorRatio") pipeline.compressor.ratio.value = value as number;
          if (key === "compressorAttack") pipeline.compressor.attack.value = value as number;
          if (key === "compressorRelease") pipeline.compressor.release.value = value as number;
        }
      }
      return;
    }

    // Compressor toggle — rebuild pipelines
    if (key === "compressorEnabled") {
      rebuildAllPipelines(newSettings, get);
      return;
    }

    // De-esser strength — update BiquadFilterNode gain on all active pipelines
    if (key === "deEsserStrength") {
      for (const pipeline of audioPipelines.values()) {
        if (pipeline.deEsser) {
          pipeline.deEsser.gain.value = -((value as number) / 100) * 12;
        }
      }
      return;
    }

    // De-esser toggle — rebuild pipelines
    if (key === "deEsserEnabled") {
      rebuildAllPipelines(newSettings, get);
      return;
    }

    // AI noise suppression model switch
    if (key === "noiseSuppressionModel") {
      if (!room) {
        dbg("voice", "noiseSuppressionModel: no room, skipping");
        return;
      }
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (!micPub?.track) {
        dbg("voice", "noiseSuppressionModel: no mic track published, skipping");
        return;
      }
      const model = value as NoiseSuppressionModel;

      if (model === "off") {
        const currentGain = get().audioSettings.micInputGain;
        micPub.track.stopProcessor()
          .then(async () => {
            destroyNoiseProcessor();
            dryWetProcessor = null;
            // If mic gain is non-unity, set up GainTrackProcessor
            if (currentGain !== 100 && micPub.track) {
              try {
                const { GainTrackProcessor } = await import("../lib/GainTrackProcessor.js");
                gainTrackProcessor = new GainTrackProcessor(currentGain / 100);
                await micPub.track.setProcessor(gainTrackProcessor as any);
              } catch (e2) {
                console.warn("Failed to setup GainTrackProcessor:", e2);
                gainTrackProcessor = null;
              }
            }
          })
          .catch((e) => {
            console.warn("Failed to disable noise filter:", e);
            destroyNoiseProcessor();
            dryWetProcessor = null;
          });
      } else {
        // Stop existing processor first, then attach new one
        const myNonce = ++noiseSwitchNonce;
        const switchModel = async () => {
          try {
            if (noiseProcessor || dryWetProcessor || gainTrackProcessor) {
              await micPub.track!.stopProcessor();
              await destroyNoiseProcessor();
              dryWetProcessor = null;
              gainTrackProcessor = null;
            }
            if (myNonce !== noiseSwitchNonce) return;
            const processor = await getOrCreateNoiseProcessor(model);
            if (myNonce !== noiseSwitchNonce) return;
            if (processor) {
              const currentSettings = get().audioSettings;
              const strength = currentSettings.suppressionStrength / 100;

              // Apply VAD threshold if switching to RNNoise
              if (model === "rnnoise" && "setVadThreshold" in processor) {
                (processor as any).setVadThreshold(currentSettings.vadThreshold / 100);
              }

              // Always wrap with DryWetTrackProcessor so micInputGain works at any suppression strength
              const { DryWetTrackProcessor } = await import("../lib/DryWetTrackProcessor.js");
              dryWetProcessor = new DryWetTrackProcessor(processor, strength);
              dryWetProcessor.setPreGain(currentSettings.micInputGain / 100);
              await micPub.track!.setProcessor(dryWetProcessor as any);
              dbg("voice", `Noise suppression model switched to ${model}`);
            }
          } catch (e) {
            if (myNonce !== noiseSwitchNonce) return;
            console.error(`Failed to switch noise model to ${model}:`, e);
            dbg("voice", `Noise model ${model} failed — reverting to off`, e instanceof Error ? e.message : e);
            await destroyNoiseProcessor();
            dryWetProcessor = null;
            set({ audioSettings: { ...get().audioSettings, noiseSuppressionModel: "off" } });
            saveAudioSettings(get().audioSettings);
          }
        };
        switchModel();
      }
      return;
    }

    // Apply filter changes instantly to all pipelines
    if (key === "highPassFrequency") {
      for (const pipeline of audioPipelines.values()) {
        pipeline.highPass.frequency.value = (value as number) > 0 ? (value as number) : 0;
      }
      return;
    }
    if (key === "lowPassFrequency") {
      for (const pipeline of audioPipelines.values()) {
        pipeline.lowPass.frequency.value = (value as number) > 0 ? (value as number) : 24000;
      }
      return;
    }

    if (!room) return;

    // DTX or audio processing changes require republishing
    if (key === "dtx" || key === "noiseSuppression" || key === "echoCancellation" || key === "autoGainControl") {
      const micEnabled = room.localParticipant.isMicrophoneEnabled;
      if (micEnabled) {
        room.localParticipant.setMicrophoneEnabled(false).then(() => {
          room.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: newSettings.echoCancellation,
            noiseSuppression: newSettings.noiseSuppression,
            autoGainControl: newSettings.autoGainControl,
          });
        });
      }
    }
  },

  applyBitrate: (bitrate: number) => {
    const { room } = get();
    if (!room) return;

    // Reset adaptive state when bitrate is manually set (e.g. channel bitrate change)
    adaptiveTargetBitrate = bitrate;
    adaptiveCurrentBitrate = bitrate;
    highLossCount = 0;
    lowLossCount = 0;

    // Apply bitrate directly via RTCRtpSender for live change
    for (const pub of room.localParticipant.audioTrackPublications.values()) {
      const sender = pub.track?.sender;
      if (sender) {
        const params = sender.getParameters();
        if (params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxBitrate = bitrate;
          sender.setParameters(params);
        }
      }
    }
  },

  toggleScreenShare: async (displaySurface?: "monitor" | "window") => {
    const { room, isScreenSharing, screenShareQuality } = get();
    if (!room) return;

    const preset = SCREEN_SHARE_PRESETS[screenShareQuality];

    try {
      if (isScreenSharing) {
        dbg("voice", "toggleScreenShare stopping");
        await room.localParticipant.setScreenShareEnabled(false);
        set({ isScreenSharing: false });
      } else {
        dbg("voice", `toggleScreenShare starting quality=${screenShareQuality}`, {
          ...preset,
          displaySurface,
        });
        await room.localParticipant.setScreenShareEnabled(true,
          // Capture options
          {
            audio: true,
            contentHint: preset.contentHint,
            // Capture at native resolution — quality is controlled via encoder params
            // so quality can be changed live without re-capturing the screen
            resolution: { width: 3840, height: 2160, frameRate: 60 },
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
            surfaceSwitching: "include",
            systemAudio: "include",
            ...(displaySurface ? { displaySurface } : {}),
          },
          // Publish options — codec/scalability/degradation vary per quality preset
          {
            videoCodec: preset.codec,
            screenShareEncoding: {
              maxBitrate: preset.maxBitrate,
              maxFramerate: preset.frameRate,
              priority: "high",
            },
            scalabilityMode: preset.scalabilityMode,
            degradationPreference: preset.degradationPreference,
            backupCodec: { codec: "vp8" },
          },
        );
        set({ isScreenSharing: true });
        dbg("voice", "toggleScreenShare started successfully");
      }
      get()._updateScreenSharers();
    } catch (err) {
      if (err instanceof Error && err.message.includes("Permission denied")) {
        dbg("voice", "toggleScreenShare user cancelled permission dialog");
        return;
      }
      dbg("voice", "toggleScreenShare error", err);
      console.error("Screen share error:", err);
    }
  },

  pinScreenShare: (participantId: string) => {
    set({ pinnedScreenShare: participantId });
  },

  unpinScreenShare: () => {
    set({ pinnedScreenShare: null });
  },

  toggleTheatreMode: () => {
    set((state) => ({ theatreMode: !state.theatreMode }));
  },

  setScreenShareQuality: (quality) => {
    const prevQuality = get().screenShareQuality;
    set({ screenShareQuality: quality });

    const { room, isScreenSharing } = get();
    if (!isScreenSharing || !room) return;

    const preset = SCREEN_SHARE_PRESETS[quality];
    const prevPreset = SCREEN_SHARE_PRESETS[prevQuality];

    // Codec change (h264 ↔ vp9) requires republishing the track
    if (preset.codec !== prevPreset.codec) {
      dbg("voice", `setScreenShareQuality codec change ${prevPreset.codec} → ${preset.codec}, republishing`);
      (async () => {
        try {
          for (const pub of room.localParticipant.videoTrackPublications.values()) {
            if (pub.source === Track.Source.ScreenShare && pub.track) {
              const mediaStreamTrack = pub.track.mediaStreamTrack;
              await room.localParticipant.unpublishTrack(pub.track, false);
              await room.localParticipant.publishTrack(mediaStreamTrack, {
                source: Track.Source.ScreenShare,
                videoCodec: preset.codec,
                screenShareEncoding: {
                  maxBitrate: preset.maxBitrate,
                  maxFramerate: preset.frameRate,
                  priority: "high",
                },
                scalabilityMode: preset.scalabilityMode,
                degradationPreference: preset.degradationPreference,
              });
              get()._updateScreenSharers();
              break;
            }
          }
        } catch (e) {
          console.error("Failed to republish screen share for codec change:", e);
        }
      })();
      return;
    }

    // Same codec — apply encoding params live via RTCRtpSender
    dbg("voice", `setScreenShareQuality live update: ${prevQuality} → ${quality}`, preset);

    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      if (pub.source === Track.Source.ScreenShare && pub.track) {
        const sender = pub.track.sender;
        if (sender) {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = preset.maxBitrate;
            params.encodings[0].maxFramerate = preset.frameRate;
            sender.setParameters(params).catch((e: unknown) =>
              console.warn("Failed to update screen share encoding:", e),
            );
          }
        }
        // Update content hint on the media track
        const mediaTrack = pub.track.mediaStreamTrack;
        if (mediaTrack?.readyState === "live") {
          mediaTrack.contentHint = preset.contentHint;
        }
      }
    }
  },

  incrementDrinkCount: () => {
    const { room, connectedChannelId, channelParticipants } = get();
    if (!room || !connectedChannelId) return;
    const me = room.localParticipant.identity;
    const participants = channelParticipants[connectedChannelId] || [];
    const current = participants.find((p) => p.userId === me)?.drinkCount ?? 0;
    gateway.send({ type: "voice_drink_update", channelId: connectedChannelId, drinkCount: current + 1 });
  },

  setLobbyMusicVolume: (volume: number) => {
    localStorage.setItem("flux-lobby-music-volume", String(volume));
    set({ lobbyMusicVolume: volume });
    setLobbyMusicGain(volume);
  },

  stopLobbyMusicAction: () => {
    stopLobbyMusic();
  },

  toggleStatsOverlay: () => {
    const { showStatsOverlay } = get();
    const newVal = !showStatsOverlay;
    set({ showStatsOverlay: newVal, webrtcStats: newVal ? get().webrtcStats : null });
  },

  _updateParticipants: () => {
    const { room } = get();
    if (!room) return;

    const activeSpeakerIds = new Set(
      room.activeSpeakers.map((s) => s.identity),
    );

    const users: VoiceUser[] = [];

    const local = room.localParticipant;
    const { isMuted: localMuted, isDeafened: localDeafened } = get();
    users.push({
      userId: local.identity,
      username: local.name ?? local.identity.slice(0, 8),
      speaking: activeSpeakerIds.has(local.identity),
      isMuted: localMuted,
      isDeafened: localDeafened,
    });

    for (const participant of room.remoteParticipants.values()) {
      users.push({
        userId: participant.identity,
        username: participant.name ?? participant.identity.slice(0, 8),
        speaking: activeSpeakerIds.has(participant.identity),
        isMuted: !participant.isMicrophoneEnabled,
        isDeafened: false,
      });
    }

    set({ participants: users });
  },

  _updateScreenSharers: () => {
    const { room, screenSharers: previousSharers, pinnedScreenShare } = get();
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

    // Detect new/removed screen sharers for sounds
    const prevIds = new Set(previousSharers.map((s) => s.participantId));
    const newIds = new Set(sharers.map((s) => s.participantId));

    let playedStart = false;
    for (const s of sharers) {
      if (!prevIds.has(s.participantId)) {
        if (!playedStart) {
          playScreenShareStartSound();
          playedStart = true;
        }
      }
    }

    let playedStop = false;
    let clearPin = false;
    for (const s of previousSharers) {
      if (!newIds.has(s.participantId)) {
        if (!playedStop) {
          playScreenShareStopSound();
          playedStop = true;
        }
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

    set({
      screenSharers: sharers,
      pinnedScreenShare: newPin,
      // Exit theatre mode if no more screen shares
      ...(sharers.length === 0 ? { theatreMode: false } : {}),
    });
  },

  _setChannelParticipants: (channelId: string, participants: VoiceParticipant[]) => {
    set((state) => ({
      channelParticipants: {
        ...state.channelParticipants,
        [channelId]: participants,
      },
    }));
  },
}));

// Lazy ref to auth store (avoids circular import)
let _authStore: { getState: () => { user?: { id: string } | null } } | null = null;
import("./auth.js").then((m) => { _authStore = m.useAuthStore; });

// Listen for voice_state events from WebSocket (for sidebar display)
gateway.on((event) => {
  if (event.type === "voice_state") {
    const { connectedChannelId, room } = useVoiceStore.getState();
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
    useVoiceStore.getState()._setChannelParticipants(event.channelId, participants);
  }
});

// Re-announce voice state on WebSocket reconnect (e.g. after server restart)
gateway.onConnect(() => {
  const { connectedChannelId } = useVoiceStore.getState();
  if (connectedChannelId) {
    gateway.send({ type: "voice_state_update", channelId: connectedChannelId, action: "join" });
  }
});

// ── BroadcastChannel: publish voice/screen share state to popout windows ──

function broadcastVoiceState() {
  const state = useVoiceStore.getState();
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
  useVoiceStore.subscribe(() => broadcastVoiceState());

  // Respond to request-state from popout windows
  onCommand((cmd) => {
    if (cmd.type === "request-state") {
      broadcastVoiceState();
    }
  });
}
