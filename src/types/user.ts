// User-related types: activity, presence, Spotify, YouTube

export interface ActivityInfo {
  name: string;
  activityType: "playing" | "listening";
  artist?: string;
  albumArt?: string;
  durationMs?: number;
  progressMs?: number;
}

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

// Spotify types
export interface SpotifyAccount {
  linked: boolean;
  displayName?: string;
}

export interface ListeningSession {
  id: string;
  voiceChannelId: string;
  hostUserId: string;
  currentTrackUri?: string;
  currentTrackPositionMs: number;
  isPlaying: number;
  createdAt: string;
  updatedAt: string;
}

export interface QueueItem {
  id: string;
  sessionId: string;
  trackUri: string;
  trackName: string;
  trackArtist: string;
  trackAlbum?: string;
  trackImageUrl?: string;
  trackDurationMs: number;
  addedByUserId: string;
  position: number;
  createdAt: string;
  source: string;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number; height: number }[] };
  duration_ms: number;
}

export interface YouTubeTrack {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationMs: number;
}
