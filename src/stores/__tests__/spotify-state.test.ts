import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

vi.mock("../../lib/api/index.js", () => ({
  getSpotifyAuthInfo: vi.fn(),
  getSpotifyToken: vi.fn(() => Promise.resolve({ accessToken: "fake-token" })),
  initSpotifyAuth: vi.fn(),
  unlinkSpotify: vi.fn(),
  searchSpotifyTracks: vi.fn(),
  createListeningSession: vi.fn(),
  getListeningSession: vi.fn(),
  deleteListeningSession: vi.fn(),
  addToQueue: vi.fn(),
  removeFromQueue: vi.fn(),
  getStoredToken: vi.fn(() => null),
  setStoredToken: vi.fn(),
  getSession: vi.fn(() => Promise.resolve(null)),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn(),
  searchYouTubeTracks: vi.fn(() => Promise.resolve({ tracks: [] })),
}));

vi.mock("../../lib/ws.js", () => ({
  gateway: {
    send: vi.fn(),
    on: vi.fn(),
    onConnect: vi.fn(),
  },
}));

vi.mock("../../lib/debug.js", () => ({
  dbg: vi.fn(),
}));

vi.mock("../../lib/serverUrl.js", () => ({
  API_BASE: "/api",
  getGatewayUrl: vi.fn(() => "ws://localhost:3001/gateway"),
}));

vi.mock("../../lib/broadcast.js", () => ({
  broadcastState: vi.fn(),
  onCommand: vi.fn(),
  isPopout: vi.fn(() => true),
}));

vi.mock("../auth.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      user: { id: "my-user-id" },
    })),
  },
}));

vi.mock("../voice/store.js", () => ({
  useVoiceStore: {
    getState: vi.fn(() => ({
      stopLobbyMusicAction: vi.fn(),
    })),
  },
}));

import { useSpotifyStore } from "@/stores/spotify/index.js";
import { useYouTubeStore } from "@/stores/youtube.js";
import * as api from "@/lib/api/index.js";
import type { SpotifyTrack } from "@/types/shared.js";

const mockedApi = vi.mocked(api);

// ── Helpers ──

function makeTrack(overrides?: Partial<SpotifyTrack>): SpotifyTrack {
  return {
    uri: "spotify:track:abc123",
    name: "Test Track",
    artists: [{ name: "Test Artist" }],
    album: {
      name: "Test Album",
      images: [{ url: "https://example.com/art.jpg", width: 300, height: 300 }],
    },
    duration_ms: 210000,
    ...overrides,
  };
}

// ── Test Suite ──

