import { create } from "zustand";

// Types are exported from index.ts — no re-export needed here

import type { VoiceState, ScreenShareQuality, AudioSettings } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { initLobbyMusic, setLobbyMusicGain, stopLobbyMusic, updateLobbyMusicSpeakerGain } from "./lobby.js";
import { initStatsPolling } from "./stats.js";
import { initVoiceEvents } from "./events.js";
import { createJoinVoiceChannel, createLeaveVoiceChannel, activeKrispProcessor, activeVadProcessor, setActiveKrispProcessor, setActiveVadProcessor, adaptiveTargetBitrate } from "./connection.js";
import { createToggleMute, createSetMuted, createToggleDeafen, createSetParticipantVolume, createApplyBitrate } from "./controls.js";
import { createToggleScreenShare, createSetScreenShareQuality } from "./screen-share.js";
import { createUpdateParticipants, createUpdateScreenSharers, createSetChannelParticipants } from "./participants.js";
import { attachNoiseFilter, detachNoiseFilter } from "@/lib/noiseProcessor.js";
import { setMasterSpeakerGain, setLocalMicGain, setupLocalMicGain } from "./room-events.js";
import { VadProcessor } from "@/lib/vadProcessor.js";
import { initAdaptiveBitrate, resetAdaptiveBitrate } from "@/lib/adaptiveBitrate.js";
import { Track } from "livekit-client";
import { useKeybindsStore } from "@/stores/keybinds.js";
import { dbg } from "@/lib/debug.js";

const LOBBY_DEFAULT_GAIN = 0.15;

function loadAudioSettings(): AudioSettings {
  try {
    const saved = localStorage.getItem("flux-audio-settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate old string noiseSuppression to boolean
      if (typeof parsed.noiseSuppression === "string") {
        parsed.noiseSuppression = parsed.noiseSuppression !== "off";
      }
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
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
      (async () => {
        try {
          await room.switchActiveDevice("audioinput", value);

          // Re-attach Krisp noise filter to the new mic track
          if (updated.noiseSuppression) {
            const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
            if (activeKrispProcessor) {
              await detachNoiseFilter(activeKrispProcessor, micPub);
              setActiveKrispProcessor(null);
            }
            if (micPub) {
              const processor = await attachNoiseFilter(micPub);
              if (processor) {
                setActiveKrispProcessor(processor);
                dbg("voice", "Krisp re-attached after input device switch");
              }
            }
          }
        } catch (e) {
          dbg("voice", "Input device switch failed", e);
        }
      })();
    }
    if (room && key === "audioOutputDeviceId" && typeof value === "string") {
      room.switchActiveDevice("audiooutput", value).catch(() => {});
    }

    // ── Live toggle: noise suppression (Krisp) ──
    if (room && key === "noiseSuppression") {
      (async () => {
        try {
          const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);

          // Tear down current processor
          if (activeKrispProcessor) {
            await detachNoiseFilter(activeKrispProcessor, micPub);
            setActiveKrispProcessor(null);
          }

          if (value && micPub) {
            const processor = await attachNoiseFilter(micPub);
            if (processor) {
              setActiveKrispProcessor(processor);
              dbg("voice", "Noise suppression enabled");
            } else {
              throw new Error("NoiseFilter attach returned null");
            }
          } else {
            dbg("voice", "Noise suppression disabled");
          }
        } catch (e) {
          dbg("voice", "Noise suppression toggle failed — mic continues without it", e);
          const reverted = { ...storeApi.getState().audioSettings, noiseSuppression: false };
          storeApi.setState({ audioSettings: reverted });
          try { localStorage.setItem("flux-audio-settings", JSON.stringify(reverted)); } catch { /* ignore */ }
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
            // Re-enable mic track if it was gated off (direct toggle, no signal)
            const micPubRestore = room.localParticipant.getTrackPublication(Track.Source.Microphone);
            const mstRestore = micPubRestore?.track?.mediaStreamTrack;
            if (mstRestore) mstRestore.enabled = true;
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
                  // Toggle mediaStreamTrack directly — don't send TrackMuted/TrackUnmuted
                  // signals to remote participants. Voice gating is transparent.
                  const track = micPub?.track?.mediaStreamTrack;
                  if (track) track.enabled = speaking;
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

    // ── Live adjust: speaker volume ──
    if (key === "speakerVolume" && typeof value === "number") {
      const { participantVolumes, isDeafened } = storeApi.getState();
      setMasterSpeakerGain(value, participantVolumes, isDeafened);
      updateLobbyMusicSpeakerGain();
    }

    // ── Live adjust: mic volume ──
    if (room && key === "micVolume" && typeof value === "number") {
      setLocalMicGain(value);
      // If mic gain pipeline doesn't exist yet (micVolume was 1.0 at connect time), set it up now
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const mst = micPub?.track?.mediaStreamTrack;
      if (mst && micPub?.track?.sender) {
        const adjustedTrack = setupLocalMicGain(mst, value);
        if (adjustedTrack) {
          micPub.track.sender.replaceTrack(adjustedTrack).catch((e) =>
            dbg("voice", "mic gain replaceTrack failed", e)
          );
        }
      }
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
    screenRoom: null,
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
    floatingCorner: "bottom-right" as VoiceState["floatingCorner"],
    floatingDismissed: false,
    floatingSize: { width: 320, height: 180 },
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

    setFloatingCorner: (corner) => {
      set({ floatingCorner: corner });
    },

    dismissFloating: () => {
      set({ floatingDismissed: true });
    },

    setFloatingSize: (size) => {
      set({ floatingSize: size });
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
