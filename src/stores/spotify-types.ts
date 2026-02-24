import type { SpotifyAccount, ListeningSession, QueueItem, SpotifyTrack, WSServerEvent } from "../types/shared.js";

// ═══════════════════════════════════════════════════════════════════
// PKCE helpers
// ═══════════════════════════════════════════════════════════════════

export function generateRandomString(length: number): string {
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

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await sha256(verifier);
  return base64urlEncode(hash);
}

// ═══════════════════════════════════════════════════════════════════
// Spotify Web Playback SDK type declarations
// ═══════════════════════════════════════════════════════════════════

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

export interface SpotifyPlayer {
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

export interface SpotifyPlayerState {
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

export interface SpotifyState {
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
  searchSource: "spotify" | "youtube";
  showSearch: boolean;
  searchInput: string;

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
  play: (trackUri?: string, source?: string) => Promise<void>;
  pause: () => void;
  skip: (trackUri?: string) => void;
  seek: (ms: number) => void;
  setVolume: (vol: number) => void;
  handleWSEvent: (event: WSServerEvent) => void;
  cleanup: () => void;
  setShowSearch: (show: boolean) => void;
  setSearchInput: (input: string) => void;
  setSearchSource: (source: "spotify" | "youtube") => void;
}

// ═══════════════════════════════════════════════════════════════════
// HMR persistence helpers
// ═══════════════════════════════════════════════════════════════════

// window properties survive Vite HMR module re-evaluation,
// so we keep the Spotify Player alive instead of recreating it every time.
const W = window as any;

export function getPersistedPlayer(): SpotifyPlayer | null {
  return W.__fluxSpotifyPlayer ?? null;
}

export function getPersistedDeviceId(): string | null {
  return W.__fluxSpotifyDeviceId ?? null;
}

export function persistPlayer(player: SpotifyPlayer | null, deviceId: string | null) {
  W.__fluxSpotifyPlayer = player;
  W.__fluxSpotifyDeviceId = deviceId;
}

// ═══════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════

import { useYouTubeStore } from "./youtube.js";
import * as api from "../lib/api.js";
import { dbg } from "../lib/debug.js";

/** Helper to get YouTube store state (synchronous). */
export function yt() {
  return useYouTubeStore.getState();
}

export { useYouTubeStore, api, dbg };

/** Play a track on a Spotify device, retrying on 404 (device not yet registered). */
export async function playOnDevice(deviceId: string, uris: string[], positionMs?: number): Promise<boolean> {
  dbg("spotify", `playOnDevice deviceId=${deviceId} positionMs=${positionMs ?? 0}`, { uris });
  const bodyObj: Record<string, unknown> = { uris };
  if (positionMs != null && positionMs > 0) {
    bodyObj.position_ms = Math.round(positionMs);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { accessToken } = await api.getSpotifyToken();
      const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
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
