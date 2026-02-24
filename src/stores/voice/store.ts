import { create } from "zustand";

// Types are exported from index.ts — no re-export needed here

import type { VoiceState, ScreenShareQuality, AudioSettings } from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { initLobbyMusic, setLobbyMusicGain, stopLobbyMusic } from "./lobby.js";
import { initStatsPolling } from "./stats.js";
import { initVoiceEvents } from "./events.js";
import { createJoinVoiceChannel, createLeaveVoiceChannel } from "./connection.js";
import { createToggleMute, createSetMuted, createToggleDeafen, createSetParticipantVolume, createApplyBitrate } from "./controls.js";
import { createToggleScreenShare, createSetScreenShareQuality } from "./screen-share.js";
import { createUpdateParticipants, createUpdateScreenSharers, createSetChannelParticipants } from "./participants.js";

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
