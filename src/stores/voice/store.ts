import { create } from "zustand";

// Types are exported from index.ts — no re-export needed here

import type { VoiceState, ScreenShareQuality, AudioSettings } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { initLobbyMusic, setLobbyMusicGain, stopLobbyMusic } from "./lobby.js";
import { initStatsPolling } from "./stats.js";
import { initVoiceEvents } from "./events.js";
import { createJoinVoiceChannel, createLeaveVoiceChannel, activeRnnoiseProcessor, activeDeepFilterProcessor, activeDtlnProcessor, activeVadProcessor, setActiveRnnoiseProcessor, setActiveDeepFilterProcessor, setActiveDtlnProcessor, setActiveVadProcessor, adaptiveTargetBitrate } from "./connection.js";
import { createToggleMute, createSetMuted, createToggleDeafen, createSetParticipantVolume, createApplyBitrate } from "./controls.js";
import { createToggleScreenShare, createSetScreenShareQuality } from "./screen-share.js";
import { createUpdateParticipants, createUpdateScreenSharers, createSetChannelParticipants } from "./participants.js";
import { RnnoiseProcessor, DeepFilterProcessor, DtlnProcessor } from "@/lib/noiseProcessor.js";
import { VadProcessor } from "@/lib/vadProcessor.js";
import { initAdaptiveBitrate, resetAdaptiveBitrate } from "@/lib/adaptiveBitrate.js";
import { Track } from "livekit-client";
import { useKeybindsStore } from "@/stores/keybinds.js";
import { dbg } from "@/lib/debug.js";

const LOBBY_DEFAULT_GAIN = 0.15;

