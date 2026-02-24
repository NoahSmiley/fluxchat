import { create } from "zustand";
import { Room, RoomEvent, Track, VideoQuality, ExternalE2EEKeyProvider } from "livekit-client";
import type { ScalabilityMode } from "livekit-client";
import type { VoiceParticipant } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../lib/broadcast.js";
import { useKeybindsStore } from "./keybinds.js";
import { useCryptoStore } from "./crypto.js";
import { exportKeyAsBase64 } from "../lib/crypto.js";
import { dbg } from "../lib/debug.js";
import { collectWebRTCStats, resetStatsDelta, type WebRTCQualityStats } from "../lib/webrtcStats.js";

import {
  playJoinSound,
  playLeaveSound,
  playScreenShareStartSound,
  playScreenShareStopSound,
  playMuteSound,
  playUnmuteSound,
  playDeafenSound,
  playUndeafenSound,
} from "../lib/voice-effects.js";

import {
  audioPipelines,
  setGainValue,
  createAudioPipeline,
  getPipelineLevel,
  destroyAudioPipeline,
  rebuildAllPipelines,
  destroyAllPipelines,
} from "../lib/voice-pipeline.js";
import type { AudioSettings } from "../lib/voice-pipeline.js";

import {
  getOrCreateNoiseProcessor,
  destroyNoiseProcessor,
  getNoiseProcessor,
  getActiveNoiseModel,
  getNoiseSwitchNonce,
  incrementNoiseSwitchNonce,
  getDryWetProcessor,
  setDryWetProcessor,
  getGainTrackProcessor,
  setGainTrackProcessor,
} from "../lib/voice-noise.js";

import {
  setupLocalAnalyser,
  teardownLocalAnalyser,
  getLocalMicLevel,
  sensitivityToThreshold,
  startAudioLevelPolling,
  stopAudioLevelPolling,
  getLocalMicTrack,
} from "../lib/voice-analysis.js";

import {
  DEFAULT_BITRATE,
  LOBBY_WAIT_MS,
  LOBBY_FADE_IN_S,
  LOBBY_FADE_OUT_S,
  LOBBY_DEFAULT_GAIN,
} from "../lib/voice-constants.js";

// ═══════════════════════════════════════════════════════════════════
// SECTION: Types & Constants
// ═══════════════════════════════════════════════════════════════════

export type NoiseSuppressionModel = "off" | "speex" | "rnnoise" | "dtln" | "deepfilter" | "nsnet2";

interface VoiceUser {
  userId: string;
  username: string;
  speaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
}

interface ScreenShareInfo {
  participantId: string;
  username: string;
}

type ScreenShareQuality = "1080p60" | "1080p30" | "720p60" | "720p30" | "480p30" | "Lossless";

interface ScreenSharePreset {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  codec: "h264" | "vp9";
  scalabilityMode: ScalabilityMode;
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

interface VoiceState {
  // ── Connection state ──
  room: Room | null;
  connectedChannelId: string | null;
  connecting: boolean;
  connectionError: string | null;

  // ── Local user controls ──
  isMuted: boolean;
  isDeafened: boolean;

  // ── Audio settings ──
  audioSettings: AudioSettings;

  // ── Per-user volume ──
  participantVolumes: Record<string, number>;
  participantTrackMap: Record<string, string>;

  // ── Audio levels (0-1 per participant, updated at 20fps) ──
  audioLevels: Record<string, number>;
  // Debounced speaking state — instant on, 200ms hold off (no flicker)
  speakingUserIds: Set<string>;

  // ── Screen share ──
  isScreenSharing: boolean;
  screenSharers: ScreenShareInfo[];
  pinnedScreenShare: string | null;
  theatreMode: boolean;
  screenShareQuality: ScreenShareQuality;

  // ── Participants ──
  participants: VoiceUser[];
  channelParticipants: Record<string, VoiceParticipant[]>;

  // ── Idle detection ──
  lastSpokeAt: number;

  // ── WebRTC stats overlay ──
  webrtcStats: WebRTCQualityStats | null;
  showStatsOverlay: boolean;

