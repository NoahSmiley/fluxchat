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
import type { QueueItem, SpotifyTrack, ListeningSession } from "@/types/shared.js";

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
      searchInput: "",
    });
    useYouTubeStore.setState({
      youtubeTrack: null,
      youtubeProgress: 0,
      youtubeDuration: 0,
      youtubePaused: true,
      youtubeSearchResults: [],
      searchLoading: false,
      searchError: null,
    });
  });

  // ── Queue Management ──

  describe("queue management", () => {
    describe("addTrackToQueue", () => {
      it("does nothing without active session", async () => {
        useSpotifyStore.setState({ session: null });

        await useSpotifyStore.getState().addTrackToQueue(makeTrack());

        expect(mockedApi.addToQueue).not.toHaveBeenCalled();
      });

      it("calls API with correct payload when session is active", async () => {
        const session = makeSession();
        useSpotifyStore.setState({ session });
        const track = makeTrack();

        await useSpotifyStore.getState().addTrackToQueue(track);

        expect(mockedApi.addToQueue).toHaveBeenCalledWith(session.id, {
          trackUri: track.uri,
          trackName: track.name,
          trackArtist: "Test Artist",
          trackAlbum: track.album.name,
          trackImageUrl: track.album.images[0].url,
          trackDurationMs: track.duration_ms,
        });
      });

      it("joins multiple artist names", async () => {
        const session = makeSession();
        useSpotifyStore.setState({ session });
        const track = makeTrack({
          artists: [{ name: "Artist A" }, { name: "Artist B" }, { name: "Artist C" }],
        });

        await useSpotifyStore.getState().addTrackToQueue(track);

        expect(mockedApi.addToQueue).toHaveBeenCalledWith(
          session.id,
          expect.objectContaining({
            trackArtist: "Artist A, Artist B, Artist C",
          }),
        );
      });
    });

    describe("removeFromQueue", () => {
      it("does nothing without active session", async () => {
        useSpotifyStore.setState({ session: null });

        await useSpotifyStore.getState().removeFromQueue("qi1");

        expect(mockedApi.removeFromQueue).not.toHaveBeenCalled();
      });

      it("optimistically removes item from queue", async () => {
        const session = makeSession();
        const items = [
          makeQueueItem({ id: "qi1", trackName: "Track 1" }),
          makeQueueItem({ id: "qi2", trackName: "Track 2" }),
          makeQueueItem({ id: "qi3", trackName: "Track 3" }),
        ];
        useSpotifyStore.setState({ session, queue: items });

        await useSpotifyStore.getState().removeFromQueue("qi2");

        const remaining = useSpotifyStore.getState().queue;
        expect(remaining).toHaveLength(2);
        expect(remaining.map((q) => q.id)).toEqual(["qi1", "qi3"]);
      });

      it("calls API removeFromQueue", async () => {
        const session = makeSession();
        useSpotifyStore.setState({
          session,
          queue: [makeQueueItem({ id: "qi1" })],
        });

        await useSpotifyStore.getState().removeFromQueue("qi1");

        expect(mockedApi.removeFromQueue).toHaveBeenCalledWith("session1", "qi1");
      });

      it("handles removing non-existent item gracefully", async () => {
        const session = makeSession();
        const items = [makeQueueItem({ id: "qi1" })];
        useSpotifyStore.setState({ session, queue: items });

        await useSpotifyStore.getState().removeFromQueue("nonexistent");

        // Original item should still be there
        expect(useSpotifyStore.getState().queue).toHaveLength(1);
      });
    });

    describe("queue state via setState", () => {
      it("can set queue directly", () => {
        const items = [
          makeQueueItem({ id: "qi1", position: 0 }),
          makeQueueItem({ id: "qi2", position: 1 }),
        ];
        useSpotifyStore.setState({ queue: items });
        expect(useSpotifyStore.getState().queue).toHaveLength(2);
        expect(useSpotifyStore.getState().queue[0].id).toBe("qi1");
        expect(useSpotifyStore.getState().queue[1].id).toBe("qi2");
      });

      it("clearing queue sets empty array", () => {
        useSpotifyStore.setState({ queue: [makeQueueItem()] });
        useSpotifyStore.setState({ queue: [] });
        expect(useSpotifyStore.getState().queue).toEqual([]);
      });
    });
  });
});
