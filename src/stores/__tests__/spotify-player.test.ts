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
import { gateway } from "@/lib/ws.js";

const mockedGateway = vi.mocked(gateway);

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

  // ── disconnectPlayer ──

  describe("disconnectPlayer", () => {
    it("clears player-related state", () => {
      const mockPlayer = {
        disconnect: vi.fn(),
        connect: vi.fn(() => Promise.resolve(true)),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        getCurrentState: vi.fn(),
        setName: vi.fn(),
        getVolume: vi.fn(),
        setVolume: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        togglePlay: vi.fn(),
        seek: vi.fn(),
        previousTrack: vi.fn(),
        nextTrack: vi.fn(),
      };
      useSpotifyStore.setState({
        player: mockPlayer as any,
        deviceId: "device-123",
        playerState: {
          paused: false,
          position: 0,
          duration: 200000,
          track_window: { current_track: null },
        },
        sdkReady: true,
      });

      useSpotifyStore.getState().disconnectPlayer();

      expect(mockPlayer.disconnect).toHaveBeenCalled();
      expect(useSpotifyStore.getState().player).toBeNull();
      expect(useSpotifyStore.getState().deviceId).toBeNull();
      expect(useSpotifyStore.getState().playerState).toBeNull();
      expect(useSpotifyStore.getState().sdkReady).toBe(false);
    });

    it("does nothing when no player exists", () => {
      useSpotifyStore.setState({ player: null });

      // Should not throw
      useSpotifyStore.getState().disconnectPlayer();

      expect(useSpotifyStore.getState().player).toBeNull();
    });
  });

  // ── updateActivity ──

  describe("updateActivity", () => {
    it("sends null activity when no playerState", () => {
      useSpotifyStore.setState({ playerState: null });
      // Ensure no YouTube track active
      useYouTubeStore.setState({ youtubeTrack: null, youtubePaused: true });

      useSpotifyStore.getState().updateActivity();

      expect(mockedGateway.send).toHaveBeenCalledWith({
        type: "update_activity",
        activity: null,
      });
    });

    it("sends null activity when playerState is paused", () => {
      useSpotifyStore.setState({
        playerState: {
          paused: true,
          position: 50000,
          duration: 200000,
          track_window: {
            current_track: {
              uri: "spotify:track:abc",
              name: "Track",
              artists: [{ name: "Artist" }],
              album: { name: "Album", images: [{ url: "art.jpg" }] },
              duration_ms: 200000,
            },
          },
        },
      });
      useYouTubeStore.setState({ youtubeTrack: null, youtubePaused: true });

      useSpotifyStore.getState().updateActivity();

      expect(mockedGateway.send).toHaveBeenCalledWith({
        type: "update_activity",
        activity: null,
      });
    });

    it("sends activity with track info when playing", () => {
      useSpotifyStore.setState({
        playerState: {
          paused: false,
          position: 50000,
          duration: 200000,
          track_window: {
            current_track: {
              uri: "spotify:track:abc",
              name: "Great Song",
              artists: [{ name: "Artist A" }, { name: "Artist B" }],
              album: {
                name: "Great Album",
                images: [{ url: "https://example.com/art.jpg" }],
              },
              duration_ms: 200000,
            },
          },
        },
      });
      useYouTubeStore.setState({ youtubeTrack: null, youtubePaused: true });

      useSpotifyStore.getState().updateActivity();

      expect(mockedGateway.send).toHaveBeenCalledWith({
        type: "update_activity",
        activity: {
          name: "Great Song",
          activityType: "listening",
          artist: "Artist A, Artist B",
          albumArt: "https://example.com/art.jpg",
          durationMs: 200000,
          progressMs: 50000,
        },
      });
    });

    it("sends null activity when no current track in track_window", () => {
      useSpotifyStore.setState({
        playerState: {
          paused: false,
          position: 0,
          duration: 0,
          track_window: { current_track: null },
        },
      });
      useYouTubeStore.setState({ youtubeTrack: null, youtubePaused: true });

      useSpotifyStore.getState().updateActivity();

      expect(mockedGateway.send).toHaveBeenCalledWith({
        type: "update_activity",
        activity: null,
      });
    });
  });
});
