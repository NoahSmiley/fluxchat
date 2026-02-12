import { create } from "zustand";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { API_BASE } from "../lib/serverUrl.js";
import type { SpotifyAccount, ListeningSession, QueueItem, SpotifyTrack, WSServerEvent } from "../types/shared.js";

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
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { accessToken } = await api.getSpotifyToken();
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uris }),
      });
      if (res.ok) return true;
      if (res.status === 404 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.error("[spotify] playOnDevice failed:", res.status);
      return false;
    } catch (e) {
      console.error("[spotify] playOnDevice error:", e);
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
    try {
      const info = await api.getSpotifyAuthInfo();
      set({ account: info });
      if (info.linked) {
        get().initializeSDK();
      }
    } catch {
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

      // Send code_verifier to backend; backend returns the redirect URI
      const { state, redirectUri } = await api.initSpotifyAuth(codeVerifier);

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
    if (get().sdkReady && get().player && get().deviceId) return;

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
      console.log("[spotify] player ready, deviceId:", device_id);
      set({ deviceId: device_id });
      persistPlayer(player, device_id);
    });

    player.addListener("not_ready", () => {
      console.warn("[spotify] player not_ready");
      set({ deviceId: null });
      persistPlayer(player, null);
      setTimeout(() => player.connect(), 1000);
    });

    player.addListener("player_state_changed", (state: SpotifyPlayerState | null) => {
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
    if (deviceId) return deviceId;

    // Try reconnecting the existing player
    const { player } = get();
    if (player) {
      console.log("[spotify] ensureDeviceId: reconnecting existing player...");
      player.connect();
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 500));
        deviceId = get().deviceId;
        if (deviceId) return deviceId;
      }
    }

    console.warn("[spotify] ensureDeviceId: could not get deviceId");
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
    // Clear old playback state before starting fresh
    const { player } = get();
    player?.pause();
    set({ playerState: null, queue: [], searchResults: [] });
    await api.createListeningSession(voiceChannelId);
    await get().loadSession(voiceChannelId);
  },

  loadSession: async (voiceChannelId) => {
    try {
      const data = await api.getListeningSession(voiceChannelId);
      if (data.session) {
        // Check if current user is host
        const { useAuthStore } = await import("./auth.js");
        const userId = useAuthStore.getState().user?.id;
        set({
          session: data.session,
          queue: data.queue,
          isHost: data.session.hostUserId === userId,
        });
      } else {
        set({ session: null, queue: [], isHost: false });
      }
    } catch {
      set({ session: null, queue: [], isHost: false });
    }
  },

  leaveSession: () => {
    const { player } = get();
    player?.pause();
    set({ session: null, queue: [], isHost: false });
  },

  endSession: async () => {
    const { session, player } = get();
    if (!session) return;
    player?.pause();
    try {
      await api.deleteListeningSession(session.id);
    } catch (e) {
      console.error("Failed to end session:", e);
    }
    set({ session: null, queue: [], isHost: false });
  },

  addTrackToQueue: async (track) => {
    const { session } = get();
    if (!session) return;

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
    set((s) => ({ queue: s.queue.filter((item) => item.id !== itemId) }));
    await api.removeFromQueue(session.id, itemId);
  },

  play: async (trackUri) => {
    const { session, player } = get();
    if (!session) return;

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
        if (session && session.id === event.sessionId) {
          set((s) => ({ queue: [...s.queue, event.queueItem] }));
        }
        break;
      }
      case "spotify_queue_remove": {
        const { session } = get();
        if (session && session.id === event.sessionId) {
          set((s) => ({ queue: s.queue.filter((item) => item.id !== event.itemId) }));
        }
        break;
      }
      case "spotify_playback_sync": {
        const { session, player } = get();
        if (!session || session.id !== event.sessionId) break;

        // Sync playback from another session member
        const playTrackOnDevice = async (uri: string) => {
          const deviceId = await get().ensureDeviceId();
          if (!deviceId) return;
          await playOnDevice(deviceId, [uri]);
        };

        if (event.action === "play" && event.trackUri && player) {
          playTrackOnDevice(event.trackUri);
        } else if (event.action === "play" && !event.trackUri && player) {
          player.resume();
        } else if (event.action === "pause" && player) {
          player.pause();
        } else if (event.action === "seek" && player && event.positionMs != null) {
          player.seek(event.positionMs);
        } else if (event.action === "skip" && event.trackUri && player) {
          const skipUri = event.trackUri;
          set((s) => ({ queue: s.queue.filter((item) => item.trackUri !== skipUri) }));
          playTrackOnDevice(skipUri);
        }
        break;
      }
      case "spotify_session_ended": {
        const { session, player } = get();
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
