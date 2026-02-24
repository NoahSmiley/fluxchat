import { create } from "zustand";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { API_BASE } from "../lib/serverUrl.js";
import { dbg } from "../lib/debug.js";

// Re-export types that external files may import from this module
export type { SpotifyState, SpotifyPlayer, SpotifyPlayerState } from "./spotify-types.js";

import type { SpotifyState } from "./spotify-types.js";
import {
  generateRandomString,
  generateCodeChallenge,
  getPersistedPlayer,
  getPersistedDeviceId,
  persistPlayer,
  yt,
} from "./spotify-types.js";

// Action creators
import { createEnsureDeviceId, createUpdateActivity, createPlay, createPause, createSkip, createSeek, createSetVolume } from "./spotify-playback.js";
import { createAddTrackToQueue, createRemoveFromQueue } from "./spotify-queue.js";
import { createSearchTracks, createSetShowSearch, createSetSearchInput, createSetSearchSource } from "./spotify-search.js";
import { createStartSession, createLoadSession, createLeaveSession, createEndSession } from "./spotify-session.js";
import { createHandleWSEvent } from "./spotify-events.js";

// ═══════════════════════════════════════════════════════════════════
// Module-level state
// ═══════════════════════════════════════════════════════════════════

let wsUnsub: (() => void) | null = null;

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
  const setShowSearch = createSetShowSearch(storeApi);
  const setSearchInput = createSetSearchInput(storeApi);
  const setSearchSource = createSetSearchSource(storeApi);
  const startSession = createStartSession(storeApi);
  const loadSession = createLoadSession(storeApi);
  const leaveSession = createLeaveSession(storeApi);
  const endSession = createEndSession(storeApi);
  const handleWSEvent = createHandleWSEvent(storeApi);

  return {
    // ── Initial State ──
    account: null,
    sdkReady: false,
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
    showSearch: false,
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
    setShowSearch,
    setSearchInput,
    setSearchSource,
    startSession,
    loadSession,
    leaveSession,
    endSession,
    handleWSEvent,

    // ── Inline Actions (account / SDK / player lifecycle) ──

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

      // Subscribe to WS events
      if (!wsUnsub) {
        wsUnsub = gateway.on((event) => get().handleWSEvent(event));
      }
    },

    startOAuthFlow: async () => {
      set({ oauthError: null });

      const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;
      if (!clientId) {
        dbg("spotify", "VITE_SPOTIFY_CLIENT_ID not set");
        set({ oauthError: "Spotify client ID not configured" });
        return;
      }

      try {
        const codeVerifier = generateRandomString(64);
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // Send code_verifier to backend; backend returns state nonce
        const { state, redirectUri: backendRedirectUri } = await api.initSpotifyAuth(codeVerifier);

        let redirectUri = backendRedirectUri;
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const serverUrl = API_BASE.startsWith("/") ? "http://127.0.0.1:3001" : API_BASE.replace(/\/api$/, "");
          // Start one-shot local HTTP server BEFORE opening the browser
          invoke("start_oauth_listener", { serverUrl });
          redirectUri = "http://127.0.0.1:29170/callback";
          dbg("spotify", "OAuth using local listener", { redirectUri });
        } catch {
          dbg("spotify", "OAuth using backend redirect", { redirectUri });
        }

        const scopes = [
          "streaming",
          "user-read-email",
          "user-read-private",
          "user-modify-playback-state",
          "user-read-playback-state",
        ].join(" ");

        const authUrl = new URL("https://accounts.spotify.com/authorize");
        authUrl.searchParams.set("client_id", clientId);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("scope", scopes);
        authUrl.searchParams.set("code_challenge_method", "S256");
        authUrl.searchParams.set("code_challenge", codeChallenge);

        // Open in system browser
        try {
          const { open } = await import("@tauri-apps/plugin-shell");
          await open(authUrl.toString());
        } catch {
          window.open(authUrl.toString(), "_blank");
        }

        // Poll for completion
        set({ polling: true });
        const pollInterval = setInterval(async () => {
          try {
            const info = await api.getSpotifyAuthInfo();
            if (info.linked) {
              clearInterval(pollInterval);
              set({ account: info, polling: false });
              get().initializeSDK();
            }
          } catch {
            // Keep polling
          }
        }, 2000);

        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(pollInterval);
          set({ polling: false });
        }, 300000);
      } catch (err) {
        dbg("spotify", "OAuth flow failed:", err);
        set({ oauthError: "Failed to start Spotify login. Check your connection." });
      }
    },

    unlinkAccount: async () => {
      get().disconnectPlayer();
      await api.unlinkSpotify();
      set({ account: { linked: false }, deviceId: null, playerState: null });
      persistPlayer(null, null);
    },

    initializeSDK: () => {
      // Already have a working player with a device
      if (get().sdkReady && get().player && get().deviceId) {
        dbg("spotify", "initializeSDK skipped — already ready", { deviceId: get().deviceId });
        return;
      }
      dbg("spotify", "initializeSDK", { sdkReady: get().sdkReady, hasPlayer: !!get().player, hasSpotifyGlobal: !!window.Spotify });

      // SDK global available — restore or create player
      if (window.Spotify) {
        set({ sdkReady: true });
        get().connectPlayer();
        return;
      }

      // SDK script tag exists but hasn't finished loading yet
      if (document.getElementById("spotify-sdk-script")) {
        window.onSpotifyWebPlaybackSDKReady = () => {
          set({ sdkReady: true });
          get().connectPlayer();
        };
        return;
      }

      window.onSpotifyWebPlaybackSDKReady = () => {
        set({ sdkReady: true });
        get().connectPlayer();
      };

      const script = document.createElement("script");
      script.id = "spotify-sdk-script";
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      document.body.appendChild(script);
    },

    connectPlayer: () => {
      dbg("spotify", "connectPlayer", { hasSpotifyGlobal: !!window.Spotify, hasPlayer: !!get().player });
      if (!window.Spotify) return;

      // Reuse player that survived HMR (persisted on window)
      const persisted = getPersistedPlayer();
      const persistedDeviceId = getPersistedDeviceId();
      if (persisted && !get().player) {
        dbg("spotify", "restoring persisted player, deviceId:", persistedDeviceId);
        set({ player: persisted, deviceId: persistedDeviceId });

        persisted.removeListener("player_state_changed");
        persisted.removeListener("ready");
        persisted.removeListener("not_ready");

        persisted.addListener("ready", ({ device_id }: { device_id: string }) => {
          set({ deviceId: device_id });
          persistPlayer(persisted, device_id);
        });
        persisted.addListener("not_ready", () => {
          set({ deviceId: null });
          persistPlayer(persisted, null);
          setTimeout(() => persisted.connect(), 1000);
        });
        persisted.addListener("player_state_changed", (state: import("./spotify-types.js").SpotifyPlayerState | null) => {
          set({ playerState: state });
          if (state) get().updateActivity();
        });
        return;
      }

      // Don't create a duplicate
      if (get().player) return;

      const player = new window.Spotify.Player({
        name: "Flux",
        getOAuthToken: async (cb) => {
          try {
            const { accessToken } = await api.getSpotifyToken();
            cb(accessToken);
          } catch (e) {
            dbg("spotify", "Failed to get Spotify token:", e);
          }
        },
        volume: get().volume,
      });

      player.addListener("ready", ({ device_id }: { device_id: string }) => {
        dbg("spotify", `player ready deviceId=${device_id}`);
        set({ deviceId: device_id });
        persistPlayer(player, device_id);
      });

      player.addListener("not_ready", () => {
        dbg("spotify", "player not_ready — will reconnect in 1s");
        set({ deviceId: null });
        persistPlayer(player, null);
        setTimeout(() => player.connect(), 1000);
      });

      player.addListener("player_state_changed", (state: import("./spotify-types.js").SpotifyPlayerState | null) => {
        const track = state?.track_window?.current_track;
        dbg("spotify", "player_state_changed", {
          paused: state?.paused,
          position: state?.position,
          duration: state?.duration,
          trackName: track?.name,
          trackUri: track?.uri,
          trackArtist: track?.artists?.map((a) => a.name).join(", "),
        });
        set({ playerState: state });
        if (state) get().updateActivity();
      });

      player.connect();
      set({ player });
      persistPlayer(player, null);
    },

    disconnectPlayer: () => {
      const { player } = get();
      if (player) {
        player.disconnect();
        set({ player: null, deviceId: null, playerState: null, sdkReady: false });
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