  // ── Lobby music (easter egg) ──
  lobbyMusicPlaying: boolean;
  lobbyMusicVolume: number;

  // ── Actions: Core Connection ──
  joinVoiceChannel: (channelId: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setMuted: (muted: boolean) => void;
  setParticipantVolume: (participantId: string, volume: number) => void;
  incrementDrinkCount: () => void;

  // ── Actions: Audio Settings ──
  updateAudioSetting: (key: keyof AudioSettings, value: boolean | number | string) => void;
  applyBitrate: (bitrate: number) => void;

  // ── Actions: Screen Sharing ──
  toggleScreenShare: (displaySurface?: "monitor" | "window") => Promise<void>;
  pinScreenShare: (participantId: string) => void;
  unpinScreenShare: () => void;
  toggleTheatreMode: () => void;
  setScreenShareQuality: (quality: ScreenShareQuality) => void;

  // ── Actions: Lobby Music ──
  setLobbyMusicVolume: (volume: number) => void;
  stopLobbyMusicAction: () => void;

  // ── Actions: Stats ──
  toggleStatsOverlay: () => void;

  // ── Internal ──
  _updateParticipants: () => void;
  _updateScreenSharers: () => void;
  _setChannelParticipants: (channelId: string, participants: VoiceParticipant[]) => void;
}

// ═══════════════════════════════════════════════════════════════════
// SECTION: Audio Settings Persistence
// ═══════════════════════════════════════════════════════════════════

const SETTINGS_STORAGE_KEY = "flux-audio-settings";

function loadAudioSettings(): AudioSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) { dbg("voice", "Failed to load audio settings from localStorage", e); }
  return { ...DEFAULT_SETTINGS };
}

function saveAudioSettings(settings: AudioSettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) { dbg("voice", "Failed to save audio settings to localStorage", e); }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION: Audio Processor Helpers
// ═══════════════════════════════════════════════════════════════════

/** Tear down all noise-suppression / gain processors in one call. */
async function cleanupAudioProcessors() {
  await destroyNoiseProcessor();
  setDryWetProcessor(null);
  setGainTrackProcessor(null);
}

// Monotonically increasing counter to detect stale joinVoiceChannel calls
let joinNonce = 0;

// Adaptive bitrate ceiling
let adaptiveTargetBitrate = DEFAULT_BITRATE;

// ═══════════════════════════════════════════════════════════════════
// SECTION: WebRTC Stats Polling
// ═══════════════════════════════════════════════════════════════════

let statsInterval: ReturnType<typeof setInterval> | null = null;

