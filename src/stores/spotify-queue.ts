import type { StoreApi } from "zustand";
import type { SpotifyState } from "./spotify-types.js";
import type { SpotifyTrack } from "../types/shared.js";
import { dbg } from "./spotify-types.js";
import * as api from "../lib/api.js";

// ═══════════════════════════════════════════════════════════════════
// Queue action creators
// ═══════════════════════════════════════════════════════════════════

export function createAddTrackToQueue(store: StoreApi<SpotifyState>) {
  return async (track: SpotifyTrack) => {
    const { session } = store.getState();
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
  };
}

export function createRemoveFromQueue(store: StoreApi<SpotifyState>) {
  return async (itemId: string) => {
    const { session } = store.getState();
    if (!session) return;
    dbg("spotify", `removeFromQueue itemId=${itemId}`);
    store.setState((s) => ({ queue: s.queue.filter((item) => item.id !== itemId) }));
    await api.removeFromQueue(session.id, itemId);
  };
}
