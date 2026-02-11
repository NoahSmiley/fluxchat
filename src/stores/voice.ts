import { create } from "zustand";
import { Room, RoomEvent, Track, VideoPreset, VideoQuality } from "livekit-client";
import type { VoiceParticipant } from "../types/shared.js";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { broadcastState, onCommand, isPopout } from "../lib/broadcast.js";
import { KrispNoiseFilter, isKrispNoiseFilterSupported } from "@livekit/krisp-noise-filter";
import { useKeybindsStore } from "./keybinds.js";

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
  playTone([440, 580]);
}

function playLeaveSound() {
  playTone([520, 380]);
}

function playScreenShareStartSound() {
  playTone([660, 880], 0.06);
}

function playScreenShareStopSound() {
  playTone([880, 660], 0.06);
}

// ── Audio Pipeline (Web Audio API) ──

interface AudioPipeline {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  highPass: BiquadFilterNode;
  lowPass: BiquadFilterNode;
  gain: GainNode;
}

const audioPipelines = new Map<string, AudioPipeline>();

function createAudioPipeline(
  audioElement: HTMLAudioElement,
  trackSid: string,
  settings: AudioSettings,
  volume: number,
): AudioPipeline {
  const context = new AudioContext();
  if (context.state === "suspended") context.resume();
  const source = context.createMediaElementSource(audioElement);

  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = settings.highPassFrequency > 0 ? settings.highPassFrequency : 0;

  const lowPass = context.createBiquadFilter();
  lowPass.type = "lowpass";
  lowPass.frequency.value = settings.lowPassFrequency > 0 ? settings.lowPassFrequency : 24000;

  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, context.currentTime);

  source.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(gain);
  gain.connect(context.destination);

  const pipeline: AudioPipeline = { context, source, highPass, lowPass, gain };
  audioPipelines.set(trackSid, pipeline);
  return pipeline;
}

function destroyAudioPipeline(trackSid: string) {
  const pipeline = audioPipelines.get(trackSid);
  if (pipeline) {
    pipeline.context.close();
    audioPipelines.delete(trackSid);
  }
}

function destroyAllPipelines() {
  for (const trackSid of [...audioPipelines.keys()]) {
    destroyAudioPipeline(trackSid);
  }
}

// ── Krisp Noise Filter ──

let krispProcessor: ReturnType<typeof KrispNoiseFilter> | null = null;

function getOrCreateKrisp() {
  if (!krispProcessor) {
    krispProcessor = KrispNoiseFilter();
  }
  return krispProcessor;
}

function destroyKrisp() {
  krispProcessor = null;
}

// ── Audio Level Polling + Noise Gate ──

let audioLevelInterval: ReturnType<typeof setInterval> | null = null;
let gatedSilentSince: number | null = null; // timestamp when audio dropped below threshold
let isGated = false; // whether the noise gate is currently muting the mic

// Local mic analyser for real-time level metering
let localAnalyserCtx: AudioContext | null = null;
let localAnalyser: AnalyserNode | null = null;
let localAnalyserSource: MediaStreamAudioSourceNode | null = null;
let localAnalyserData: Float32Array | null = null;

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

    localAnalyserCtx = new AudioContext();
    // Resume in case it's suspended (browser autoplay policy)
    if (localAnalyserCtx.state === "suspended") {
      localAnalyserCtx.resume();
    }
    localAnalyser = localAnalyserCtx.createAnalyser();
    localAnalyser.fftSize = 256;
    localAnalyserData = new Float32Array(localAnalyser.fftSize);

    const stream = new MediaStream([mediaStreamTrack]);
    localAnalyserSource = localAnalyserCtx.createMediaStreamSource(stream);
    localAnalyserSource.connect(localAnalyser);
    console.log("[analyser] setup complete, ctx state:", localAnalyserCtx.state);
  } catch (e) {
    console.error("[analyser] Failed to setup:", e);
    teardownLocalAnalyser();
  }
}

