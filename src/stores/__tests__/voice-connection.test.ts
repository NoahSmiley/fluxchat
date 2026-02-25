import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted runs before vi.mock factories — use it for shared mock references
const { mockGatewayOn, mockGatewayOnConnect, mockGatewaySend } = vi.hoisted(() => ({
  mockGatewayOn: vi.fn(),
  mockGatewayOnConnect: vi.fn(),
  mockGatewaySend: vi.fn(),
}));

// ── Mocks ──

vi.mock("../../lib/api/index.js", () => ({
  getVoiceToken: vi.fn(() => Promise.resolve({ token: "fake-token", url: "ws://localhost:7880" })),
  getStoredToken: vi.fn(() => null),
  setStoredToken: vi.fn(),
  getSession: vi.fn(() => Promise.resolve(null)),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock("../../lib/ws.js", () => ({
  gateway: {
    send: mockGatewaySend,
    on: mockGatewayOn,
    onConnect: mockGatewayOnConnect,
  },
}));

vi.mock("../../lib/broadcast.js", () => ({
  broadcastState: vi.fn(),
  onCommand: vi.fn(),
  isPopout: vi.fn(() => true),
}));

vi.mock("../../lib/debug.js", () => ({
  dbg: vi.fn(),
}));

vi.mock("../../lib/crypto.js", () => ({
  exportKeyAsBase64: vi.fn(),
}));

vi.mock("../../lib/webrtcStats.js", () => ({
  collectWebRTCStats: vi.fn(() => Promise.resolve({
    audioBitrate: 128, audioCodec: "opus", audioPacketLoss: 0.5,
    audioJitter: 0.01, rtt: 25, videoBitrate: 0, videoCodec: "",
    videoWidth: 0, videoHeight: 0, videoFramerate: 0, connectionType: "host",
  })),
  resetStatsDelta: vi.fn(),
}));

vi.mock("../keybinds.js", () => ({
  useKeybindsStore: {
    getState: vi.fn(() => ({ keybinds: [] })),
  },
}));

vi.mock("../crypto.js", () => ({
  useCryptoStore: {
    getState: vi.fn(() => ({
      keyPair: null,
      initialize: vi.fn(),
      getServerKey: vi.fn(() => null),
    })),
  },
}));

vi.mock("../auth.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      user: { id: "my-user-id" },
    })),
  },
}));

// Mock livekit-client
vi.mock("livekit-client", () => ({
  Room: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    localParticipant: {
      identity: "my-user-id",
      setMicrophoneEnabled: vi.fn(),
      audioTrackPublications: new Map(),
      videoTrackPublications: new Map(),
    },
    remoteParticipants: new Map(),
    removeAllListeners: vi.fn(),
  })),
  RoomEvent: {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    Disconnected: "disconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    LocalTrackPublished: "localTrackPublished",
  },
  Track: { Source: { Microphone: "microphone", ScreenShare: "screen_share" } },
  VideoPreset: {},
  VideoQuality: {},
  ExternalE2EEKeyProvider: vi.fn(() => ({
    setKey: vi.fn(),
  })),
}));

vi.mock("../../lib/serverUrl.js", () => ({
  API_BASE: "/api",
  getGatewayUrl: vi.fn(() => "ws://localhost:3001/gateway"),
}));

import { useVoiceStore } from "@/stores/voice/index.js";

describe("useVoiceStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset voice store to clean initial state
    useVoiceStore.setState({
      room: null,
      connectedChannelId: null,
      connecting: false,
      connectionError: null,
      isMuted: false,
      isDeafened: false,
      participants: [],
      channelParticipants: {},
      isScreenSharing: false,
      screenSharers: [],
      pinnedScreenShare: null,
      theatreMode: false,
      speakingUserIds: new Set(),
      lastSpokeAt: 0,
    });
  });

  // ── Leave Cleanup (3 tests) ──

  describe("leaveVoiceChannel", () => {
    it("removes self from channelParticipants", () => {
      const mockRoom = {
        localParticipant: {
          identity: "my-user-id",
          setMicrophoneEnabled: vi.fn(),
          audioTrackPublications: new Map(),
          videoTrackPublications: new Map(),
        },
        remoteParticipants: new Map(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
      };

      useVoiceStore.setState({
        room: mockRoom as any,
        connectedChannelId: "ch1",
        channelParticipants: {
          ch1: [
            { userId: "my-user-id", username: "me" },
            { userId: "u2", username: "bob" },
          ],
        },
      });

      useVoiceStore.getState().leaveVoiceChannel();

      const ch1 = useVoiceStore.getState().channelParticipants["ch1"];
      expect(ch1).toHaveLength(1);
      expect(ch1[0].userId).toBe("u2");
    });

    it("preserves other users in channel", () => {
      const mockRoom = {
        localParticipant: {
          identity: "my-user-id",
          setMicrophoneEnabled: vi.fn(),
          audioTrackPublications: new Map(),
          videoTrackPublications: new Map(),
        },
        remoteParticipants: new Map(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
      };

      useVoiceStore.setState({
        room: mockRoom as any,
        connectedChannelId: "ch1",
        channelParticipants: {
          ch1: [
            { userId: "my-user-id", username: "me" },
            { userId: "u2", username: "bob" },
            { userId: "u3", username: "charlie" },
          ],
          ch2: [
            { userId: "u4", username: "dave" },
          ],
        },
      });

      useVoiceStore.getState().leaveVoiceChannel();

      // ch1 should still have bob and charlie
      expect(useVoiceStore.getState().channelParticipants["ch1"]).toHaveLength(2);
      // ch2 should be untouched
      expect(useVoiceStore.getState().channelParticipants["ch2"]).toHaveLength(1);
    });

    it("sends gateway leave message", () => {
      const mockRoom = {
        localParticipant: {
          identity: "my-user-id",
          setMicrophoneEnabled: vi.fn(),
          audioTrackPublications: new Map(),
          videoTrackPublications: new Map(),
        },
        remoteParticipants: new Map(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
      };

      useVoiceStore.setState({
        room: mockRoom as any,
        connectedChannelId: "ch1",
        channelParticipants: {},
      });

      useVoiceStore.getState().leaveVoiceChannel();

      expect(mockGatewaySend).toHaveBeenCalledWith({
        type: "voice_state_update",
        channelId: "ch1",
        action: "leave",
      });
    });
  });

});
