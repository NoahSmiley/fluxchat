import * as api from "@/lib/api/index.js";
import { API_BASE } from "@/lib/serverUrl.js";
import { dbg } from "@/lib/debug.js";
import type { SpotifyState } from "./types.js";
import {
  generateRandomString,
  generateCodeChallenge,
  getPersistedPlayer,
  getPersistedDeviceId,
  persistPlayer,
} from "./types.js";
import type { StoreApi } from "zustand";

export function createStartOAuthFlow(storeApi: StoreApi<SpotifyState>) {
  return async () => {
    const set = storeApi.setState.bind(storeApi);
    const get = storeApi.getState.bind(storeApi);

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

      const { state, redirectUri: backendRedirectUri } = await api.initSpotifyAuth(codeVerifier);

      let redirectUri = backendRedirectUri;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const serverUrl = API_BASE.startsWith("/") ? "http://127.0.0.1:3001" : API_BASE.replace(/\/api$/, "");
        invoke("start_oauth_listener", { serverUrl });
        redirectUri = "http://127.0.0.1:29170/callback";
        dbg("spotify", "OAuth using local listener", { redirectUri });
      } catch {
        dbg("spotify", "OAuth using backend redirect", { redirectUri });
      }

      const scopes = [
        "streaming", "user-read-email", "user-read-private",
        "user-modify-playback-state", "user-read-playback-state",
      ].join(" ");

      const authUrl = new URL("https://accounts.spotify.com/authorize");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("scope", scopes);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("code_challenge", codeChallenge);

      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(authUrl.toString());
      } catch {
        window.open(authUrl.toString(), "_blank");
      }

      set({ polling: true });
      const pollInterval = setInterval(async () => {
        try {
          const info = await api.getSpotifyAuthInfo();
          if (info.linked) {
            clearInterval(pollInterval);
            set({ account: info, polling: false });
            get().initializeSDK();
          }
        } catch { /* Keep polling */ }
      }, 2000);

      setTimeout(() => { clearInterval(pollInterval); set({ polling: false }); }, 300000);
    } catch (err) {
      dbg("spotify", "OAuth flow failed:", err);
      set({ oauthError: "Failed to start Spotify login. Check your connection." });
    }
  };
}