function loadAudioSettings(): AudioSettings {
  try {
    const saved = localStorage.getItem("flux-audio-settings");
    if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch { /* ignore corrupt data */ }
  return { ...DEFAULT_SETTINGS };
}

// ═══════════════════════════════════════════════════════════════════
// Store Definition
// ═══════════════════════════════════════════════════════════════════

export const useVoiceStore = create<VoiceState>()((set, get, storeApi) => {
  // Initialize external modules with store reference
  initLobbyMusic(storeApi);
  initStatsPolling(storeApi);

  // Create action implementations bound to the store
  const joinVoiceChannel = createJoinVoiceChannel(storeApi);
  const leaveVoiceChannel = createLeaveVoiceChannel(storeApi);
  const toggleMute = createToggleMute(storeApi);
  const setMuted = createSetMuted(storeApi);
  const toggleDeafen = createToggleDeafen(storeApi);
  const setParticipantVolume = createSetParticipantVolume(storeApi);
  const updateAudioSetting = (key: keyof AudioSettings, value: boolean | number | string) => {
    const current = storeApi.getState().audioSettings;
    const updated = { ...current, [key]: value };
    storeApi.setState({ audioSettings: updated });
    try { localStorage.setItem("flux-audio-settings", JSON.stringify(updated)); } catch { /* ignore */ }

    const room = storeApi.getState().room;

    // Switch audio device live if connected
    if (room && key === "audioInputDeviceId" && typeof value === "string") {
      room.switchActiveDevice("audioinput", value).catch(() => {});
    }
    if (room && key === "audioOutputDeviceId" && typeof value === "string") {
      room.switchActiveDevice("audiooutput", value).catch(() => {});
    }

    // ── Live toggle: noise suppression ──
    if (room && key === "noiseSuppression") {
      (async () => {
        try {
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);

          // Tear down current processor
          if (activeRnnoiseProcessor) {
            await activeRnnoiseProcessor.destroy();
            setActiveRnnoiseProcessor(null);
          }
          if (activeDeepFilterProcessor) {
            await activeDeepFilterProcessor.detach(micPub);
            setActiveDeepFilterProcessor(null);
          }
          if (activeDtlnProcessor) {
            await activeDtlnProcessor.destroy();
            setActiveDtlnProcessor(null);
          }

          if (value === "standard" && micPub?.track?.mediaStreamTrack) {
            const processor = new RnnoiseProcessor();
            const processedTrack = await processor.init(micPub.track.mediaStreamTrack);
            await (micPub.track as any).replaceTrack(processedTrack);
            setActiveRnnoiseProcessor(processor);
            dbg("voice", "Switched to RNNoise (standard)");
          } else if (value === "enhanced" && micPub) {
            const processor = new DeepFilterProcessor();
            await processor.attach(micPub);
            setActiveDeepFilterProcessor(processor);
            dbg("voice", "Switched to DeepFilterNet3 (enhanced)");
          } else if (value === "dtln" && micPub?.track?.mediaStreamTrack) {
            const processor = new DtlnProcessor();
            const processedTrack = await processor.init(micPub.track.mediaStreamTrack);
            await (micPub.track as any).replaceTrack(processedTrack);
            setActiveDtlnProcessor(processor);
            dbg("voice", "Switched to DTLN");
          } else {
            dbg("voice", "Noise suppression disabled");
          }
        } catch (e) {
          dbg("voice", "Live noise suppression toggle failed", e);
        }
      })();
    }

    // ── Live toggle: echo cancellation / auto gain control ──
    if (room && (key === "echoCancellation" || key === "autoGainControl")) {
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const mst = micPub?.track?.mediaStreamTrack;
      if (mst) {
        mst.applyConstraints({
          echoCancellation: key === "echoCancellation" ? value as boolean : updated.echoCancellation,
          autoGainControl: key === "autoGainControl" ? value as boolean : updated.autoGainControl,
        }).catch((e) => dbg("voice", "applyConstraints failed", e));
      }
    }

    // ── Live toggle: voice gating ──
    if (room && (key === "voiceGating" || key === "sensitivity")) {
      (async () => {
        try {
          // Always destroy existing VAD first
          if (activeVadProcessor) {
            await activeVadProcessor.destroy();
            setActiveVadProcessor(null);
            // Re-enable mic if it was gated off
            room.localParticipant.setMicrophoneEnabled(true);
          }

          if (updated.voiceGating) {
            const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
            const mst = micPub?.track?.mediaStreamTrack;
            if (mst) {
              const vadProc = new VadProcessor();
              await vadProc.init(
                new MediaStream([mst]),
                updated.sensitivity,
                (speaking) => {
                  const { isMuted, isDeafened } = storeApi.getState();
                  const { keybinds } = useKeybindsStore.getState();
                  const hasPTT = keybinds.some((kb) => kb.action === "push-to-talk" && kb.key !== null);
                  if (isMuted || isDeafened || hasPTT) return;
                  room.localParticipant.setMicrophoneEnabled(speaking);
                },
              );
              setActiveVadProcessor(vadProc);
              dbg("voice", `VAD ${key === "sensitivity" ? "sensitivity updated" : "enabled"}`);
            }
          } else {
            dbg("voice", "Voice gating disabled");
          }
        } catch (e) {
          dbg("voice", "Live VAD toggle failed", e);
        }
      })();
    }

    // ── Live toggle: adaptive bitrate ──
    if (key === "adaptiveBitrate") {
      if (value && room) {
        initAdaptiveBitrate(adaptiveTargetBitrate, (bitrate) => {
          storeApi.getState().applyBitrate(bitrate);
        });
      } else {
        resetAdaptiveBitrate();
      }
    }
  };
  const applyBitrate = createApplyBitrate(storeApi);
  const toggleScreenShare = createToggleScreenShare(storeApi);
  const setScreenShareQuality = createSetScreenShareQuality(storeApi);
  const _updateParticipants = createUpdateParticipants(storeApi);
  const _updateScreenSharers = createUpdateScreenSharers(storeApi);
  const _setChannelParticipants = createSetChannelParticipants(storeApi);

  return {
    // ── Initial State ──
    room: null,
    connectedChannelId: null,
    connecting: false,
    connectionError: null,
    isMuted: false,
    isDeafened: false,
    audioSettings: loadAudioSettings(),
    participantVolumes: {},
    speakingUserIds: new Set<string>(),
    isScreenSharing: false,
    screenSharers: [],
    pinnedScreenShare: null,
    theatreMode: false,
    screenShareQuality: "1080p60" as ScreenShareQuality,
    participants: [],
    channelParticipants: {},
    lastSpokeAt: 0,
    lobbyMusicPlaying: false,
    lobbyMusicVolume: parseFloat(localStorage.getItem("flux-lobby-music-volume") ?? String(LOBBY_DEFAULT_GAIN)),

    // ── Actions ──
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMute,
    setMuted,
    toggleDeafen,
    setParticipantVolume,
    updateAudioSetting,
    applyBitrate,
    toggleScreenShare,
    setScreenShareQuality,
    _updateParticipants,
    _updateScreenSharers,
    _setChannelParticipants,

    pinScreenShare: (participantId: string) => {
      set({ pinnedScreenShare: participantId });
    },

    unpinScreenShare: () => {
      set({ pinnedScreenShare: null });
    },

    toggleTheatreMode: () => {
      set((state) => ({ theatreMode: !state.theatreMode }));
    },

    setLobbyMusicVolume: (volume: number) => {
      localStorage.setItem("flux-lobby-music-volume", String(volume));
      set({ lobbyMusicVolume: volume });
      setLobbyMusicGain(volume);
    },

    stopLobbyMusicAction: () => {
      stopLobbyMusic();
    },
  };
});

// Initialize event listeners (WS + BroadcastChannel)
initVoiceEvents(useVoiceStore);