function teardownLocalAnalyser() {
  localAnalyserSource?.disconnect();
  localAnalyserSource = null;
  localAnalyser = null;
  localAnalyserData = null;
  if (localAnalyserCtx) {
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
// Sensitivity 0 = threshold 0 (everything passes), 100 = threshold ~0.15 (aggressive gate)
function sensitivityToThreshold(sensitivity: number): number {
  return (sensitivity / 100) * 0.15;
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
    for (const p of room.remoteParticipants.values()) {
      levels[p.identity] = p.audioLevel ?? 0;
    }
    useVoiceStore.setState({ audioLevels: levels });

    // ── Noise gate logic ──
    const { audioSettings, isMuted } = state;
    if (!audioSettings.inputSensitivityEnabled || isMuted) {
      // If gate was active, release it
      if (isGated) {
        isGated = false;
        gatedSilentSince = null;
        room.localParticipant.setMicrophoneEnabled(true);
      }
      return;
    }

    const threshold = sensitivityToThreshold(audioSettings.inputSensitivity);

    if (localLevel < threshold) {
      // Audio below threshold
      if (!gatedSilentSince) {
        gatedSilentSince = Date.now();
      } else if (!isGated && Date.now() - gatedSilentSince > 200) {
        // Silent for 200ms — gate the mic
        isGated = true;
        room.localParticipant.setMicrophoneEnabled(false);
      }
    } else {
      // Audio above threshold — open gate immediately
      gatedSilentSince = null;
      if (isGated) {
        isGated = false;
        room.localParticipant.setMicrophoneEnabled(true);
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
  krispEnabled: boolean; // AI noise suppression via Krisp
}

interface ScreenShareInfo {
  participantId: string;
  username: string;
}

export type ScreenShareQuality = "high" | "medium" | "low";

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

  // Actions
  joinVoiceChannel: (channelId: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setMuted: (muted: boolean) => void;
  updateAudioSetting: (key: keyof AudioSettings, value: boolean | number) => void;
  applyBitrate: (bitrate: number) => void;
  toggleScreenShare: (displaySurface?: "monitor" | "window") => Promise<void>;
  setParticipantVolume: (participantId: string, volume: number) => void;
  pinScreenShare: (participantId: string) => void;
  unpinScreenShare: () => void;
  toggleTheatreMode: () => void;
  setScreenShareQuality: (quality: ScreenShareQuality) => void;

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
  inputSensitivityEnabled: false,
  krispEnabled: true,
};

const DEFAULT_BITRATE = 256_000;

export const useVoiceStore = create<VoiceState>((set, get) => ({
  room: null,
  connectedChannelId: null,
  connecting: false,
  connectionError: null,
  isMuted: false,
  isDeafened: false,
  audioSettings: { ...DEFAULT_SETTINGS },
  participantVolumes: {},
  participantTrackMap: {},
  audioLevels: {},
  isScreenSharing: false,
  screenSharers: [],
  pinnedScreenShare: null,
  theatreMode: false,
  screenShareQuality: "high",
  participants: [],
  channelParticipants: {},

  joinVoiceChannel: async (channelId: string) => {
    const { room: existingRoom, connectedChannelId, audioSettings } = get();

    if (connectedChannelId === channelId) return;

    if (existingRoom) {
      get().leaveVoiceChannel();
    }

    set({ connecting: true, connectionError: null });

    try {
      const { token, url } = await api.getVoiceToken(channelId);

      // Get channel bitrate from chat store
      const { useChatStore } = await import("./chat.js");
      const chatState = useChatStore.getState();
      const channel = chatState.channels.find((c) => c.id === channelId);
      const channelBitrate = channel?.bitrate ?? DEFAULT_BITRATE;

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
          videoCodec: "vp9",
          screenShareEncoding: {
            maxBitrate: 20_000_000,
            maxFramerate: 60,
            priority: "high",
          },
          screenShareSimulcastLayers: [],
          // L1T3 = 1 spatial layer (no resolution downscaling ever),
          // 3 temporal layers (server can only reduce framerate for slow viewers)
          scalabilityMode: "L1T3",
          degradationPreference: "maintain-resolution",
          backupCodec: { codec: "vp8" },
        },
      });

      room.on(RoomEvent.ParticipantConnected, () => get()._updateParticipants());
      room.on(RoomEvent.ParticipantDisconnected, () => {
        get()._updateParticipants();
        get()._updateScreenSharers();
      });
      room.on(RoomEvent.ActiveSpeakersChanged, () => get()._updateParticipants());
      room.on(RoomEvent.TrackMuted, () => get()._updateParticipants());
      room.on(RoomEvent.TrackUnmuted, () => get()._updateParticipants());

      // Attach remote audio tracks with Web Audio pipeline
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.id = `lk-audio-${track.sid}`;
          document.body.appendChild(el);

          // Create audio pipeline for filtering + volume
          const { audioSettings: settings, participantVolumes, isDeafened } = get();
          const volume = isDeafened ? 0 : (participantVolumes[participant.identity] ?? 1.0);
          createAudioPipeline(el, track.sid!, settings, volume);

          // Track participant → track mapping
          set((state) => ({
            participantTrackMap: {
              ...state.participantTrackMap,
              [participant.identity]: track.sid!,
            },
          }));
        }
        if (track.kind === Track.Kind.Video) {
          get()._updateScreenSharers();
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
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
        track.detach().forEach((el) => el.remove());
        if (track.kind === Track.Kind.Video) {
          get()._updateScreenSharers();
        }
      });

      room.on(RoomEvent.LocalTrackPublished, () => get()._updateScreenSharers());
      room.on(RoomEvent.LocalTrackUnpublished, () => {
        set({ isScreenSharing: false });
        get()._updateScreenSharers();
      });
      room.on(RoomEvent.Disconnected, () => {
        destroyAllPipelines();
        stopAudioLevelPolling();
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
          pinnedScreenShare: null,
        });
      });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);

      // Set up Krisp noise filter on the microphone track
      if (isKrispNoiseFilterSupported() && audioSettings.krispEnabled) {
        try {
          const krisp = getOrCreateKrisp();
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          if (micPub?.track) {
            await micPub.track.setProcessor(krisp);
          }
        } catch (e) {
          console.warn("Failed to enable Krisp noise filter:", e);
          destroyKrisp();
          set({ audioSettings: { ...get().audioSettings, krispEnabled: false } });
        }
      }

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
      });

      get()._updateParticipants();
      get()._updateScreenSharers();
      startAudioLevelPolling();

      // If push-to-talk is configured, start muted
      const { keybinds } = useKeybindsStore.getState();
      const hasPTT = keybinds.some((kb) => kb.action === "push-to-talk" && kb.key !== null);
      if (hasPTT) {
        room.localParticipant.setMicrophoneEnabled(false);
        set({ isMuted: true });
      }

      playJoinSound();

      gateway.send({ type: "voice_state_update", channelId, action: "join" });
    } catch (err) {
      set({
        connecting: false,
        connectionError: err instanceof Error ? err.message : "Failed to connect to voice",
      });
    }
  },

  leaveVoiceChannel: () => {
    const { room, connectedChannelId, channelParticipants } = get();
    const localId = room?.localParticipant?.identity;

    playLeaveSound();
    stopAudioLevelPolling();

    // Clean up Krisp processor
    destroyKrisp();

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
      pinnedScreenShare: null,
    });
  },

  toggleMute: () => {
    const { room, isMuted } = get();
    if (!room) return;
    room.localParticipant.setMicrophoneEnabled(isMuted);
    set({ isMuted: !isMuted });
    get()._updateParticipants();
  },

  setMuted: (muted: boolean) => {
    const { room, isMuted } = get();
    if (!room || isMuted === muted) return;
    room.localParticipant.setMicrophoneEnabled(!muted);
    set({ isMuted: muted });
    get()._updateParticipants();
  },

  toggleDeafen: () => {
    const { room, isDeafened, isMuted, participantVolumes, participantTrackMap } = get();
    if (!room) return;

    const newDeafened = !isDeafened;

    if (newDeafened) {
      // Mute all audio via gain nodes
      for (const pipeline of audioPipelines.values()) {
        pipeline.gain.gain.setValueAtTime(0, pipeline.context.currentTime);
      }
    } else {
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
      // Undeafening also unmutes the mic
      room.localParticipant.setMicrophoneEnabled(true);
      set({ isDeafened: false, isMuted: false });
    } else {
      set({ isDeafened: newDeafened });
    }
    get()._updateParticipants();
  },

  setParticipantVolume: (participantId: string, volume: number) => {
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
        pipeline.gain.gain.setValueAtTime(volume, pipeline.context.currentTime);
      }
    }
  },

  updateAudioSetting: (key: keyof AudioSettings, value: boolean | number) => {
    const { room, audioSettings } = get();
    const newSettings = { ...audioSettings, [key]: value } as AudioSettings;
    set({ audioSettings: newSettings });

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

    // Krisp noise filter toggle
    if (key === "krispEnabled") {
      if (!room || !isKrispNoiseFilterSupported()) return;
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (!micPub?.track) return;

      if (value) {
        const krisp = getOrCreateKrisp();
        micPub.track.setProcessor(krisp).catch((e: unknown) => {
          console.warn("Failed to enable Krisp noise filter:", e);
          destroyKrisp();
          set({ audioSettings: { ...get().audioSettings, krispEnabled: false } });
        });
      } else {
        micPub.track.stopProcessor().catch((e) => console.warn("Failed to disable Krisp noise filter:", e));
        destroyKrisp();
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
    const { room, isScreenSharing } = get();
    if (!room) return;

    try {
      if (isScreenSharing) {
        await room.localParticipant.setScreenShareEnabled(false);
        set({ isScreenSharing: false });
      } else {
        await room.localParticipant.setScreenShareEnabled(true,
          // Capture options
          {
            audio: true,
            contentHint: "detail",
            resolution: { width: 3840, height: 2160, frameRate: 60 },
            preferCurrentTab: false,
            selfBrowserSurface: "exclude",
            surfaceSwitching: "include",
            systemAudio: "include",
            ...(displaySurface ? { displaySurface } : {}),
          },
          // Publish options
          {
            videoCodec: "vp9",
            screenShareEncoding: {
              maxBitrate: 20_000_000,
              maxFramerate: 60,
              priority: "high",
            },
            scalabilityMode: "L1T3",
            degradationPreference: "maintain-resolution",
            backupCodec: { codec: "vp8" },
          },
        );
        set({ isScreenSharing: true });
      }
      get()._updateScreenSharers();
    } catch (err) {
      if (err instanceof Error && err.message.includes("Permission denied")) return;
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
    set({ screenShareQuality: quality });
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

// Listen for voice_state events from WebSocket (for sidebar display)
gateway.on((event) => {
  if (event.type === "voice_state") {
    useVoiceStore.getState()._setChannelParticipants(event.channelId, event.participants);
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
