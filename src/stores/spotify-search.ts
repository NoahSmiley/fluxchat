import type { StoreApi } from "zustand";
import type { SpotifyState } from "./spotify-types.js";
import type { SpotifyTrack } from "../types/shared.js";
import { yt } from "./spotify-types.js";
import * as api from "../lib/api.js";

// ═══════════════════════════════════════════════════════════════════
// Search action creators
// ═══════════════════════════════════════════════════════════════════

export function createSearchTracks(store: StoreApi<SpotifyState>) {
  return async (query: string) => {
    if (!query.trim()) {
      store.setState({ searchResults: [] });
      return;
    }

    store.setState({ searchLoading: true });
    try {
      const data = await api.searchSpotifyTracks(query);
      const tracks: SpotifyTrack[] = data?.tracks?.items ?? [];
      store.setState({ searchResults: tracks });
    } catch {
      store.setState({ searchResults: [] });
    } finally {
      store.setState({ searchLoading: false });
    }
  };
}

export function createSetShowSearch(store: StoreApi<SpotifyState>) {
  return (show: boolean) => store.setState({ showSearch: show });
}

export function createSetSearchInput(store: StoreApi<SpotifyState>) {
  return (input: string) => store.setState({ searchInput: input });
}

export function createSetSearchSource(store: StoreApi<SpotifyState>) {
  return (source: "spotify" | "youtube") => {
    store.setState({ searchSource: source });
    const { searchInput } = store.getState();
    if (!searchInput.trim()) return;
    if (source === "youtube" && yt().youtubeSearchResults.length === 0) {
      yt().searchYouTube(searchInput.trim());
    } else if (source === "spotify" && store.getState().searchResults.length === 0) {
      store.getState().searchTracks(searchInput.trim());
    }
  };
}
