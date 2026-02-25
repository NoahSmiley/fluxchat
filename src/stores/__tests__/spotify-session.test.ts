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
import type { QueueItem, ListeningSession } from "@/types/shared.js";

const mockedApi = vi.mocked(api);
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
});