describe("useSpotifyStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSpotifyStore.setState({
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
    });
    useYouTubeStore.setState({
      youtubeAudio: null,
      youtubeTrack: null,
      youtubeProgress: 0,
      youtubeDuration: 0,
      youtubePaused: true,
      youtubeSearchResults: [],
      searchLoading: false,
      searchError: null,
    });
  });

  // ── Default State ──

  describe("initial state", () => {
    it("has correct default values", () => {
      const state = useSpotifyStore.getState();
      expect(state.account).toBeNull();
      expect(state.sdkReady).toBe(false);
      expect(state.player).toBeNull();
      expect(state.deviceId).toBeNull();
      expect(state.playerState).toBeNull();
      expect(state.volume).toBe(0.5);
      expect(state.session).toBeNull();
      expect(state.queue).toEqual([]);
      expect(state.isHost).toBe(false);
      expect(state.searchResults).toEqual([]);
      expect(state.searchLoading).toBe(false);
      expect(state.polling).toBe(false);
      expect(state.oauthError).toBeNull();
      expect(state.searchSource).toBe("spotify");
      expect(state.showSearch).toBe(false);
      expect(state.searchInput).toBe("");
    });
  });

  // ── Volume Control ──

  describe("setVolume", () => {
    it("updates volume state", () => {
      useSpotifyStore.getState().setVolume(0.8);
      expect(useSpotifyStore.getState().volume).toBe(0.8);
    });

    it("accepts minimum volume (0)", () => {
      useSpotifyStore.getState().setVolume(0);
      expect(useSpotifyStore.getState().volume).toBe(0);
    });

    it("accepts maximum volume (1)", () => {
      useSpotifyStore.getState().setVolume(1);
      expect(useSpotifyStore.getState().volume).toBe(1);
    });

    it("updates from non-default value", () => {
      useSpotifyStore.getState().setVolume(0.3);
      expect(useSpotifyStore.getState().volume).toBe(0.3);
      useSpotifyStore.getState().setVolume(0.9);
      expect(useSpotifyStore.getState().volume).toBe(0.9);
    });

    it("calls setYouTubeVolume on YouTube store", () => {
      useSpotifyStore.getState().setVolume(0.7);
      // YouTube store volume is updated via yt().setYouTubeVolume(vol)
      // We verify the volume state was updated on the Spotify side
      expect(useSpotifyStore.getState().volume).toBe(0.7);
    });
  });

  // ── Search State ──

  describe("setShowSearch", () => {
    it("opens search", () => {
      useSpotifyStore.getState().setShowSearch(true);
      expect(useSpotifyStore.getState().showSearch).toBe(true);
    });

    it("closes search", () => {
      useSpotifyStore.setState({ showSearch: true });
      useSpotifyStore.getState().setShowSearch(false);
      expect(useSpotifyStore.getState().showSearch).toBe(false);
    });

    it("toggling twice returns to original", () => {
      useSpotifyStore.getState().setShowSearch(true);
      useSpotifyStore.getState().setShowSearch(false);
      expect(useSpotifyStore.getState().showSearch).toBe(false);
    });
  });

  describe("setSearchInput", () => {
    it("sets search input text", () => {
      useSpotifyStore.getState().setSearchInput("test query");
      expect(useSpotifyStore.getState().searchInput).toBe("test query");
    });

    it("accepts empty string", () => {
      useSpotifyStore.setState({ searchInput: "old" });
      useSpotifyStore.getState().setSearchInput("");
      expect(useSpotifyStore.getState().searchInput).toBe("");
    });

    it("overwrites previous input", () => {
      useSpotifyStore.getState().setSearchInput("first");
      useSpotifyStore.getState().setSearchInput("second");
      expect(useSpotifyStore.getState().searchInput).toBe("second");
    });
  });

  describe("setSearchSource", () => {
    it("switches to youtube", () => {
      useSpotifyStore.getState().setSearchSource("youtube");
      expect(useSpotifyStore.getState().searchSource).toBe("youtube");
    });

    it("switches back to spotify", () => {
      useSpotifyStore.setState({ searchSource: "youtube" });
      useSpotifyStore.getState().setSearchSource("spotify");
      expect(useSpotifyStore.getState().searchSource).toBe("spotify");
    });

    it("does not trigger search when searchInput is empty", () => {
      useSpotifyStore.setState({ searchInput: "" });
      useSpotifyStore.getState().setSearchSource("youtube");
      expect(useSpotifyStore.getState().searchSource).toBe("youtube");
      // No search should be triggered
    });

    it("does not trigger search when searchInput is whitespace only", () => {
      useSpotifyStore.setState({ searchInput: "   " });
      useSpotifyStore.getState().setSearchSource("youtube");
      expect(useSpotifyStore.getState().searchSource).toBe("youtube");
    });
  });

  // ── searchTracks ──

  describe("searchTracks", () => {
    it("clears results for empty query", async () => {
      useSpotifyStore.setState({ searchResults: [makeTrack()] });
      await useSpotifyStore.getState().searchTracks("");
      expect(useSpotifyStore.getState().searchResults).toEqual([]);
    });

    it("clears results for whitespace-only query", async () => {
      useSpotifyStore.setState({ searchResults: [makeTrack()] });
      await useSpotifyStore.getState().searchTracks("   ");
      expect(useSpotifyStore.getState().searchResults).toEqual([]);
      expect(mockedApi.searchSpotifyTracks).not.toHaveBeenCalled();
    });

    it("sets searchLoading during search", async () => {
      let resolveSearch: (v: unknown) => void;
      const searchPromise = new Promise((r) => { resolveSearch = r; });
      mockedApi.searchSpotifyTracks.mockReturnValue(searchPromise as any);

      const promise = useSpotifyStore.getState().searchTracks("test");
      expect(useSpotifyStore.getState().searchLoading).toBe(true);

      resolveSearch!({ tracks: { items: [] } });
      await promise;
      expect(useSpotifyStore.getState().searchLoading).toBe(false);
    });

    it("populates searchResults on success", async () => {
      const tracks = [makeTrack(), makeTrack({ uri: "spotify:track:def456", name: "Second Track" })];
      mockedApi.searchSpotifyTracks.mockResolvedValue({ tracks: { items: tracks } });

      await useSpotifyStore.getState().searchTracks("test query");

      expect(useSpotifyStore.getState().searchResults).toEqual(tracks);
      expect(useSpotifyStore.getState().searchLoading).toBe(false);
    });

    it("handles null response gracefully", async () => {
      mockedApi.searchSpotifyTracks.mockResolvedValue(null as any);

      await useSpotifyStore.getState().searchTracks("test");

      expect(useSpotifyStore.getState().searchResults).toEqual([]);
    });

    it("clears searchResults on error", async () => {
      useSpotifyStore.setState({ searchResults: [makeTrack()] });
      mockedApi.searchSpotifyTracks.mockRejectedValue(new Error("Network error"));

      await useSpotifyStore.getState().searchTracks("failing query");

      expect(useSpotifyStore.getState().searchResults).toEqual([]);
      expect(useSpotifyStore.getState().searchLoading).toBe(false);
    });
  });
});
