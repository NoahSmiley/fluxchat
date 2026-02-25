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

  // ── WebSocket Event Handling ──

  describe("handleWSEvent", () => {
    describe("spotify_queue_update", () => {
      it("appends queue item when session matches", () => {
        const session = makeSession({ id: "s1" });
        useSpotifyStore.setState({ session });
        const newItem = makeQueueItem({ id: "qi-new", sessionId: "s1" });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_queue_update",
          sessionId: "s1",
          voiceChannelId: "vc1",
          queueItem: newItem,
        } as any);

        expect(useSpotifyStore.getState().queue).toHaveLength(1);
        expect(useSpotifyStore.getState().queue[0]).toEqual(newItem);
      });

      it("appends to existing queue", () => {
        const session = makeSession({ id: "s1" });
        const existingItem = makeQueueItem({ id: "qi1", sessionId: "s1" });
        useSpotifyStore.setState({ session, queue: [existingItem] });
        const newItem = makeQueueItem({ id: "qi2", sessionId: "s1", trackName: "Second" });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_queue_update",
          sessionId: "s1",
          voiceChannelId: "vc1",
          queueItem: newItem,
        } as any);

        expect(useSpotifyStore.getState().queue).toHaveLength(2);
        expect(useSpotifyStore.getState().queue[1].id).toBe("qi2");
      });

      it("ignores event for different session", () => {
        const session = makeSession({ id: "s1" });
        useSpotifyStore.setState({ session, queue: [] });
        const newItem = makeQueueItem({ id: "qi1", sessionId: "s2" });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_queue_update",
          sessionId: "s2",
          voiceChannelId: "vc1",
          queueItem: newItem,
        } as any);

        expect(useSpotifyStore.getState().queue).toEqual([]);
      });

      it("ignores event when no session is active", () => {
        useSpotifyStore.setState({ session: null, queue: [] });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_queue_update",
          sessionId: "s1",
          voiceChannelId: "vc1",
          queueItem: makeQueueItem(),
        } as any);

        expect(useSpotifyStore.getState().queue).toEqual([]);
      });
    });

    describe("spotify_queue_remove", () => {
      it("removes item from queue when session matches", () => {
        const session = makeSession({ id: "s1" });
        const items = [
          makeQueueItem({ id: "qi1", sessionId: "s1" }),
          makeQueueItem({ id: "qi2", sessionId: "s1" }),
        ];
        useSpotifyStore.setState({ session, queue: items });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_queue_remove",
          sessionId: "s1",
          itemId: "qi1",
        } as any);

        expect(useSpotifyStore.getState().queue).toHaveLength(1);
        expect(useSpotifyStore.getState().queue[0].id).toBe("qi2");
      });

      it("ignores event for different session", () => {
        const session = makeSession({ id: "s1" });
        const items = [makeQueueItem({ id: "qi1", sessionId: "s1" })];
        useSpotifyStore.setState({ session, queue: items });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_queue_remove",
          sessionId: "s2",
          itemId: "qi1",
        } as any);

        expect(useSpotifyStore.getState().queue).toHaveLength(1);
      });

      it("handles removing non-existent item", () => {
        const session = makeSession({ id: "s1" });
        const items = [makeQueueItem({ id: "qi1", sessionId: "s1" })];
        useSpotifyStore.setState({ session, queue: items });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_queue_remove",
          sessionId: "s1",
          itemId: "nonexistent",
        } as any);

        expect(useSpotifyStore.getState().queue).toHaveLength(1);
      });
    });

    describe("spotify_session_ended", () => {
      it("clears session state when session matches", () => {
        const session = makeSession({ id: "s1" });
        useSpotifyStore.setState({
          session,
          queue: [makeQueueItem()],
          isHost: true,
        });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_session_ended",
          sessionId: "s1",
        } as any);

        expect(useSpotifyStore.getState().session).toBeNull();
        expect(useSpotifyStore.getState().queue).toEqual([]);
        expect(useSpotifyStore.getState().isHost).toBe(false);
        expect(useSpotifyStore.getState().playerState).toBeNull();
      });

      it("sends activity null via gateway", () => {
        const session = makeSession({ id: "s1" });
        useSpotifyStore.setState({ session });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_session_ended",
          sessionId: "s1",
        } as any);

        expect(mockedGateway.send).toHaveBeenCalledWith({
          type: "update_activity",
          activity: null,
        });
      });

      it("ignores event for different session", () => {
        const session = makeSession({ id: "s1" });
        useSpotifyStore.setState({
          session,
          queue: [makeQueueItem()],
          isHost: true,
        });

        useSpotifyStore.getState().handleWSEvent({
          type: "spotify_session_ended",
          sessionId: "s2",
        } as any);

        // State should remain unchanged
        expect(useSpotifyStore.getState().session).toEqual(session);
        expect(useSpotifyStore.getState().queue).toHaveLength(1);
        expect(useSpotifyStore.getState().isHost).toBe(true);
      });
    });
  });
});
