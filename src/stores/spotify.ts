import { create } from "zustand";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { API_BASE } from "../lib/serverUrl.js";
import type { SpotifyAccount, ListeningSession, QueueItem, SpotifyTrack, WSServerEvent } from "../types/shared.js";
import { dbg } from "../lib/debug.js";

// PKCE helpers
function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join("");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function base64urlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await sha256(verifier);
  return base64urlEncode(hash);
}

// Spotify Web Playback SDK type declarations
declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (data: any) => void): void;
  removeListener(event: string): void;
  getCurrentState(): Promise<SpotifyPlayerState | null>;
  setName(name: string): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
}

interface SpotifyPlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: {
      uri: string;
      name: string;
      artists: { name: string }[];
      album: { name: string; images: { url: string }[] };
      duration_ms: number;
    } | null;
  };
}

interface SpotifyState {
  account: SpotifyAccount | null;
  sdkReady: boolean;
  player: SpotifyPlayer | null;
  deviceId: string | null;
  playerState: SpotifyPlayerState | null;
  volume: number;
  session: ListeningSession | null;
  queue: QueueItem[];
  isHost: boolean;
  searchResults: SpotifyTrack[];
  searchLoading: boolean;
  polling: boolean;
  oauthError: string | null;

  loadAccount: () => Promise<void>;
  startOAuthFlow: () => Promise<void>;
  unlinkAccount: () => Promise<void>;
  initializeSDK: () => void;
  connectPlayer: () => void;
  disconnectPlayer: () => void;
  ensureDeviceId: () => Promise<string | null>;
  updateActivity: () => void;
  searchTracks: (query: string) => Promise<void>;
  startSession: (voiceChannelId: string) => Promise<void>;
  loadSession: (voiceChannelId: string) => Promise<void>;
  leaveSession: () => void;
  endSession: () => Promise<void>;
  addTrackToQueue: (track: SpotifyTrack) => Promise<void>;
  removeFromQueue: (itemId: string) => Promise<void>;
  play: (trackUri?: string) => void;
  pause: () => void;
  skip: (trackUri?: string) => void;
  seek: (ms: number) => void;
  setVolume: (vol: number) => void;
  handleWSEvent: (event: WSServerEvent) => void;
  cleanup: () => void;
}

let wsUnsub: (() => void) | null = null;

// ── Persist player across HMR ──
// window properties survive Vite HMR module re-evaluation,
// so we keep the Spotify Player alive instead of recreating it every time.
const W = window as any;

function getPersistedPlayer(): SpotifyPlayer | null {
  return W.__fluxSpotifyPlayer ?? null;
}
function getPersistedDeviceId(): string | null {
  return W.__fluxSpotifyDeviceId ?? null;
}
function persistPlayer(player: SpotifyPlayer | null, deviceId: string | null) {
  W.__fluxSpotifyPlayer = player;
  W.__fluxSpotifyDeviceId = deviceId;
}

/** Play a track on a Spotify device, retrying on 404 (device not yet registered). */
async function playOnDevice(deviceId: string, uris: string[]): Promise<boolean> {
  dbg("spotify", `playOnDevice deviceId=${deviceId}`, { uris });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { accessToken } = await api.getSpotifyToken();
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris }),
      });
      if (res.ok) {
        dbg("spotify", `playOnDevice success on attempt ${attempt + 1}`);
        return true;
      }
      if (res.status === 404 && attempt < 3) {
        dbg("spotify", `playOnDevice 404 on attempt ${attempt + 1}, retrying...`);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      dbg("spotify", `playOnDevice failed status=${res.status}`, await res.text().catch(() => ""));
      return false;
    } catch (e) {
      dbg("spotify", "playOnDevice error", e);
      return false;
    }
  }
  return false;
}

