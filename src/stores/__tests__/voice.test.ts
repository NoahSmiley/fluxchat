import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted runs before vi.mock factories — use it for shared mock references
const { mockGatewayOn, mockGatewayOnConnect, mockGatewaySend } = vi.hoisted(() => ({
  mockGatewayOn: vi.fn(),
  mockGatewayOnConnect: vi.fn(),
  mockGatewaySend: vi.fn(),
}));

// ── Mocks ──

vi.mock("../../lib/api.js", () => ({
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

vi.mock("../../lib/dtln/DtlnTrackProcessor.js", () => ({
  DtlnTrackProcessor: vi.fn(),
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

import { useVoiceStore } from "../voice.js";

// Capture the voice_state handler registered at module load time BEFORE clearAllMocks
// gateway.on was called during voice.ts import, so the callback is in mockGatewayOn.mock.calls
let voiceStateHandler: (event: Record<string, unknown>) => void;
{
  const calls = mockGatewayOn.mock.calls;
  for (const call of calls) {
    if (typeof call[0] === "function") {
      voiceStateHandler = call[0];
      break;
    }
  }
  if (!voiceStateHandler!) {
    throw new Error("voice_state handler not registered on gateway.on during module load");
  }
}

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
      participantVolumes: {},
      participantTrackMap: {},
      audioLevels: {},
      speakingUserIds: new Set(),
      lastSpokeAt: 0,
    });
  });

  // ── _setChannelParticipants (3 tests) ──

  describe("_setChannelParticipants", () => {
    it("adds participants for a channel", () => {
      const participants = [
        { userId: "u1", username: "alice", image: null, drinkCount: 0 },
        { userId: "u2", username: "bob", image: null, drinkCount: 0 },
      ];

      useVoiceStore.getState()._setChannelParticipants("ch1", participants);

      expect(useVoiceStore.getState().channelParticipants["ch1"]).toEqual(participants);
    });

    it("replaces existing participants", () => {
      useVoiceStore.setState({
        channelParticipants: {
          ch1: [{ userId: "u1", username: "alice", image: null, drinkCount: 0 }],
        },
      });

      const newParticipants = [
        { userId: "u2", username: "bob", image: null, drinkCount: 0 },
      ];
      useVoiceStore.getState()._setChannelParticipants("ch1", newParticipants);

      expect(useVoiceStore.getState().channelParticipants["ch1"]).toEqual(newParticipants);
    });

    it("preserves other channels", () => {
      useVoiceStore.setState({
        channelParticipants: {
          ch1: [{ userId: "u1", username: "alice", image: null, drinkCount: 0 }],
        },
      });

      const ch2Participants = [
        { userId: "u2", username: "bob", image: null, drinkCount: 0 },
      ];
      useVoiceStore.getState()._setChannelParticipants("ch2", ch2Participants);

      expect(useVoiceStore.getState().channelParticipants["ch1"]).toHaveLength(1);
      expect(useVoiceStore.getState().channelParticipants["ch2"]).toEqual(ch2Participants);
    });
  });

  // ── voice_state event handler (4 tests) ──

  describe("voice_state event handler", () => {
    it("updates channelParticipants from event", () => {
      const participants = [
        { userId: "u1", username: "alice", image: null, drinkCount: 0 },
      ];

      // Set connected so our userId isn't filtered
      useVoiceStore.setState({ connectedChannelId: "ch1" });

      voiceStateHandler({
        type: "voice_state",
        channelId: "ch1",
        participants,
      });

      expect(useVoiceStore.getState().channelParticipants["ch1"]).toEqual(participants);
    });

    it("filters own user when not connected to that channel", async () => {
      // Wait for the lazy auth store import to resolve
      // The voice store does: import("./auth.js").then((m) => { _authStore = m.useAuthStore; })
      await new Promise((r) => setTimeout(r, 50));

      // We're connected to ch2, not ch1
      useVoiceStore.setState({ connectedChannelId: "ch2" });

      voiceStateHandler({
        type: "voice_state",
        channelId: "ch1",
        participants: [
          { userId: "my-user-id", username: "me", image: null, drinkCount: 0 },
          { userId: "u2", username: "bob", image: null, drinkCount: 0 },
        ],
      });

      const ch1 = useVoiceStore.getState().channelParticipants["ch1"];
      // Should have filtered out "my-user-id" since we're not connected to ch1
      expect(ch1).toHaveLength(1);
      expect(ch1[0].userId).toBe("u2");
    });

    it("keeps own user when connected to channel", () => {
      // We're connected to ch1
      useVoiceStore.setState({ connectedChannelId: "ch1" });

      voiceStateHandler({
        type: "voice_state",
        channelId: "ch1",
        participants: [
          { userId: "my-user-id", username: "me", image: null, drinkCount: 0 },
          { userId: "u2", username: "bob", image: null, drinkCount: 0 },
        ],
      });

      const ch1 = useVoiceStore.getState().channelParticipants["ch1"];
      expect(ch1).toHaveLength(2);
      expect(ch1.find((p: { userId: string }) => p.userId === "my-user-id")).toBeTruthy();
    });

    it("empty participants clears channel", () => {
      useVoiceStore.setState({
        channelParticipants: {
          ch1: [{ userId: "u1", username: "alice", image: null, drinkCount: 0 }],
        },
      });

      voiceStateHandler({
        type: "voice_state",
        channelId: "ch1",
        participants: [],
      });

      expect(useVoiceStore.getState().channelParticipants["ch1"]).toEqual([]);
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
            { userId: "my-user-id", username: "me", image: null, drinkCount: 0 },
            { userId: "u2", username: "bob", image: null, drinkCount: 0 },
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
            { userId: "my-user-id", username: "me", image: null, drinkCount: 0 },
            { userId: "u2", username: "bob", image: null, drinkCount: 0 },
            { userId: "u3", username: "charlie", image: null, drinkCount: 0 },
          ],
          ch2: [
            { userId: "u4", username: "dave", image: null, drinkCount: 0 },
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

  // ── Noise Suppression Model (3 tests) ──

  describe("noiseSuppressionModel", () => {
    it("defaults to dtln", () => {
      expect(useVoiceStore.getState().audioSettings.noiseSuppressionModel).toBe("dtln");
    });

    it("can be changed via updateAudioSetting", () => {
      useVoiceStore.getState().updateAudioSetting("noiseSuppressionModel", "rnnoise");
      expect(useVoiceStore.getState().audioSettings.noiseSuppressionModel).toBe("rnnoise");
    });

    it("can be set to off", () => {
      useVoiceStore.getState().updateAudioSetting("noiseSuppressionModel", "off");
      expect(useVoiceStore.getState().audioSettings.noiseSuppressionModel).toBe("off");
    });
  });

  // ── Stats Overlay Toggle (3 tests) ──

  describe("stats overlay", () => {
    it("showStatsOverlay defaults to false", () => {
      expect(useVoiceStore.getState().showStatsOverlay).toBe(false);
    });

    it("toggleStatsOverlay toggles the overlay", () => {
      useVoiceStore.getState().toggleStatsOverlay();
      expect(useVoiceStore.getState().showStatsOverlay).toBe(true);
      useVoiceStore.getState().toggleStatsOverlay();
      expect(useVoiceStore.getState().showStatsOverlay).toBe(false);
    });

    it("webrtcStats defaults to null", () => {
      expect(useVoiceStore.getState().webrtcStats).toBeNull();
    });
  });
});