export function createConnectPlayer(storeApi: StoreApi<SpotifyState>) {
  return () => {
    const set = storeApi.setState.bind(storeApi);
    const get = storeApi.getState.bind(storeApi);

    console.log("[spotify] connectPlayer", { hasSpotifyGlobal: !!window.Spotify, hasPlayer: !!get().player });
    if (!window.Spotify) {
      console.warn("[spotify] connectPlayer aborted — window.Spotify not available");
      return;
    }

    const persisted = getPersistedPlayer();
    const persistedDeviceId = getPersistedDeviceId();
    if (persisted && !get().player) {
      if (persistedDeviceId) {
        // Persisted player was previously functional — restore it
        console.log("[spotify] restoring persisted player, deviceId:", persistedDeviceId);
        set({ player: persisted, deviceId: persistedDeviceId });

        persisted.removeListener("player_state_changed");
        persisted.removeListener("ready");
        persisted.removeListener("not_ready");
        persisted.removeListener("initialization_error");
        persisted.removeListener("authentication_error");
        persisted.removeListener("account_error");
        persisted.removeListener("playback_error");

        persisted.addListener("ready", ({ device_id }: { device_id: string }) => {
          console.log("[spotify] persisted player ready, deviceId:", device_id);
          set({ deviceId: device_id });
          persistPlayer(persisted, device_id);
        });
        persisted.addListener("not_ready", () => {
          console.warn("[spotify] persisted player not_ready — reconnecting in 1s");
          set({ deviceId: null });
          persistPlayer(persisted, null);
          setTimeout(() => persisted.connect(), 1000);
        });
        persisted.addListener("initialization_error", ({ message }: { message: string }) => {
          console.warn("[spotify] initialization_error:", message);
        });
        persisted.addListener("authentication_error", ({ message }: { message: string }) => {
          console.warn("[spotify] authentication_error:", message);
        });
        persisted.addListener("account_error", ({ message }: { message: string }) => {
          console.warn("[spotify] account_error (Premium required):", message);
        });
        persisted.addListener("playback_error", ({ message }: { message: string }) => {
          console.warn("[spotify] playback_error:", message);
        });
        persisted.addListener("player_state_changed", (state: import("./types.js").SpotifyPlayerState | null) => {
          set({ playerState: state });
          if (state) get().updateActivity();
        });
        return;
      }

      // Persisted player never connected — discard it and create fresh
      console.log("[spotify] discarding stale persisted player (never had deviceId)");
      try { persisted.disconnect(); } catch { /* ignore */ }
      persistPlayer(null, null);
    }

    if (get().player) return;

    let player: InstanceType<typeof window.Spotify.Player>;
    try {
      player = new window.Spotify.Player({
        name: "Flux",
        getOAuthToken: async (cb) => {
          console.log("[spotify] getOAuthToken callback fired");
          try {
            const { accessToken } = await api.getSpotifyToken();
            console.log("[spotify] got token, length:", accessToken?.length ?? 0);
            cb(accessToken);
          } catch (e) {
            console.warn("[spotify] Failed to get OAuth token from backend:", e);
          }
        },
        volume: get().volume,
      });
      console.log("[spotify] Player constructed OK");
    } catch (e) {
      console.error("[spotify] Player constructor THREW:", e);
      return;
    }

    player.addListener("ready", ({ device_id }: { device_id: string }) => {
      console.log("[spotify] player ready, deviceId:", device_id);
      set({ deviceId: device_id });
      persistPlayer(player, device_id);
    });

    player.addListener("not_ready", () => {
      console.warn("[spotify] player not_ready — will reconnect in 1s");
      set({ deviceId: null });
      persistPlayer(player, null);
      setTimeout(() => player.connect(), 1000);
    });

    player.addListener("initialization_error", ({ message }: { message: string }) => {
      console.warn("[spotify] initialization_error:", message);
    });
    player.addListener("authentication_error", ({ message }: { message: string }) => {
      console.warn("[spotify] authentication_error:", message);
    });
    player.addListener("account_error", ({ message }: { message: string }) => {
      console.warn("[spotify] account_error (Premium required):", message);
    });
    player.addListener("playback_error", ({ message }: { message: string }) => {
      console.warn("[spotify] playback_error:", message);
    });

    player.addListener("player_state_changed", (state: import("./types.js").SpotifyPlayerState | null) => {
      const track = state?.track_window?.current_track;
      dbg("spotify", "player_state_changed", {
        paused: state?.paused, position: state?.position, duration: state?.duration,
        trackName: track?.name, trackUri: track?.uri,
        trackArtist: track?.artists?.map((a) => a.name).join(", "),
      });
      set({ playerState: state });
      if (state) get().updateActivity();
    });

    console.log("[spotify] calling player.connect()...");
    player.connect().then((success: boolean) => {
      console.log("[spotify] player.connect() result:", success);
      if (!success) console.warn("[spotify] player.connect() returned false — check Premium status and token");
    }).catch((err: unknown) => {
      console.error("[spotify] player.connect() REJECTED:", err);
    });
    set({ player });
    persistPlayer(player, null);

    // Diagnostic: check if the SDK created its internal iframe
    setTimeout(() => {
      const iframes = document.querySelectorAll("iframe");
      const spotifyIframes = [...iframes].filter(f => f.src.includes("spotify") || f.src.includes("scdn"));
      console.log("[spotify] iframes after 3s:", iframes.length, "total,", spotifyIframes.length, "spotify-related",
        [...iframes].map(f => f.src || "(no src)"));
    }, 3000);
  };
}
