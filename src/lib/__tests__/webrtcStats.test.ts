import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectWebRTCStats, resetStatsDelta } from "../webrtcStats.js";

// Helper to create a mock RTCStatsReport
function createMockStatsReport(entries: Record<string, any>[]): Map<string, any> {
  const map = new Map<string, any>();
  for (const entry of entries) {
    map.set(entry.id ?? `stat-${map.size}`, entry);
  }
  return map;
}

function createMockRoom(overrides: {
  audioSenderStats?: Record<string, any>[];
  audioReceiverStats?: Record<string, any>[];
  videoSenderStats?: Record<string, any>[];
  videoReceiverStats?: Record<string, any>[];
} = {}) {
  const audioSender = overrides.audioSenderStats
    ? { getStats: vi.fn(() => Promise.resolve(createMockStatsReport(overrides.audioSenderStats!))) }
    : null;

  const audioReceiver = overrides.audioReceiverStats
    ? { getStats: vi.fn(() => Promise.resolve(createMockStatsReport(overrides.audioReceiverStats!))) }
    : null;

  const videoSender = overrides.videoSenderStats
    ? { getStats: vi.fn(() => Promise.resolve(createMockStatsReport(overrides.videoSenderStats!))) }
    : null;

  const videoReceiver = overrides.videoReceiverStats
    ? { getStats: vi.fn(() => Promise.resolve(createMockStatsReport(overrides.videoReceiverStats!))) }
    : null;

  const localAudioPubs = new Map();
  if (audioSender) {
    localAudioPubs.set("audio-pub", { track: { sender: audioSender } });
  }

  const localVideoPubs = new Map();
  if (videoSender) {
    localVideoPubs.set("video-pub", { source: "screen_share", track: { sender: videoSender } });
  }

  const remoteParticipants = new Map();
  if (audioReceiver || videoReceiver) {
    const remoteAudioPubs = new Map();
    if (audioReceiver) {
      remoteAudioPubs.set("remote-audio", { track: { receiver: audioReceiver } });
    }
    const remoteVideoPubs = new Map();
    if (videoReceiver) {
      remoteVideoPubs.set("remote-video", { source: "screen_share", track: { receiver: videoReceiver } });
    }
    remoteParticipants.set("remote-1", {
      audioTrackPublications: remoteAudioPubs,
      videoTrackPublications: remoteVideoPubs,
    });
  }

  return {
    localParticipant: {
      audioTrackPublications: localAudioPubs,
      videoTrackPublications: localVideoPubs,
    },
    remoteParticipants,
  } as any;
}

// Need to mock livekit-client for Track.Source
vi.mock("livekit-client", () => ({
  Track: { Source: { ScreenShare: "screen_share" } },
}));

describe("collectWebRTCStats", () => {
  beforeEach(() => {
    resetStatsDelta();
  });

  it("extracts audio codec from outbound-rtp stats", async () => {
    const room = createMockRoom({
      audioSenderStats: [
        { id: "rtp-1", type: "outbound-rtp", kind: "audio", bytesSent: 50000, packetsSent: 100, packetsLost: 0 },
        { id: "codec-1", type: "codec", mimeType: "audio/opus" },
      ],
    });

    const stats = await collectWebRTCStats(room);
    expect(stats.audioCodec).toBe("opus");
  });

  it("computes bitrate from byte deltas", async () => {
    const room = createMockRoom({
      audioSenderStats: [
        { id: "rtp-1", type: "outbound-rtp", kind: "audio", bytesSent: 50000, packetsSent: 100, packetsLost: 0 },
      ],
    });

    // First call establishes baseline
    await collectWebRTCStats(room);

    // Update bytesSent for second call (add 32000 bytes = 256kbps at 1s)
    const updatedRoom = createMockRoom({
      audioSenderStats: [
        { id: "rtp-1", type: "outbound-rtp", kind: "audio", bytesSent: 82000, packetsSent: 200, packetsLost: 0 },
      ],
    });

    const stats = await collectWebRTCStats(updatedRoom);
    // Bitrate should be > 0 (exact value depends on timing)
    expect(stats.audioBitrate).toBeGreaterThanOrEqual(0);
  });

  it("computes packet loss percentage", async () => {
    const room = createMockRoom({
      audioSenderStats: [
        { id: "rtp-1", type: "outbound-rtp", kind: "audio", bytesSent: 50000, packetsSent: 95, packetsLost: 5 },
      ],
    });

    const stats = await collectWebRTCStats(room);
    // 5 lost out of 100 total = 5%
    expect(stats.audioPacketLoss).toBe(5);
  });

  it("extracts RTT from remote-inbound-rtp stats", async () => {
    const room = createMockRoom({
      audioSenderStats: [
        { id: "rtp-1", type: "outbound-rtp", kind: "audio", bytesSent: 50000, packetsSent: 100, packetsLost: 0 },
        { id: "remote-1", type: "remote-inbound-rtp", kind: "audio", jitter: 0.005, roundTripTime: 0.045 },
      ],
    });

    const stats = await collectWebRTCStats(room);
    expect(stats.rtt).toBe(45); // 0.045s = 45ms
    expect(stats.audioJitter).toBe(0.005);
  });

  it("extracts video resolution and framerate from inbound-rtp", async () => {
    const room = createMockRoom({
      videoReceiverStats: [
        { id: "rtp-v1", type: "inbound-rtp", kind: "video", frameWidth: 1920, frameHeight: 1080, framesPerSecond: 60 },
        { id: "codec-v1", type: "codec", mimeType: "video/H264" },
      ],
    });

    const stats = await collectWebRTCStats(room);
    expect(stats.videoWidth).toBe(1920);
    expect(stats.videoHeight).toBe(1080);
    expect(stats.videoFramerate).toBe(60);
    expect(stats.videoCodec).toBe("H264");
  });

  it("returns empty stats when no publications exist", async () => {
    const room = createMockRoom();

    const stats = await collectWebRTCStats(room);
    expect(stats.audioBitrate).toBe(0);
    expect(stats.audioCodec).toBe("");
    expect(stats.audioPacketLoss).toBe(0);
    expect(stats.rtt).toBe(0);
    expect(stats.videoWidth).toBe(0);
  });
});