function startStatsPolling() {
  stopStatsPolling();
  resetStatsDelta();
  statsInterval = setInterval(async () => {
    const { room, showStatsOverlay } = useVoiceStore.getState();
    if (!room || !showStatsOverlay) return;
    try {
      const stats = await collectWebRTCStats(room);
      useVoiceStore.setState({ webrtcStats: stats });
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
}

// ═══════════════════════════════════════════════════════════════════
// SECTION: Lobby Music (Easter Egg)
// ═══════════════════════════════════════════════════════════════════

const lobbyMusicState = {
  timer: null as ReturnType<typeof setTimeout> | null,
  audio: null as HTMLAudioElement | null,
  gain: null as GainNode | null,
  ctx: null as AudioContext | null,
};

function checkLobbyMusic() {
  if (localStorage.getItem("flux-lobby-music-enabled") === "false") return;

  const { room } = useVoiceStore.getState();
  if (!room) return;

  const isAlone = room.remoteParticipants.size === 0;

  if (isAlone) {
    if (!lobbyMusicState.timer && !lobbyMusicState.audio) {
      lobbyMusicState.timer = setTimeout(() => {
        lobbyMusicState.timer = null;
        startLobbyMusic();
      }, LOBBY_WAIT_MS);
    }
  } else {
    if (lobbyMusicState.timer) {
      clearTimeout(lobbyMusicState.timer);
      lobbyMusicState.timer = null;
    }
    if (lobbyMusicState.audio) {
      fadeOutLobbyMusic();
    }
  }
}

function startLobbyMusic() {
  if (lobbyMusicState.audio) return;

  const vol = useVoiceStore.getState().lobbyMusicVolume;
  const audio = new Audio("/lobby-music.mp3");
  audio.loop = true;

  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + LOBBY_FADE_IN_S);

  source.connect(gain);
  gain.connect(ctx.destination);

  audio.play().catch((e) => {
    dbg("voice", "Failed to play lobby music", e);
    ctx.close().catch((e2) => { dbg("voice", "Failed to close lobby music AudioContext after play error", e2); });
    useVoiceStore.setState({ lobbyMusicPlaying: false });
  });

  lobbyMusicState.audio = audio;
  lobbyMusicState.gain = gain;
  lobbyMusicState.ctx = ctx;
  useVoiceStore.setState({ lobbyMusicPlaying: true });
}

function fadeOutLobbyMusic() {
  if (!lobbyMusicState.gain || !lobbyMusicState.ctx || !lobbyMusicState.audio) return;

  const gain = lobbyMusicState.gain;
  const ctx = lobbyMusicState.ctx;
  const audio = lobbyMusicState.audio;

  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + LOBBY_FADE_OUT_S);

  setTimeout(() => {
    audio.pause();
    audio.src = "";
    ctx.close().catch((e) => { dbg("voice", "Failed to close lobby music AudioContext after fade-out", e); });
  }, LOBBY_FADE_OUT_S * 1000);

  lobbyMusicState.audio = null;
  lobbyMusicState.gain = null;
  lobbyMusicState.ctx = null;
  useVoiceStore.setState({ lobbyMusicPlaying: false });
}

function stopLobbyMusic() {
  if (lobbyMusicState.timer) {
    clearTimeout(lobbyMusicState.timer);
    lobbyMusicState.timer = null;
  }
  if (lobbyMusicState.audio) {
    lobbyMusicState.audio.pause();
    lobbyMusicState.audio.src = "";
  }
  if (lobbyMusicState.ctx) {
    lobbyMusicState.ctx.close().catch((e) => { dbg("voice", "Failed to close lobby music AudioContext on stop", e); });
  }
  lobbyMusicState.audio = null;
  lobbyMusicState.gain = null;
  lobbyMusicState.ctx = null;
  useVoiceStore.setState({ lobbyMusicPlaying: false });
}

// Clean up lobby music on app close
window.addEventListener("beforeunload", stopLobbyMusic);

function setLobbyMusicGain(volume: number) {
  if (lobbyMusicState.gain && lobbyMusicState.ctx) {
    lobbyMusicState.gain.gain.setValueAtTime(lobbyMusicState.gain.gain.value, lobbyMusicState.ctx.currentTime);
    lobbyMusicState.gain.gain.linearRampToValueAtTime(volume, lobbyMusicState.ctx.currentTime + 0.1);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SECTION: Store Definition
// ═══════════════════════════════════════════════════════════════════

export const useVoiceStore = create<VoiceState>((set, get) => ({
  // ── Initial State ──
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
  screenShareQuality: "1080p60",
  participants: [],
  channelParticipants: {},
  lastSpokeAt: 0,
  lobbyMusicPlaying: false,
  webrtcStats: null,
  showStatsOverlay: false,
  lobbyMusicVolume: parseFloat(localStorage.getItem("flux-lobby-music-volume") ?? String(LOBBY_DEFAULT_GAIN)),

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS: Core Connection (join, leave, mute, deafen, volume)
  // ═══════════════════════════════════════════════════════════════

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
      } catch (e) { dbg("voice", "Failed to stop local mic tracks during room switch", e); }

      stopAudioLevelPolling();
      stopLobbyMusic();
      await cleanupAudioProcessors();
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

      // ── Room Event Handlers ──

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
        // Enforce CBR on audio tracks (set min = max bitrate)
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

      // ── Connect & Post-Connect Setup ──

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
        roomSid: (room as any).sid,
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
            const dwp = new DryWetTrackProcessor(processor, strength);
            dwp.setPreGain(audioSettings.micInputGain / 100);
            setDryWetProcessor(dwp);
            await micPub.track.setProcessor(dwp as any);
            dbg("voice", `joinVoiceChannel ${audioSettings.noiseSuppressionModel} noise filter active`);
          } else {
            dbg("voice", "joinVoiceChannel noise filter skipped — no mic track publication");
          }
        } catch (e) {
          dbg("voice", "joinVoiceChannel noise filter setup failed", e);
          await destroyNoiseProcessor();
          setDryWetProcessor(null);
          set({ audioSettings: { ...get().audioSettings, noiseSuppressionModel: "off" } });
        }
      } else if (audioSettings.micInputGain !== 100) {
        // No noise suppression but mic gain is non-unity — use GainTrackProcessor
        try {
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track) {
            const { GainTrackProcessor } = await import("../lib/GainTrackProcessor.js");
            const gtp = new GainTrackProcessor(audioSettings.micInputGain / 100);
            setGainTrackProcessor(gtp);
            await micPub.track.setProcessor(gtp as any);
            dbg("voice", "joinVoiceChannel GainTrackProcessor active (no noise model)");
          }
        } catch (e) {
          dbg("voice", "joinVoiceChannel GainTrackProcessor setup failed", e);
          setGainTrackProcessor(null);
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
      startAudioLevelPolling(useVoiceStore);
      startStatsPolling(); // Stats for overlay display
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
    } catch (e) { dbg("voice", "Failed to stop Spotify session on voice leave", e); }

    // Clean up noise suppression processor
    cleanupAudioProcessors();

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
    const micTrack = getLocalMicTrack();
    if (!newMuted && micTrack) micTrack.enabled = true;
    room.localParticipant.setMicrophoneEnabled(!newMuted);
    if (newMuted) playMuteSound(); else playUnmuteSound();
    set({ isMuted: newMuted });
    get()._updateParticipants();
  },

  setMuted: (muted: boolean) => {
    const { room, isMuted } = get();
    if (!room || isMuted === muted) return;
    // Ensure noise gate track state is in sync when unmuting
    const micTrack = getLocalMicTrack();
    if (!muted && micTrack) micTrack.enabled = true;
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
      set({ isDeafened: newDeafened, isMuted: true });
    } else if (!newDeafened) {
      // Undeafening also unmutes the mic — ensure gate track state is in sync
      const micTrack = getLocalMicTrack();
      if (micTrack) micTrack.enabled = true;
      room.localParticipant.setMicrophoneEnabled(true);
      set({ isDeafened: false, isMuted: false });
    } else {
      set({ isDeafened: newDeafened });
    }
    get()._updateParticipants();
  },

  setParticipantVolume: (participantId: string, volume: number) => {
    const { participantTrackMap, isDeafened, room } = get();

    set((state) => ({
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
              set((state) => ({
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
  },

  incrementDrinkCount: () => {
    const { room, connectedChannelId, channelParticipants } = get();
    if (!room || !connectedChannelId) return;
    const me = room.localParticipant.identity;
    const participants = channelParticipants[connectedChannelId] || [];
    const current = participants.find((p) => p.userId === me)?.drinkCount ?? 0;
    gateway.send({ type: "voice_drink_update", channelId: connectedChannelId, drinkCount: current + 1 });
  },

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS: Audio Settings & Pipeline Control
  // ═══════════════════════════════════════════════════════════════

  updateAudioSetting: (key: keyof AudioSettings, value: boolean | number | string) => {
    dbg("voice", `updateAudioSetting ${key}=${value}`);
    const { room, audioSettings } = get();
    const newSettings = { ...audioSettings, [key]: value } as AudioSettings;
    set({ audioSettings: newSettings });
    saveAudioSettings(newSettings);

    // Input sensitivity settings are handled by the polling loop, no action needed
    if (key === "inputSensitivity" || key === "inputSensitivityEnabled") {
      // If disabling the gate, release it immediately
      if (key === "inputSensitivityEnabled" && !value && room) {
        // Re-enable track when disabling the gate
        const micTrack = getLocalMicTrack();
        if (micTrack) micTrack.enabled = true;
        room.localParticipant.setMicrophoneEnabled(true);
      }
      return;
    }

    // Noise gate hold time is used by the polling loop directly
    if (key === "noiseGateHoldTime") return;

    // Suppression strength — update DryWetTrackProcessor live
    if (key === "suppressionStrength") {
      const dwp = getDryWetProcessor();
      if (dwp) {
        dwp.strength = (value as number) / 100;
      }
      return;
    }

    // VAD threshold — post message to RNNoise worklet
    if (key === "vadThreshold") {
      if (getActiveNoiseModel() === "rnnoise" && getNoiseProcessor()) {
        const dwp = getDryWetProcessor();
        const innerProc = dwp
          ? dwp.getInnerProcessor()
          : getNoiseProcessor();
        if (innerProc && "setVadThreshold" in innerProc) {
          (innerProc as any).setVadThreshold((value as number) / 100);
        }
      }
      return;
    }

    // Mic input gain — update DryWetTrackProcessor pre-gain or GainTrackProcessor
    if (key === "micInputGain") {
      const dwp = getDryWetProcessor();
      if (dwp) {
        dwp.setPreGain((value as number) / 100);
      } else if (newSettings.noiseSuppressionModel === "off" && room) {
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.track) {
          if ((value as number) !== 100) {
            // Need gain processing — create or update GainTrackProcessor
            const gtp = getGainTrackProcessor();
            if (gtp) {
              gtp.setGain((value as number) / 100);
            } else {
              const setupGain = async () => {
                try {
                  const { GainTrackProcessor } = await import("../lib/GainTrackProcessor.js");
                  const newGtp = new GainTrackProcessor((value as number) / 100);
                  setGainTrackProcessor(newGtp);
                  await micPub.track!.setProcessor(newGtp as any);
                } catch (e) {
                  dbg("voice", "Failed to setup GainTrackProcessor:", e);
                  setGainTrackProcessor(null);
                }
              };
              setupGain();
            }
          } else if (getGainTrackProcessor()) {
            // Gain is 100% (unity) — remove processor
            micPub.track.stopProcessor().then(() => {
              setGainTrackProcessor(null);
            }).catch((e) => {
              dbg("voice", "Failed to stop gain processor:", e);
              setGainTrackProcessor(null);
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
      rebuildAllPipelines(newSettings, get().participantVolumes, get().participantTrackMap, get().isDeafened);
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
      rebuildAllPipelines(newSettings, get().participantVolumes, get().participantTrackMap, get().isDeafened);
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
            setDryWetProcessor(null);
            // If mic gain is non-unity, set up GainTrackProcessor
            if (currentGain !== 100 && micPub.track) {
              try {
                const { GainTrackProcessor } = await import("../lib/GainTrackProcessor.js");
                const gtp = new GainTrackProcessor(currentGain / 100);
                setGainTrackProcessor(gtp);
                await micPub.track.setProcessor(gtp as any);
              } catch (e2) {
                dbg("voice", "Failed to setup GainTrackProcessor:", e2);
                setGainTrackProcessor(null);
              }
            }
          })
          .catch((e) => {
            dbg("voice", "Failed to stop noise processor during model switch:", e);
            destroyNoiseProcessor();
            setDryWetProcessor(null);
          });
      } else {
        // Stop existing processor first, then attach new one
        const myNonce = incrementNoiseSwitchNonce();
        const switchModel = async () => {
          try {
            if (getNoiseProcessor() || getDryWetProcessor() || getGainTrackProcessor()) {
              await micPub.track!.stopProcessor();
              await cleanupAudioProcessors();
            }
            if (myNonce !== getNoiseSwitchNonce()) return;
            const processor = await getOrCreateNoiseProcessor(model);
            if (myNonce !== getNoiseSwitchNonce()) return;
            if (processor) {
              const currentSettings = get().audioSettings;
              const strength = currentSettings.suppressionStrength / 100;

              // Apply VAD threshold if switching to RNNoise
              if (model === "rnnoise" && "setVadThreshold" in processor) {
                (processor as any).setVadThreshold(currentSettings.vadThreshold / 100);
              }

              // Always wrap with DryWetTrackProcessor so micInputGain works at any suppression strength
              const { DryWetTrackProcessor } = await import("../lib/DryWetTrackProcessor.js");
              const dwp = new DryWetTrackProcessor(processor, strength);
              dwp.setPreGain(currentSettings.micInputGain / 100);
              setDryWetProcessor(dwp);
              await micPub.track!.setProcessor(dwp as any);
              dbg("voice", `Noise suppression model switched to ${model}`);
            }
          } catch (e) {
            if (myNonce !== getNoiseSwitchNonce()) return;
            dbg("voice", `Noise model ${model} failed — reverting to off`, e instanceof Error ? e.message : e);
            await destroyNoiseProcessor();
            setDryWetProcessor(null);
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
  },

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS: Screen Sharing
  // ═══════════════════════════════════════════════════════════════

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

        // Apply resolution + framerate constraints on the captured track
        // (browser may not honor capture hints, so enforce after start)
        for (const pub of room.localParticipant.videoTrackPublications.values()) {
          if (pub.source === Track.Source.ScreenShare && pub.track) {
            const mst = pub.track.mediaStreamTrack;
            if (mst?.readyState === "live") {
              mst.applyConstraints({
                width: { ideal: preset.width },
                height: { ideal: preset.height },
                frameRate: { ideal: preset.frameRate },
              }).catch((e) => { dbg("voice", "Failed to apply screen share track constraints", e); });
            }
          }
        }
      }
      get()._updateScreenSharers();
    } catch (err) {
      if (err instanceof Error && err.message.includes("Permission denied")) {
        dbg("voice", "toggleScreenShare user cancelled permission dialog");
        return;
      }
      dbg("voice", "toggleScreenShare error", err);
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

    // Codec change (h264 <-> vp9) requires republishing the track
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
          dbg("voice", "Failed to republish screen share for codec change:", e);
        }
      })();
      return;
    }

    // Same codec — apply encoding params live via RTCRtpSender + track constraints
    dbg("voice", `setScreenShareQuality live update: ${prevQuality} → ${quality}`, preset);

    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      if (pub.source === Track.Source.ScreenShare && pub.track) {
        // Update encoder params (bitrate, framerate cap)
        const sender = pub.track.sender;
        if (sender) {
          const params = sender.getParameters();
          if (params.encodings && params.encodings.length > 0) {
            params.encodings[0].maxBitrate = preset.maxBitrate;
            params.encodings[0].maxFramerate = preset.frameRate;
            sender.setParameters(params).catch((e: unknown) =>
              dbg("voice", "Failed to update screen share encoding:", e),
            );
          }
        }
        // Apply resolution + framerate constraints on the actual MediaStreamTrack
        const mediaTrack = pub.track.mediaStreamTrack;
        if (mediaTrack?.readyState === "live") {
          mediaTrack.contentHint = preset.contentHint;
          mediaTrack.applyConstraints({
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: preset.frameRate },
          }).catch((e: unknown) =>
            dbg("voice", "Failed to apply track constraints:", e),
          );
        }
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS: Lobby Music
  // ═══════════════════════════════════════════════════════════════

  setLobbyMusicVolume: (volume: number) => {
    localStorage.setItem("flux-lobby-music-volume", String(volume));
    set({ lobbyMusicVolume: volume });
    setLobbyMusicGain(volume);
  },

  stopLobbyMusicAction: () => {
    stopLobbyMusic();
  },

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS: WebRTC Stats
  // ═══════════════════════════════════════════════════════════════

  toggleStatsOverlay: () => {
    const { showStatsOverlay } = get();
    const newVal = !showStatsOverlay;
    set({ showStatsOverlay: newVal, webrtcStats: newVal ? get().webrtcStats : null });
  },

  // ═══════════════════════════════════════════════════════════════
  // INTERNAL: Participant & Screen Share Tracking
  // ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// SECTION: WebSocket Event Handlers
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// SECTION: BroadcastChannel Sync (Popout Windows)
// ═══════════════════════════════════════════════════════════════════

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