export const useSpotifyStore = create<SpotifyState>((set, get) => ({
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
      console.error("[spotify] VITE_SPOTIFY_CLIENT_ID not set");
      set({ oauthError: "Spotify client ID not configured" });
      return;
    }

    try {
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await generateCodeChallenge(codeVerifier);

      // Send code_verifier to backend; backend returns state nonce
      const { state, redirectUri: backendRedirectUri } = await api.initSpotifyAuth(codeVerifier);

      // Determine redirect URI: use local OAuth listener in Tauri app,
      // fall back to backend redirect URI for web/dev
      let redirectUri = backendRedirectUri;
      let listenerPromise: Promise<unknown> | null = null;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        // Derive the server URL from API_BASE (strip "/api" suffix)
        const serverUrl = API_BASE.replace(/\/api$/, "");
        // Start one-shot local HTTP server BEFORE opening the browser
        listenerPromise = invoke("start_oauth_listener", { serverUrl });
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
      console.error("[spotify] OAuth flow failed:", err);
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
      console.log("[spotify] restoring persisted player, deviceId:", persistedDeviceId);
      set({ player: persisted, deviceId: persistedDeviceId });

      // Re-bind event listeners to the CURRENT store instance
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
      persisted.addListener("player_state_changed", (state: SpotifyPlayerState | null) => {
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
          console.error("Failed to get Spotify token:", e);
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

    player.addListener("player_state_changed", (state: SpotifyPlayerState | null) => {
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

  ensureDeviceId: async () => {
    let { deviceId } = get();
    if (deviceId) {
      dbg("spotify", `ensureDeviceId already have ${deviceId}`);
      return deviceId;
    }

    // Try reconnecting the existing player
    const { player } = get();
    if (player) {
      dbg("spotify", "ensureDeviceId reconnecting player...");
      player.connect();
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        deviceId = get().deviceId;
        if (deviceId) {
          dbg("spotify", `ensureDeviceId got deviceId=${deviceId} after ${i + 1} polls`);
          return deviceId;
        }
      }
    }

    dbg("spotify", "ensureDeviceId FAILED — no deviceId after 10 polls", { hasPlayer: !!player });
    return null;
  },

  updateActivity: () => {
    const { playerState } = get();
    if (!playerState || !playerState.track_window.current_track) {
      gateway.send({ type: "update_activity", activity: null });
      return;
    }

    const track = playerState.track_window.current_track;
    if (playerState.paused) {
      gateway.send({ type: "update_activity", activity: null });
      return;
    }

    gateway.send({
      type: "update_activity",
      activity: {
        name: track.name,
        activityType: "listening",
        artist: track.artists.map((a) => a.name).join(", "),
        albumArt: track.album.images[0]?.url,
        durationMs: track.duration_ms,
        progressMs: playerState.position,
      },
    });
  },

  searchTracks: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }

    set({ searchLoading: true });
    try {
      const data = await api.searchSpotifyTracks(query);
      const tracks: SpotifyTrack[] = data?.tracks?.items ?? [];
      set({ searchResults: tracks });
    } catch {
      set({ searchResults: [] });
    } finally {
      set({ searchLoading: false });
    }
  },

  startSession: async (voiceChannelId) => {
    dbg("spotify", `startSession channel=${voiceChannelId}`);
    const { player } = get();
    player?.pause();
    set({ playerState: null, queue: [], searchResults: [] });
    await api.createListeningSession(voiceChannelId);
    await get().loadSession(voiceChannelId);
    dbg("spotify", "startSession complete", { sessionId: get().session?.id });
  },

  loadSession: async (voiceChannelId) => {
    dbg("spotify", `loadSession channel=${voiceChannelId}`);
    try {
      const data = await api.getListeningSession(voiceChannelId);
      if (data.session) {
        const { useAuthStore } = await import("./auth.js");
        const userId = useAuthStore.getState().user?.id;
        const wasAlreadyLoaded = get().session?.id === data.session.id;
        dbg("spotify", "loadSession found session", {
          sessionId: data.session.id,
          host: data.session.hostUserId,
          isPlaying: data.session.isPlaying,
          currentTrackUri: data.session.currentTrackUri,
          currentTrackPositionMs: data.session.currentTrackPositionMs,
          queueLength: data.queue.length,
          wasAlreadyLoaded,
          isHost: data.session.hostUserId === userId,
        });
        set({
          session: data.session,
          queue: data.queue,
          isHost: data.session.hostUserId === userId,
        });

        // If joining a session that has an active track playing, sync playback
        if (!wasAlreadyLoaded && data.session.isPlaying && data.session.currentTrackUri) {
          dbg("spotify", "loadSession syncing playback to active track", {
            trackUri: data.session.currentTrackUri,
            positionMs: data.session.currentTrackPositionMs,
          });
          const deviceId = await get().ensureDeviceId();
          if (deviceId) {
            await playOnDevice(deviceId, [data.session.currentTrackUri]);
            const { player } = get();
            if (player && data.session.currentTrackPositionMs > 0) {
              const elapsed = Date.now() - new Date(data.session.updatedAt).getTime();
              const seekTo = data.session.currentTrackPositionMs + elapsed;
              dbg("spotify", `loadSession seeking to ${seekTo}ms (pos=${data.session.currentTrackPositionMs} + elapsed=${elapsed})`);
              setTimeout(() => player.seek(seekTo), 500);
            }
          } else {
            dbg("spotify", "loadSession sync failed — no deviceId");
          }
        }
      } else {
        dbg("spotify", "loadSession no active session");
        set({ session: null, queue: [], isHost: false });
      }
    } catch (e) {
      dbg("spotify", "loadSession error", e);
      set({ session: null, queue: [], isHost: false });
    }
  },

  leaveSession: () => {
    dbg("spotify", "leaveSession");
    const { player } = get();
    player?.pause();
    set({ session: null, queue: [], isHost: false });
  },

  endSession: async () => {
    const { session, player } = get();
    if (!session) return;
    dbg("spotify", `endSession sessionId=${session.id}`);
    player?.pause();
    try {
      await api.deleteListeningSession(session.id);
    } catch (e) {
      dbg("spotify", "endSession error", e);
    }
    set({ session: null, queue: [], isHost: false });
  },

  addTrackToQueue: async (track) => {
    const { session } = get();
    if (!session) return;
    dbg("spotify", `addTrackToQueue "${track.name}" by ${track.artists.map((a) => a.name).join(", ")}`, { uri: track.uri });

    await api.addToQueue(session.id, {
      trackUri: track.uri,
      trackName: track.name,
      trackArtist: track.artists.map((a) => a.name).join(", "),
      trackAlbum: track.album.name,
      trackImageUrl: track.album.images[0]?.url,
      trackDurationMs: track.duration_ms,
    });
  },

  removeFromQueue: async (itemId) => {
    const { session } = get();
    if (!session) return;
    dbg("spotify", `removeFromQueue itemId=${itemId}`);
    set((s) => ({ queue: s.queue.filter((item) => item.id !== itemId) }));
    await api.removeFromQueue(session.id, itemId);
  },

  play: async (trackUri) => {
    const { session, player, queue } = get();
    if (!session) return;
    dbg("spotify", `play trackUri=${trackUri ?? "(resume)"}`, { sessionId: session.id, hasPlayer: !!player });

    // Remove track from queue if it's in there
    if (trackUri) {
      const queueItem = queue.find((item) => item.trackUri === trackUri);
      if (queueItem) {
        set((s) => ({ queue: s.queue.filter((item) => item.trackUri !== trackUri) }));
        api.removeFromQueue(session.id, queueItem.id);
      }
    }

    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "play",
      trackUri,
      positionMs: 0,
    });

    // Also control local player
    if (player && trackUri) {
      const deviceId = await get().ensureDeviceId();
      if (deviceId) {
        await playOnDevice(deviceId, [trackUri]);
      }
    } else if (player) {
      player.resume();
    }
  },

  pause: () => {
    const { session, player, playerState } = get();
    if (!session) return;
    dbg("spotify", `pause position=${playerState?.position}`, { sessionId: session.id });

    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "pause",
      positionMs: playerState?.position,
    });

    player?.pause();
  },

  skip: async (trackUri) => {
    const { session, player, queue } = get();
    if (!session) return;

    // Find next track in queue if no URI provided
    const nextTrack = trackUri ?? queue[0]?.trackUri;
    dbg("spotify", `skip nextTrack=${nextTrack ?? "(none)"}`, { queueLength: queue.length });

    // No next track — stop playback and clear now-playing
    if (!nextTrack) {
      gateway.send({
        type: "spotify_playback_control",
        sessionId: session.id,
        action: "pause",
        positionMs: 0,
      });
      player?.pause();
      set({ playerState: null });
      gateway.send({ type: "update_activity", activity: null });
      return;
    }

    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "skip",
      trackUri: nextTrack,
    });

    // Remove the track we're skipping to from the queue
    set((s) => ({ queue: s.queue.filter((item) => item.trackUri !== nextTrack) }));

    // Ensure we have a device and play the next track
    const deviceId = await get().ensureDeviceId();
    if (deviceId) {
      await playOnDevice(deviceId, [nextTrack]);
    }
  },

  seek: (ms) => {
    const { session, player } = get();
    if (!session) return;
    dbg("spotify", `seek ms=${ms}`);

    gateway.send({
      type: "spotify_playback_control",
      sessionId: session.id,
      action: "seek",
      positionMs: ms,
    });

    player?.seek(ms);
  },

  setVolume: (vol) => {
    const { player } = get();
    set({ volume: vol });
    player?.setVolume(vol);
  },

  handleWSEvent: (event) => {
    switch (event.type) {
      case "spotify_queue_update": {
        const { session } = get();
        dbg("spotify", `WS spotify_queue_update sessionId=${event.sessionId}`, {
          trackName: event.queueItem?.trackName,
          trackUri: event.queueItem?.trackUri,
          matched: session?.id === event.sessionId,
        });
        if (session && session.id === event.sessionId) {
          set((s) => ({ queue: [...s.queue, event.queueItem] }));
        }
        break;
      }
      case "spotify_queue_remove": {
        const { session } = get();
        dbg("spotify", `WS spotify_queue_remove sessionId=${event.sessionId} itemId=${event.itemId}`);
        if (session && session.id === event.sessionId) {
          set((s) => ({ queue: s.queue.filter((item) => item.id !== event.itemId) }));
        }
        break;
      }
      case "spotify_playback_sync": {
        const { session, player } = get();
        dbg("spotify", `WS spotify_playback_sync`, {
          sessionId: event.sessionId,
          action: event.action,
          trackUri: event.trackUri,
          positionMs: event.positionMs,
          hasPlayer: !!player,
          sessionMatch: session?.id === event.sessionId,
        });
        if (!session || session.id !== event.sessionId) break;

        // Sync playback from another session member
        const playTrackOnDevice = async (uri: string) => {
          const deviceId = await get().ensureDeviceId();
          if (!deviceId) {
            dbg("spotify", "playback_sync: no deviceId, cannot play");
            return;
          }
          await playOnDevice(deviceId, [uri]);
        };

        if (event.action === "play" && event.trackUri && player) {
          dbg("spotify", `playback_sync: playing track ${event.trackUri}`);
          playTrackOnDevice(event.trackUri);
        } else if (event.action === "play" && !event.trackUri && player) {
          dbg("spotify", "playback_sync: resuming");
          player.resume();
        } else if (event.action === "pause" && player) {
          dbg("spotify", "playback_sync: pausing");
          player.pause();
        } else if (event.action === "seek" && player && event.positionMs != null) {
          dbg("spotify", `playback_sync: seeking to ${event.positionMs}ms`);
          player.seek(event.positionMs);
        } else if (event.action === "skip" && event.trackUri && player) {
          dbg("spotify", `playback_sync: skipping to ${event.trackUri}`);
          const skipUri = event.trackUri;
          set((s) => ({ queue: s.queue.filter((item) => item.trackUri !== skipUri) }));
          playTrackOnDevice(skipUri);
        } else {
          dbg("spotify", "playback_sync: unhandled combination", { action: event.action, hasTrackUri: !!event.trackUri, hasPlayer: !!player });
        }
        break;
      }
      case "spotify_session_ended": {
        const { session, player } = get();
        dbg("spotify", `WS spotify_session_ended sessionId=${event.sessionId}`, { currentSession: session?.id });
        if (session && session.id === event.sessionId) {
          player?.pause();
          set({ session: null, queue: [], isHost: false });
        }
        break;
      }
    }
  },

  cleanup: () => {
    get().disconnectPlayer();
    if (wsUnsub) {
      wsUnsub();
      wsUnsub = null;
    }
  },
}));
