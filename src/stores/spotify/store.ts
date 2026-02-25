import { create } from "zustand";
import * as api from "@/lib/api/index.js";
import { gateway } from "@/lib/ws.js";
import { dbg } from "@/lib/debug.js";

// Types are exported from index.ts — no re-export needed here

import type { SpotifyState } from "./types.js";
import { persistPlayer, yt } from "./types.js";

// Action creators
import { createEnsureDeviceId, createUpdateActivity, createPlay, createPause, createSkip, createSeek, createSetVolume } from "./playback.js";
import { createAddTrackToQueue, createRemoveFromQueue } from "./queue.js";
import { createSearchTracks, createSetSearchInput, createSetSearchSource } from "./search.js";
import { createStartSession, createLoadSession, createLeaveSession, createEndSession } from "./session.js";
import { createHandleWSEvent } from "./events.js";
import { createStartOAuthFlow, createConnectPlayer } from "./lifecycle.js";

// ═══════════════════════════════════════════════════════════════════
// Module-level state
// ═══════════════════════════════════════════════════════════════════

let wsUnsub: (() => void) | null = null;
let sdkReady = false;

// ═══════════════════════════════════════════════════════════════════
// Store Definition
// ═══════════════════════════════════════════════════════════════════

export const useSpotifyStore = create<SpotifyState>()((set, get, storeApi) => {
  // Create action implementations bound to the store
  const ensureDeviceId = createEnsureDeviceId(storeApi);
  const updateActivity = createUpdateActivity(storeApi);
  const play = createPlay(storeApi);
  const pause = createPause(storeApi);
  const skip = createSkip(storeApi);
  const seek = createSeek(storeApi);
  const setVolume = createSetVolume(storeApi);
  const addTrackToQueue = createAddTrackToQueue(storeApi);
  const removeFromQueue = createRemoveFromQueue(storeApi);
  const searchTracks = createSearchTracks(storeApi);
  const setSearchInput = createSetSearchInput(storeApi);
  const setSearchSource = createSetSearchSource(storeApi);
  const startSession = createStartSession(storeApi);
  const loadSession = createLoadSession(storeApi);
  const leaveSession = createLeaveSession(storeApi);
  const endSession = createEndSession(storeApi);
  const handleWSEvent = createHandleWSEvent(storeApi);
  const startOAuthFlow = createStartOAuthFlow(storeApi);
  const connectPlayer = createConnectPlayer(storeApi);

  return {
    // ── Initial State ──
    account: null,
    player: null,
    deviceId: null,
    playerState: null,
    volume: 0.5,
    session: null,
    queue: [],
    isHost: false,
    searchResults: [],
    searchLoading: false,
    polling: false,
    oauthError: null,
    searchSource: "spotify" as const,
    searchInput: "",

    // ── Extracted Actions ──
    ensureDeviceId,
    updateActivity,
    play,
    pause,
    skip,
    seek,
    setVolume,
    addTrackToQueue,
    removeFromQueue,
    searchTracks,
    setSearchInput,
    setSearchSource,
    startSession,
    loadSession,
    leaveSession,
    endSession,
    handleWSEvent,
    startOAuthFlow,
    connectPlayer,

    // ── Inline Actions (account / SDK lifecycle) ──

    loadAccount: async () => {
      dbg("spotify", "loadAccount");
      try {
        const info = await api.getSpotifyAuthInfo();
        dbg("spotify", "loadAccount result", { linked: info.linked, displayName: info.displayName });
        set({ account: info });
        if (info.linked) {
          get().initializeSDK();
        }
      } catch (e) {
        dbg("spotify", "loadAccount failed", e);
        set({ account: null });
      }

      if (!wsUnsub) {
        wsUnsub = gateway.on((event) => get().handleWSEvent(event));
      }
    },

    unlinkAccount: async () => {
      get().disconnectPlayer();
      await api.unlinkSpotify();
      set({ account: { linked: false }, deviceId: null, playerState: null });
      persistPlayer(null, null);
    },

    initializeSDK: () => {
      if (sdkReady && get().player && get().deviceId) {
        dbg("spotify", "initializeSDK skipped — already ready", { deviceId: get().deviceId });
        return;
      }
      dbg("spotify", "initializeSDK", { sdkReady, hasPlayer: !!get().player, hasSpotifyGlobal: !!window.Spotify });

      if (window.Spotify) {
        sdkReady = true;
        get().connectPlayer();
        return;
      }

      if (document.getElementById("spotify-sdk-script")) {
        window.onSpotifyWebPlaybackSDKReady = () => {
          sdkReady = true;
          get().connectPlayer();
        };
        return;
      }

      window.onSpotifyWebPlaybackSDKReady = () => {
        sdkReady = true;
        get().connectPlayer();
      };

      const script = document.createElement("script");
      script.id = "spotify-sdk-script";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
    },

    disconnectPlayer: () => {
      const { player } = get();
      if (player) {
        player.disconnect();
        sdkReady = false;
        set({ player: null, deviceId: null, playerState: null });
        persistPlayer(null, null);
      }
    },

    cleanup: () => {
      get().disconnectPlayer();
      yt().stopYouTube();
      if (wsUnsub) {
        wsUnsub();
        wsUnsub = null;
      }
    },
  };
});
