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
import type { QueueItem, ListeningSession } from "@/types/shared.js";

const mockedGateway = vi.mocked(gateway);

// ── Helpers ──

function makeQueueItem(overrides?: Partial<QueueItem>): QueueItem {
  return {
    id: "qi1",
    sessionId: "session1",
    trackUri: "spotify:track:abc123",
    trackName: "Test Track",
    trackArtist: "Test Artist",
    trackAlbum: "Test Album",
    trackImageUrl: "https://example.com/art.jpg",
    trackDurationMs: 210000,
    addedByUserId: "user1",
    position: 0,
    createdAt: "2025-01-01T00:00:00Z",
    source: "spotify",
    ...overrides,
  };
}

function makeSession(overrides?: Partial<ListeningSession>): ListeningSession {
  return {
    id: "session1",
    voiceChannelId: "vc1",
    hostUserId: "my-user-id",
    currentTrackUri: undefined,
    currentTrackPositionMs: 0,
    isPlaying: 0,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
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

  // ── pause action ──

  describe("pause", () => {
    it("does nothing without active session", () => {
      useSpotifyStore.setState({ session: null });

      useSpotifyStore.getState().pause();

      expect(mockedGateway.send).not.toHaveBeenCalled();
    });

    it("sends pause control event via gateway", () => {
      const session = makeSession({ id: "s1" });
      useSpotifyStore.setState({
        session,
        playerState: {
          paused: false,
          position: 45000,
          duration: 200000,
          track_window: { current_track: null },
        },
      });

      useSpotifyStore.getState().pause();

      expect(mockedGateway.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "spotify_playback_control",
          sessionId: "s1",
          action: "pause",
        }),
      );
    });
  });

  // ── seek action ──

  describe("seek", () => {
    it("does nothing without active session", () => {
      useSpotifyStore.setState({ session: null });

      useSpotifyStore.getState().seek(60000);

      expect(mockedGateway.send).not.toHaveBeenCalled();
    });

    it("sends seek control event via gateway", () => {
      const session = makeSession({ id: "s1" });
      useSpotifyStore.setState({ session });

      useSpotifyStore.getState().seek(60000);

      expect(mockedGateway.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "spotify_playback_control",
          sessionId: "s1",
          action: "seek",
          positionMs: 60000,
        }),
      );
    });
  });

  // ── play action (partial — only non-SDK parts) ──

  describe("play", () => {
    it("does nothing without active session", async () => {
      useSpotifyStore.setState({ session: null });

      await useSpotifyStore.getState().play("spotify:track:abc");

      expect(mockedGateway.send).not.toHaveBeenCalled();
    });

    it("sends playback control event when playing a new track", async () => {
      const session = makeSession({ id: "s1" });
      useSpotifyStore.setState({ session, queue: [] });

      await useSpotifyStore.getState().play("spotify:track:abc");

      expect(mockedGateway.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "spotify_playback_control",
          sessionId: "s1",
          action: "play",
          trackUri: "spotify:track:abc",
          positionMs: 0,
        }),
      );
    });

    it("removes played track from queue optimistically", async () => {
      const session = makeSession({ id: "s1" });
      const queueItems = [
        makeQueueItem({ id: "qi1", trackUri: "spotify:track:abc", trackName: "First" }),
        makeQueueItem({ id: "qi2", trackUri: "spotify:track:def", trackName: "Second" }),
      ];
      useSpotifyStore.setState({ session, queue: queueItems });

      await useSpotifyStore.getState().play("spotify:track:abc");

      const remaining = useSpotifyStore.getState().queue;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].trackUri).toBe("spotify:track:def");
    });
  });

  // ── skip action ──

  describe("skip", () => {
    it("does nothing without session", async () => {
      useSpotifyStore.setState({ session: null });

      await useSpotifyStore.getState().skip();

      expect(mockedGateway.send).not.toHaveBeenCalled();
    });

    it("sends pause and clears state when queue is empty and no trackUri", async () => {
      const session = makeSession({ id: "s1" });
      useSpotifyStore.setState({ session, queue: [] });

      await useSpotifyStore.getState().skip();

      expect(mockedGateway.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "spotify_playback_control",
          sessionId: "s1",
          action: "pause",
          positionMs: 0,
        }),
      );
      expect(useSpotifyStore.getState().playerState).toBeNull();
    });

    it("sends skip event for next track in queue", async () => {
      const session = makeSession({ id: "s1" });
      const queueItems = [
        makeQueueItem({ id: "qi1", trackUri: "spotify:track:next", source: "spotify" }),
      ];
      useSpotifyStore.setState({ session, queue: queueItems });

      await useSpotifyStore.getState().skip();

      expect(mockedGateway.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "spotify_playback_control",
          sessionId: "s1",
          action: "skip",
          trackUri: "spotify:track:next",
          source: "spotify",
        }),
      );
    });

    it("removes skipped-to track from queue", async () => {
      const session = makeSession({ id: "s1" });
      const queueItems = [
        makeQueueItem({ id: "qi1", trackUri: "spotify:track:first" }),
        makeQueueItem({ id: "qi2", trackUri: "spotify:track:second" }),
      ];
      useSpotifyStore.setState({ session, queue: queueItems });

      await useSpotifyStore.getState().skip();

      const remaining = useSpotifyStore.getState().queue;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].trackUri).toBe("spotify:track:second");
    });

    it("skips to specific trackUri when provided", async () => {
      const session = makeSession({ id: "s1" });
      const queueItems = [
        makeQueueItem({ id: "qi1", trackUri: "spotify:track:first", source: "spotify" }),
        makeQueueItem({ id: "qi2", trackUri: "spotify:track:second", source: "spotify" }),
      ];
      useSpotifyStore.setState({ session, queue: queueItems });

      await useSpotifyStore.getState().skip("spotify:track:second");

      expect(mockedGateway.send).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "skip",
          trackUri: "spotify:track:second",
        }),
      );
      // Should remove the track we skipped to from queue
      const remaining = useSpotifyStore.getState().queue;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].trackUri).toBe("spotify:track:first");
    });
  });

  // ── cleanup ──

  describe("cleanup", () => {
    it("disconnects player", () => {
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
      useSpotifyStore.setState({ player: mockPlayer as any });

      useSpotifyStore.getState().cleanup();

      expect(mockPlayer.disconnect).toHaveBeenCalled();
      expect(useSpotifyStore.getState().player).toBeNull();
    });
  });
});
