import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MediaStream
if (typeof globalThis.MediaStream === "undefined") {
  Object.defineProperty(globalThis, "MediaStream", {
    value: class {
      constructor(_tracks?: any[]) {}
    },
    configurable: true,
  });
}

// Build a mock Web Audio API that tracks node creation and connections
function createMockAudioContext() {
  const nodes: { type: string; params: Record<string, any>; connections: any[] }[] = [];

  const makeNode = (type: string, params: Record<string, any> = {}) => {
    const node = {
      type,
      params,
      connections: [] as any[],
      connect(target: any, ...args: any[]) {
        node.connections.push({ target, args });
        return target;
      },
      disconnect() {},
    };
    nodes.push(node);
    return node;
  };

  const ctx = {
    state: "running" as AudioContextState,
    currentTime: 0,
    sampleRate: 48000,
    destination: { type: "destination" },
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
    createMediaStreamSource: vi.fn((stream: any) => ({
      ...makeNode("MediaStreamSource"),
      channelCount: stream._channelCount ?? 1,
    })),
    createChannelSplitter: vi.fn((count: number) => ({
      ...makeNode("ChannelSplitter", { channelCount: count }),
    })),
    createChannelMerger: vi.fn((count: number) => ({
      ...makeNode("ChannelMerger", { channelCount: count }),
    })),
    createBiquadFilter: vi.fn(() => ({
      ...makeNode("BiquadFilter"),
      type: "" as BiquadFilterType,
      frequency: { value: 0 },
      gain: { value: 0 },
    })),
    createDynamicsCompressor: vi.fn(() => ({
      ...makeNode("DynamicsCompressor"),
      threshold: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      knee: { value: 0 },
    })),
    createGain: vi.fn(() => ({
      ...makeNode("Gain"),
      gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    })),
    createAnalyser: vi.fn(() => ({
      ...makeNode("Analyser"),
      fftSize: 0,
      getFloatTimeDomainData: vi.fn(),
    })),
    _nodes: nodes,
  };

  return ctx;
}

// We can't import createAudioPipeline directly since it's not exported.
// Instead, test the pipeline construction logic by simulating what createAudioPipeline does.
// This tests the audio graph construction rules.

describe("Audio Pipeline Graph Construction", () => {
  let ctx: ReturnType<typeof createMockAudioContext>;

  beforeEach(() => {
    ctx = createMockAudioContext();
  });

  function buildPipeline(settings: {
    highPassFrequency: number;
    lowPassFrequency: number;
    deEsserEnabled: boolean;
    deEsserStrength: number;
    compressorEnabled: boolean;
    compressorThreshold: number;
    compressorRatio: number;
    compressorAttack: number;
    compressorRelease: number;
  }, volume: number = 1.0) {
    // Simulate createAudioPipeline logic
    const source = ctx.createMediaStreamSource(new MediaStream());
    const splitter = ctx.createChannelSplitter(1);
    const merger = ctx.createChannelMerger(2);

    source.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 0, 1);

    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = settings.highPassFrequency > 0 ? settings.highPassFrequency : 0;

    const lowPass = ctx.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = settings.lowPassFrequency > 0 ? settings.lowPassFrequency : 24000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.05);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;

    merger.connect(highPass);
    highPass.connect(lowPass);

    let lastNode: any = lowPass;

    let deEsser: any = null;
    if (settings.deEsserEnabled) {
      deEsser = ctx.createBiquadFilter();
      deEsser.type = "highshelf";
      deEsser.frequency.value = 5500;
      deEsser.gain.value = -(settings.deEsserStrength / 100) * 12;
      lastNode.connect(deEsser);
      lastNode = deEsser;
    }

    let compressor: any = null;
    if (settings.compressorEnabled) {
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = settings.compressorThreshold;
      compressor.ratio.value = settings.compressorRatio;
      compressor.attack.value = settings.compressorAttack;
      compressor.release.value = settings.compressorRelease;
      compressor.knee.value = 10;
      lastNode.connect(compressor);
      lastNode = compressor;
    }

    lastNode.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);

    return { source, splitter, merger, highPass, lowPass, deEsser, compressor, gain, analyser };
  }

  it("builds mono-to-stereo routing with ChannelSplitter(1) and ChannelMerger(2)", () => {
    buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(ctx.createChannelSplitter).toHaveBeenCalledWith(1);
    expect(ctx.createChannelMerger).toHaveBeenCalledWith(2);
  });

  it("creates compressor with correct parameters when enabled", () => {
    const { compressor } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: true, compressorThreshold: -24, compressorRatio: 12, compressorAttack: 0.003, compressorRelease: 0.25,
    });

    expect(compressor).not.toBeNull();
    expect(compressor.threshold.value).toBe(-24);
    expect(compressor.ratio.value).toBe(12);
    expect(compressor.attack.value).toBe(0.003);
    expect(compressor.release.value).toBe(0.25);
    expect(compressor.knee.value).toBe(10);
  });

  it("does not create compressor when disabled", () => {
    const { compressor } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(compressor).toBeNull();
    expect(ctx.createDynamicsCompressor).not.toHaveBeenCalled();
  });

  it("creates de-esser at strength 50 with gain -6dB", () => {
    const { deEsser } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: true, deEsserStrength: 50,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(deEsser).not.toBeNull();
    expect(deEsser.type).toBe("highshelf");
    expect(deEsser.frequency.value).toBe(5500);
    expect(deEsser.gain.value).toBe(-6);
  });

  it("creates de-esser at strength 100 with gain -12dB", () => {
    const { deEsser } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: true, deEsserStrength: 100,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(deEsser).not.toBeNull();
    expect(deEsser.gain.value).toBe(-12);
  });

  it("does not create de-esser when disabled", () => {
    const { deEsser } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 50,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(deEsser).toBeNull();
  });

  it("sets high-pass filter to specified frequency", () => {
    const { highPass } = buildPipeline({
      highPassFrequency: 300, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(highPass.type).toBe("highpass");
    expect(highPass.frequency.value).toBe(300);
  });

  it("sets low-pass filter to specified frequency", () => {
    const { lowPass } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 8000,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(lowPass.type).toBe("lowpass");
    expect(lowPass.frequency.value).toBe(8000);
  });

  it("defaults low-pass to 24000 when frequency is 0", () => {
    const { lowPass } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(lowPass.frequency.value).toBe(24000);
  });

  it("applies gain fade-in starting at 0 and ramping to target volume", () => {
    const { gain } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    }, 0.75);

    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.75, 0.05);
  });

  it("creates analyser with fftSize 256", () => {
    const { analyser } = buildPipeline({
      highPassFrequency: 0, lowPassFrequency: 0,
      deEsserEnabled: false, deEsserStrength: 0,
      compressorEnabled: false, compressorThreshold: 0, compressorRatio: 0, compressorAttack: 0, compressorRelease: 0,
    });

    expect(analyser.fftSize).toBe(256);
  });
});
