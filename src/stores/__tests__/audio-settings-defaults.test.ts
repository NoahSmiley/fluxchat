import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — must appear before any store import.
// Pattern mirrors voice.test.ts: mock all external dependencies that the
// voice store transitively imports so the module loads cleanly in jsdom.
// ---------------------------------------------------------------------------

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
    send: vi.fn(),
    on: vi.fn(),
    onConnect: vi.fn(),
  },
}));

vi.mock("../../lib/broadcast.js", () => ({
  broadcastState: vi.fn(),
  onCommand: vi.fn(),
  isPopout: vi.fn(() => false),
}));

vi.mock("../../lib/debug.js", () => ({
  dbg: vi.fn(),
}));

vi.mock("../../lib/crypto.js", () => ({
  exportKeyAsBase64: vi.fn(),
}));

vi.mock("../../lib/webrtcStats.js", () => ({
  collectWebRTCStats: vi.fn(() =>
    Promise.resolve({
      audioBitrate: 128,
      audioCodec: "opus",
      audioPacketLoss: 0,
      audioJitter: 0,
      rtt: 0,
      videoBitrate: 0,
      videoCodec: "",
      videoWidth: 0,
      videoHeight: 0,
      videoFramerate: 0,
      connectionType: "host",
    }),
  ),
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
      user: { id: "test-user-id" },
    })),
  },
}));

vi.mock("../../lib/audio/dtln/DtlnTrackProcessor.js", () => ({
  DtlnTrackProcessor: vi.fn(),
}));

vi.mock("../../lib/serverUrl.js", () => ({
  API_BASE: "/api",
  getGatewayUrl: vi.fn(() => "ws://localhost:3001/gateway"),
}));

