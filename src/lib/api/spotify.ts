import type {
  SpotifyAccount,
  SpotifyTrack,
  ListeningSession,
  QueueItem,
} from "@/types/shared.js";

import { API_BASE, request, getStoredToken } from "./base.js";

interface SpotifySearchResponse {
  tracks: {
    items: SpotifyTrack[];
  };
}

// ── Spotify ──

export async function getSpotifyAuthInfo() {
  return request<SpotifyAccount>("/spotify/auth-info");
}

export async function initSpotifyAuth(codeVerifier: string) {
  return request<{ state: string; redirectUri: string }>("/spotify/init-auth", {
    method: "POST",
    body: JSON.stringify({ codeVerifier }),
  });
}

export async function getSpotifyToken() {
  return request<{ accessToken: string }>("/spotify/token");
}

export async function unlinkSpotify() {
  return request<{ success: boolean }>("/spotify/unlink", { method: "POST" });
}

export async function searchSpotifyTracks(q: string) {
  return request<SpotifySearchResponse>(`/spotify/search?q=${encodeURIComponent(q)}`);
}

export async function createListeningSession(voiceChannelId: string) {
  return request<{ sessionId: string; existing?: boolean }>("/spotify/sessions", {
    method: "POST",
    body: JSON.stringify({ voiceChannelId }),
  });
}

export async function getListeningSession(voiceChannelId: string) {
  return request<{ session: ListeningSession | null; queue: QueueItem[] }>(
    `/spotify/sessions/channel/${voiceChannelId}`
  );
}

export async function addToQueue(sessionId: string, track: {
  trackUri: string; trackName: string; trackArtist: string;
  trackAlbum?: string; trackImageUrl?: string; trackDurationMs: number;
  source?: string;
}) {
  return request<{ id: string }>(`/spotify/sessions/${sessionId}/queue`, {
    method: "POST",
    body: JSON.stringify(track),
  });
}

export async function removeFromQueue(sessionId: string, itemId: string) {
  return request<{ success: boolean }>(`/spotify/sessions/${sessionId}/queue/${itemId}`, {
    method: "DELETE",
  });
}

export async function deleteListeningSession(sessionId: string) {
  return request<{ success: boolean }>(`/spotify/sessions/${sessionId}/end`, {
    method: "DELETE",
  });
}

// ── YouTube ──

export async function searchYouTubeTracks(q: string) {
  return request<{ tracks: import("@/types/shared.js").YouTubeTrack[] }>(`/youtube/search?q=${encodeURIComponent(q)}`);
}

export function getYouTubeAudioUrl(videoId: string): string {
  const token = getStoredToken();
  return `${API_BASE}/youtube/audio/${videoId}${token ? `?token=${token}` : ""}`;
}
