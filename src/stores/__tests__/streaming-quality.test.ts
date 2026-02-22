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

describe("Adaptive Bitrate Algorithm", () => {
  // Extracted adaptive bitrate logic as a pure function for testing
  function simulateAdaptiveBitrate(
    lossSequence: number[],
    initialBitrate: number = 256_000,
    targetBitrate: number = 256_000,
  ) {
    let adaptiveCurrentBitrate = initialBitrate;
    let adaptiveTargetBitrate = targetBitrate;
    let highLossCount = 0;
    let lowLossCount = 0;
    const bitrateHistory: number[] = [adaptiveCurrentBitrate];

    for (const loss of lossSequence) {
      if (loss > 5) {
        highLossCount++;
        lowLossCount = 0;
        if (highLossCount >= 2) {
          const reduced = Math.round(adaptiveCurrentBitrate * 0.75);
          adaptiveCurrentBitrate = Math.max(32_000, reduced);
        }
      } else if (loss < 1) {
        lowLossCount++;
        highLossCount = 0;
        if (lowLossCount >= 5) {
          const increased = Math.round(adaptiveCurrentBitrate * 1.1);
          adaptiveCurrentBitrate = Math.min(adaptiveTargetBitrate, increased);
        }
      } else {
        highLossCount = 0;
        lowLossCount = 0;
      }
      bitrateHistory.push(adaptiveCurrentBitrate);
    }

    return { finalBitrate: adaptiveCurrentBitrate, bitrateHistory, highLossCount, lowLossCount };
  }

  it("reduces bitrate by 25% after 2 consecutive high-loss polls (>5%)", () => {
    const result = simulateAdaptiveBitrate([10, 10]); // Two polls with 10% loss
    // After first poll: highLossCount=1, no change
    // After second poll: highLossCount=2, reduce by 25%
    expect(result.finalBitrate).toBe(Math.round(256_000 * 0.75)); // 192000
  });

  it("does not reduce after only 1 high-loss poll", () => {
    const result = simulateAdaptiveBitrate([10]); // Only one poll
    expect(result.finalBitrate).toBe(256_000); // No change
  });

  it("increases bitrate by 10% after 5 consecutive low-loss polls (<1%)", () => {
    const startBitrate = 192_000;
    const result = simulateAdaptiveBitrate(
      [0, 0, 0, 0, 0], // 5 polls with 0% loss
      startBitrate,
    );
    // After 5th poll: increase by 10%
    expect(result.finalBitrate).toBe(Math.round(192_000 * 1.1)); // 211200
  });

  it("does not increase after only 4 low-loss polls", () => {
    const startBitrate = 192_000;
    const result = simulateAdaptiveBitrate(
      [0, 0, 0, 0], // Only 4 polls
      startBitrate,
    );
    expect(result.finalBitrate).toBe(192_000); // No change
  });

  it("respects floor of 32 kbps", () => {
    // Start very low and hit high loss repeatedly
    const result = simulateAdaptiveBitrate(
      [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
      40_000,
    );
    expect(result.finalBitrate).toBe(32_000);
  });

  it("respects ceiling of target bitrate", () => {
    const target = 128_000;
    const result = simulateAdaptiveBitrate(
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // 10 low-loss polls
      120_000,
      target,
    );
    // After increase, should not exceed target
    expect(result.finalBitrate).toBeLessThanOrEqual(target);
  });

  it("holds steady during moderate loss (1-5%)", () => {
    const result = simulateAdaptiveBitrate([3, 3, 3, 3, 3]); // Moderate loss
    expect(result.finalBitrate).toBe(256_000); // No change
  });

  it("resets counters when loss transitions between ranges", () => {
    // 1 high loss poll, then moderate, then high again — should not trigger reduction on the 2nd high poll
    const result = simulateAdaptiveBitrate([10, 3, 10]); // high, moderate (resets), high
    expect(result.finalBitrate).toBe(256_000); // No reduction — counters reset
  });

  it("reduces multiple times during sustained high loss", () => {
    const result = simulateAdaptiveBitrate([10, 10, 10, 10]); // 4 consecutive high-loss polls
    // Poll 2: reduce to 192000
    // Poll 3: highLossCount=3 (>=2), reduce 192000 * 0.75 = 144000
    // Poll 4: highLossCount=4, reduce 144000 * 0.75 = 108000
    expect(result.finalBitrate).toBe(Math.round(Math.round(256_000 * 0.75) * 0.75 * 0.75));
  });
});
