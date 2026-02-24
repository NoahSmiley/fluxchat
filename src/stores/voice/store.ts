import { create } from "zustand";
import type { AudioSettings } from "../../lib/audio/voice-pipeline.js";
import { LOBBY_DEFAULT_GAIN } from "../../lib/audio/voice-constants.js";

// Re-export types that external files import from this module
export type { NoiseSuppressionModel } from "./types.js";
export type { VoiceState } from "./types.js";

import type { VoiceState, ScreenShareQuality } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { loadAudioSettings } from "./audio-settings.js";
import { initLobbyMusic, setLobbyMusicGain, stopLobbyMusic } from "./lobby.js";
import { initStatsPolling } from "./stats.js";
import { initVoiceEvents } from "./events.js";
import { createJoinVoiceChannel, createLeaveVoiceChannel } from "./connection.js";
import { createToggleMute, createSetMuted, createToggleDeafen, createSetParticipantVolume, createApplyBitrate } from "./controls.js";
import { createUpdateAudioSetting } from "./audio-update.js";
import { createToggleScreenShare, createSetScreenShareQuality } from "./screen-share.js";
import { createUpdateParticipants, createUpdateScreenSharers, createSetChannelParticipants } from "./participants.js";

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
  const updateAudioSetting = createUpdateAudioSetting(storeApi);
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
    participantTrackMap: {},
    audioLevels: {},
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
    webrtcStats: null,
    showStatsOverlay: false,
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

    toggleStatsOverlay: () => {
      const { showStatsOverlay } = get();
      const newVal = !showStatsOverlay;
      set({ showStatsOverlay: newVal, webrtcStats: newVal ? get().webrtcStats : null });
    },
  };
});

// Initialize event listeners (WS + BroadcastChannel)
initVoiceEvents(useVoiceStore);
