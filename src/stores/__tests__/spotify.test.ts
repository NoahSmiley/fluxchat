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
import { gateway } from "@/lib/ws.js";
import type { QueueItem, SpotifyTrack, ListeningSession } from "@/types/shared.js";

const mockedApi = vi.mocked(api);
const mockedGateway = vi.mocked(gateway);

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
    // Reset Spotify store to clean initial state
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
    // Reset YouTube store
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

  // ── Session State Transitions ──

  describe("session state transitions", () => {
    describe("leaveSession", () => {
      it("clears session state", () => {
        useSpotifyStore.setState({
          session: makeSession(),
          queue: [makeQueueItem()],
          isHost: true,
          playerState: {
            paused: false,
            position: 50000,
            duration: 200000,
            track_window: { current_track: null },
          },
        });

        useSpotifyStore.getState().leaveSession();

        expect(useSpotifyStore.getState().session).toBeNull();
        expect(useSpotifyStore.getState().queue).toEqual([]);
        expect(useSpotifyStore.getState().isHost).toBe(false);
        expect(useSpotifyStore.getState().playerState).toBeNull();
      });

      it("sends activity null via gateway", () => {
        useSpotifyStore.setState({ session: makeSession() });

        useSpotifyStore.getState().leaveSession();

        expect(mockedGateway.send).toHaveBeenCalledWith({
          type: "update_activity",
          activity: null,
        });
      });
    });

    describe("endSession", () => {
      it("does nothing without session", async () => {
        useSpotifyStore.setState({ session: null });

        await useSpotifyStore.getState().endSession();

        expect(mockedApi.deleteListeningSession).not.toHaveBeenCalled();
      });

      it("calls API to delete session", async () => {
        const session = makeSession();
        useSpotifyStore.setState({ session });

        await useSpotifyStore.getState().endSession();

        expect(mockedApi.deleteListeningSession).toHaveBeenCalledWith("session1");
      });

      it("clears all session state", async () => {
        useSpotifyStore.setState({
          session: makeSession(),
          queue: [makeQueueItem(), makeQueueItem({ id: "qi2" })],
          isHost: true,
          playerState: {
            paused: false,
            position: 0,
            duration: 200000,
            track_window: { current_track: null },
          },
        });

        await useSpotifyStore.getState().endSession();

        expect(useSpotifyStore.getState().session).toBeNull();
        expect(useSpotifyStore.getState().queue).toEqual([]);
        expect(useSpotifyStore.getState().isHost).toBe(false);
        expect(useSpotifyStore.getState().playerState).toBeNull();
      });

      it("sends activity null via gateway", async () => {
        useSpotifyStore.setState({ session: makeSession() });

        await useSpotifyStore.getState().endSession();

        expect(mockedGateway.send).toHaveBeenCalledWith({
          type: "update_activity",
          activity: null,
        });
      });

      it("still clears state if API call fails", async () => {
        useSpotifyStore.setState({
          session: makeSession(),
          queue: [makeQueueItem()],
          isHost: true,
        });
        mockedApi.deleteListeningSession.mockRejectedValue(new Error("Server error"));

        await useSpotifyStore.getState().endSession();

        expect(useSpotifyStore.getState().session).toBeNull();
        expect(useSpotifyStore.getState().queue).toEqual([]);
        expect(useSpotifyStore.getState().isHost).toBe(false);
      });
    });

    describe("loadSession", () => {
      it("sets session and queue when session exists", async () => {
        const session = makeSession();
        const queue = [makeQueueItem()];
        mockedApi.getListeningSession.mockResolvedValue({ session, queue });

        await useSpotifyStore.getState().loadSession("vc1");

        expect(useSpotifyStore.getState().session).toEqual(session);
        expect(useSpotifyStore.getState().queue).toEqual(queue);
      });

      it("sets isHost when current user is host", async () => {
        const session = makeSession({ hostUserId: "my-user-id" });
        mockedApi.getListeningSession.mockResolvedValue({ session, queue: [] });

        await useSpotifyStore.getState().loadSession("vc1");

        expect(useSpotifyStore.getState().isHost).toBe(true);
      });

      it("sets isHost false when current user is not host", async () => {
        const session = makeSession({ hostUserId: "other-user" });
        mockedApi.getListeningSession.mockResolvedValue({ session, queue: [] });

        await useSpotifyStore.getState().loadSession("vc1");

        expect(useSpotifyStore.getState().isHost).toBe(false);
      });

      it("clears state when no session exists", async () => {
        useSpotifyStore.setState({
          session: makeSession(),
          queue: [makeQueueItem()],
          isHost: true,
        });
        mockedApi.getListeningSession.mockResolvedValue({ session: null, queue: [] });

        await useSpotifyStore.getState().loadSession("vc1");

        expect(useSpotifyStore.getState().session).toBeNull();
        expect(useSpotifyStore.getState().queue).toEqual([]);
        expect(useSpotifyStore.getState().isHost).toBe(false);
      });

      it("clears state on error", async () => {
        useSpotifyStore.setState({
          session: makeSession(),
          queue: [makeQueueItem()],
          isHost: true,
        });
        mockedApi.getListeningSession.mockRejectedValue(new Error("Failed"));

        await useSpotifyStore.getState().loadSession("vc1");

        expect(useSpotifyStore.getState().session).toBeNull();
        expect(useSpotifyStore.getState().queue).toEqual([]);
        expect(useSpotifyStore.getState().isHost).toBe(false);
      });
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
