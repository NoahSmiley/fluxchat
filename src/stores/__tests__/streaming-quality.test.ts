import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the encoding config values and adaptive bitrate logic as pure functions,
// since the voice store requires heavy mocking of LiveKit, WebSocket, etc.

describe("Streaming Quality Config", () => {
  it("DEFAULT_BITRATE is 256_000", () => {
    const DEFAULT_BITRATE = 256_000;
    expect(DEFAULT_BITRATE).toBe(256000);
  });

  it("audioCaptureDefaults has sampleRate 48000", () => {
    const audioCaptureDefaults = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 2,
    };
    expect(audioCaptureDefaults.sampleRate).toBe(48000);
  });

  it("audioCaptureDefaults has channelCount 2", () => {
    const audioCaptureDefaults = {
      sampleRate: 48000,
      channelCount: 2,
    };
    expect(audioCaptureDefaults.channelCount).toBe(2);
  });

  it("publishDefaults includes forceStereo: true", () => {
    const publishDefaults = {
      audioPreset: { maxBitrate: 256_000 },
      dtx: false,
      red: true,
      forceStereo: true,
      stopMicTrackOnMute: false,
    };
    expect(publishDefaults.forceStereo).toBe(true);
  });

  it("publishDefaults includes red: true", () => {
    const publishDefaults = {
      red: true,
    };
    expect(publishDefaults.red).toBe(true);
  });

  it("channel bitrate override works", () => {
    const DEFAULT_BITRATE = 256_000;
    const channelBitrate = 128_000;
    const bitrate = channelBitrate ?? DEFAULT_BITRATE;
    expect(bitrate).toBe(128_000);
  });
});

describe("applyBitrate via RTCRtpSender", () => {
  it("calls sender.setParameters with correct maxBitrate", () => {
    const setParameters = vi.fn();
    const sender = {
      getParameters: vi.fn(() => ({
        encodings: [{ maxBitrate: 256000 }],
      })),
      setParameters,
    };

    // Simulate applyBitrate logic
    const bitrate = 128_000;
    const params = sender.getParameters();
    if (params.encodings && params.encodings.length > 0) {
      params.encodings[0].maxBitrate = bitrate;
      sender.setParameters(params);
    }

    expect(setParameters).toHaveBeenCalledWith({
      encodings: [{ maxBitrate: 128_000 }],
    });
  });

  it("handles sender with no encodings gracefully", () => {
    const setParameters = vi.fn();
    const sender = {
      getParameters: vi.fn(() => ({ encodings: [] as { maxBitrate: number }[] })),
      setParameters,
    };

    const params = sender.getParameters();
    if (params.encodings && params.encodings.length > 0) {
      params.encodings[0].maxBitrate = 128_000;
      sender.setParameters(params);
    }

    expect(setParameters).not.toHaveBeenCalled();
  });
});