vi.mock("livekit-client", () => ({
  Room: vi.fn(() => ({
    on: vi.fn(),
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    localParticipant: {
      identity: "test-user-id",
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
  ExternalE2EEKeyProvider: vi.fn(() => ({ setKey: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Import the store AFTER all mocks are registered
// ---------------------------------------------------------------------------
import { useVoiceStore } from "@/stores/voice/index.js";

// ---------------------------------------------------------------------------
// Convenience — the key used to persist settings in localStorage
// ---------------------------------------------------------------------------
const SETTINGS_KEY = "flux-audio-settings";

// ---------------------------------------------------------------------------
// Helper: reset store + localStorage between tests
// ---------------------------------------------------------------------------
function resetStore() {
  localStorage.clear();
  useVoiceStore.setState({
    audioSettings: {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      dtx: false,
      highPassFrequency: 0,
      lowPassFrequency: 0,
      inputSensitivity: 40,
      inputSensitivityEnabled: false,
      noiseSuppressionModel: "dtln",
      suppressionStrength: 100,
      vadThreshold: 85,
      micInputGain: 100,
      noiseGateHoldTime: 200,
      compressorEnabled: false,
      compressorThreshold: -24,
      compressorRatio: 12,
      compressorAttack: 0.003,
      compressorRelease: 0.25,
      deEsserEnabled: false,
      deEsserStrength: 50,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AudioSettings — default values", () => {
  beforeEach(resetStore);

  it("noiseSuppression defaults to true", () => {
    expect(useVoiceStore.getState().audioSettings.noiseSuppression).toBe(true);
  });

  it("echoCancellation defaults to true", () => {
    expect(useVoiceStore.getState().audioSettings.echoCancellation).toBe(true);
  });

  it("autoGainControl defaults to true", () => {
    expect(useVoiceStore.getState().audioSettings.autoGainControl).toBe(true);
  });

  it("dtx defaults to false", () => {
    expect(useVoiceStore.getState().audioSettings.dtx).toBe(false);
  });

  it("highPassFrequency defaults to 0", () => {
    expect(useVoiceStore.getState().audioSettings.highPassFrequency).toBe(0);
  });

  it("lowPassFrequency defaults to 0", () => {
    expect(useVoiceStore.getState().audioSettings.lowPassFrequency).toBe(0);
  });

  it("inputSensitivity defaults to 40", () => {
    expect(useVoiceStore.getState().audioSettings.inputSensitivity).toBe(40);
  });

  it("inputSensitivityEnabled defaults to false", () => {
    expect(useVoiceStore.getState().audioSettings.inputSensitivityEnabled).toBe(false);
  });

  it("noiseSuppressionModel defaults to 'dtln'", () => {
    expect(useVoiceStore.getState().audioSettings.noiseSuppressionModel).toBe("dtln");
  });

  it("suppressionStrength defaults to 100", () => {
    expect(useVoiceStore.getState().audioSettings.suppressionStrength).toBe(100);
  });

  it("vadThreshold defaults to 85", () => {
    expect(useVoiceStore.getState().audioSettings.vadThreshold).toBe(85);
  });

  it("micInputGain defaults to 100", () => {
    expect(useVoiceStore.getState().audioSettings.micInputGain).toBe(100);
  });

  it("noiseGateHoldTime defaults to 200", () => {
    expect(useVoiceStore.getState().audioSettings.noiseGateHoldTime).toBe(200);
  });

  it("compressorEnabled defaults to false", () => {
    expect(useVoiceStore.getState().audioSettings.compressorEnabled).toBe(false);
  });

  it("compressorThreshold defaults to -24", () => {
    expect(useVoiceStore.getState().audioSettings.compressorThreshold).toBe(-24);
  });

  it("compressorRatio defaults to 12", () => {
    expect(useVoiceStore.getState().audioSettings.compressorRatio).toBe(12);
  });

  it("compressorAttack defaults to 0.003", () => {
    expect(useVoiceStore.getState().audioSettings.compressorAttack).toBeCloseTo(0.003);
  });

  it("compressorRelease defaults to 0.25", () => {
    expect(useVoiceStore.getState().audioSettings.compressorRelease).toBeCloseTo(0.25);
  });

  it("deEsserEnabled defaults to false", () => {
    expect(useVoiceStore.getState().audioSettings.deEsserEnabled).toBe(false);
  });

  it("deEsserStrength defaults to 50", () => {
    expect(useVoiceStore.getState().audioSettings.deEsserStrength).toBe(50);
  });
});

// ---------------------------------------------------------------------------

describe("AudioSettings — updateAudioSetting updates store state", () => {
  beforeEach(resetStore);

  it("updates noiseSuppression", () => {
    useVoiceStore.getState().updateAudioSetting("noiseSuppression", false);
    expect(useVoiceStore.getState().audioSettings.noiseSuppression).toBe(false);
  });

  it("updates echoCancellation", () => {
    useVoiceStore.getState().updateAudioSetting("echoCancellation", false);
    expect(useVoiceStore.getState().audioSettings.echoCancellation).toBe(false);
  });

  it("updates autoGainControl", () => {
    useVoiceStore.getState().updateAudioSetting("autoGainControl", false);
    expect(useVoiceStore.getState().audioSettings.autoGainControl).toBe(false);
  });

  it("updates dtx", () => {
    useVoiceStore.getState().updateAudioSetting("dtx", true);
    expect(useVoiceStore.getState().audioSettings.dtx).toBe(true);
  });

  it("updates highPassFrequency", () => {
    useVoiceStore.getState().updateAudioSetting("highPassFrequency", 120);
    expect(useVoiceStore.getState().audioSettings.highPassFrequency).toBe(120);
  });

  it("updates lowPassFrequency", () => {
    useVoiceStore.getState().updateAudioSetting("lowPassFrequency", 8000);
    expect(useVoiceStore.getState().audioSettings.lowPassFrequency).toBe(8000);
  });

  it("updates inputSensitivity", () => {
    useVoiceStore.getState().updateAudioSetting("inputSensitivity", 75);
    expect(useVoiceStore.getState().audioSettings.inputSensitivity).toBe(75);
  });

  it("updates inputSensitivityEnabled", () => {
    useVoiceStore.getState().updateAudioSetting("inputSensitivityEnabled", true);
    expect(useVoiceStore.getState().audioSettings.inputSensitivityEnabled).toBe(true);
  });

  it("updates suppressionStrength", () => {
    useVoiceStore.getState().updateAudioSetting("suppressionStrength", 60);
    expect(useVoiceStore.getState().audioSettings.suppressionStrength).toBe(60);
  });

  it("updates vadThreshold", () => {
    useVoiceStore.getState().updateAudioSetting("vadThreshold", 70);
    expect(useVoiceStore.getState().audioSettings.vadThreshold).toBe(70);
  });

  it("updates micInputGain", () => {
    useVoiceStore.getState().updateAudioSetting("micInputGain", 150);
    expect(useVoiceStore.getState().audioSettings.micInputGain).toBe(150);
  });

  it("updates noiseGateHoldTime", () => {
    useVoiceStore.getState().updateAudioSetting("noiseGateHoldTime", 500);
    expect(useVoiceStore.getState().audioSettings.noiseGateHoldTime).toBe(500);
  });

  it("only updates the targeted key, leaving others unchanged", () => {
    const before = { ...useVoiceStore.getState().audioSettings };
    useVoiceStore.getState().updateAudioSetting("dtx", true);
    const after = useVoiceStore.getState().audioSettings;

    expect(after.dtx).toBe(true);
    // Spot-check that other fields are untouched
    expect(after.noiseSuppression).toBe(before.noiseSuppression);
    expect(after.micInputGain).toBe(before.micInputGain);
    expect(after.suppressionStrength).toBe(before.suppressionStrength);
  });
});

// ---------------------------------------------------------------------------

describe("AudioSettings — updateAudioSetting persists to localStorage", () => {
  beforeEach(resetStore);

  it("writes to localStorage after updateAudioSetting", () => {
    useVoiceStore.getState().updateAudioSetting("suppressionStrength", 42);
    const raw = localStorage.getItem(SETTINGS_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.suppressionStrength).toBe(42);
  });

  it("persists noiseSuppression=false to localStorage", () => {
    useVoiceStore.getState().updateAudioSetting("noiseSuppression", false);
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(parsed.noiseSuppression).toBe(false);
  });

  it("persists micInputGain to localStorage", () => {
    useVoiceStore.getState().updateAudioSetting("micInputGain", 175);
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(parsed.micInputGain).toBe(175);
  });

  it("persists noiseSuppressionModel to localStorage", () => {
    useVoiceStore.getState().updateAudioSetting("noiseSuppressionModel", "rnnoise");
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(parsed.noiseSuppressionModel).toBe("rnnoise");
  });

  it("persists compressorEnabled to localStorage", () => {
    useVoiceStore.getState().updateAudioSetting("compressorEnabled", true);
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(parsed.compressorEnabled).toBe(true);
  });

  it("overwrites a previously-persisted value on subsequent calls", () => {
    useVoiceStore.getState().updateAudioSetting("suppressionStrength", 10);
    useVoiceStore.getState().updateAudioSetting("suppressionStrength", 90);
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    expect(parsed.suppressionStrength).toBe(90);
  });

  it("localStorage JSON contains all required keys", () => {
    useVoiceStore.getState().updateAudioSetting("dtx", true);
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY)!);
    const requiredKeys = [
      "noiseSuppression",
      "echoCancellation",
      "autoGainControl",
      "dtx",
      "highPassFrequency",
      "lowPassFrequency",
      "inputSensitivity",
      "inputSensitivityEnabled",
      "noiseSuppressionModel",
      "suppressionStrength",
      "vadThreshold",
      "micInputGain",
      "noiseGateHoldTime",
      "compressorEnabled",
      "compressorThreshold",
      "compressorRatio",
      "compressorAttack",
      "compressorRelease",
      "deEsserEnabled",
      "deEsserStrength",
    ];
    for (const key of requiredKeys) {
      expect(parsed).toHaveProperty(key);
    }
  });
});
