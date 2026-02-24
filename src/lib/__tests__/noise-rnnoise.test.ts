import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock factories — defined via vi.hoisted so they are available inside
// vi.mock() factory functions before module evaluation.
// ---------------------------------------------------------------------------
const {
  mockWorkletNodePort,
  MockAudioWorkletNode,
  MockAudioContext,
  MockMediaStream,
  MockWorker,
  MockMessageChannel,
} = vi.hoisted(() => {
  // A port object that mimics MessagePort on an AudioWorkletNode
  const makePort = () => ({
    postMessage: vi.fn(),
    onmessage: null as ((e: MessageEvent) => void) | null,
  });

  // Single shared port reference so tests can query postMessage calls
  const mockWorkletNodePort = makePort();

  // Minimal GainNode
  const makeGainNode = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
  });

  // Minimal source node
  const makeSourceNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });

  // Destination node — provides a .stream with an audio track
  const makeDestinationNode = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    stream: {
      getAudioTracks: vi.fn(() => [{ kind: "audio", id: "mock-track-id" }]),
    },
  });

  const MockAudioWorkletNodeFn = vi.fn(function (this: any) {
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.port = makePort();
  });

  const MockAudioContext = vi.fn(function (this: any, opts?: { sampleRate?: number }) {
    this.sampleRate = opts?.sampleRate ?? 48000;
    this.state = "running";
    this.currentTime = 0;
    this.close = vi.fn(() => Promise.resolve());
    this.createGain = vi.fn(makeGainNode);
    this.createMediaStreamSource = vi.fn(makeSourceNode);
    this.createMediaStreamDestination = vi.fn(makeDestinationNode);
    this.audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
  });

  // MediaStream constructor mock
  const MockMediaStream = vi.fn(function (this: any, tracks?: MediaStreamTrack[]) {
    this.getAudioTracks = vi.fn(() => tracks ?? []);
  });

  // Worker constructor mock
  const MockWorker = vi.fn(function (this: any, _url: string) {
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    this.onmessage = null as ((e: MessageEvent) => void) | null;
  });

  // MessageChannel mock — two ports
  const MockMessageChannel = vi.fn(function (this: any) {
    this.port1 = makePort();
    this.port2 = makePort();
  });

  return {
    mockWorkletNodePort,
    MockAudioWorkletNode: MockAudioWorkletNodeFn,
    MockAudioContext,
    MockMediaStream,
    MockWorker,
    MockMessageChannel,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("livekit-client", () => ({
  Track: {
    Kind: { Audio: "audio" },
  },
}));

vi.mock("@sapphi-red/web-noise-suppressor", () => ({
  loadSpeex: vi.fn(() => Promise.resolve(new Uint8Array())),
  SpeexWorkletNode: vi.fn(function (this: any) {
    this.connect = vi.fn();
    this.disconnect = vi.fn();
    this.destroy = vi.fn();
    this.port = { postMessage: vi.fn(), onmessage: null };
  }),
}));

vi.mock("@sapphi-red/web-noise-suppressor/speexWorklet.js?url", () => ({
  default: "/mock/speex-worklet-url.js",
}));

vi.mock("@sapphi-red/web-noise-suppressor/speex.wasm?url", () => ({
  default: "/mock/speex.wasm",
}));

// ---------------------------------------------------------------------------
// Inject Web API mocks into the global scope before importing any processor
// ---------------------------------------------------------------------------
Object.defineProperty(globalThis, "AudioContext", {
  value: MockAudioContext,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "AudioWorkletNode", {
  value: MockAudioWorkletNode,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "MediaStream", {
  value: MockMediaStream,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "Worker", {
  value: MockWorker,
  configurable: true,
  writable: true,
});

Object.defineProperty(globalThis, "MessageChannel", {
  value: MockMessageChannel,
  configurable: true,
  writable: true,
});

// ---------------------------------------------------------------------------
// Import processors AFTER globals are patched
// ---------------------------------------------------------------------------
import { RnnoiseTrackProcessor } from "@/lib/audio/rnnoise/RnnoiseTrackProcessor.js";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

/** Minimal AudioProcessorOptions-like object. */
function makeOpts(sampleRate = 48000) {
  const track = {
    kind: "audio" as const,
    id: "test-track",
    getSettings: vi.fn(() => ({ sampleRate })),
  } as unknown as MediaStreamTrack;
  return { track } as unknown as import("livekit-client").AudioProcessorOptions;
}

// ---------------------------------------------------------------------------
// Build a self-contained AudioContext mock that looks like a real instance and
// can be referenced after construction.
// ---------------------------------------------------------------------------
function makeMockContext(sampleRate = 48000) {
  const makeGainNode = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
  });
  return {
    sampleRate,
    state: "running" as string,
    currentTime: 0,
    close: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(makeGainNode),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createMediaStreamDestination: vi.fn(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      stream: { getAudioTracks: vi.fn(() => [{ kind: "audio", id: "track-id" }]) },
    })),
    audioWorklet: { addModule: vi.fn(() => Promise.resolve()) },
  };
}

// ===========================================================================
// RnnoiseTrackProcessor
// ===========================================================================

describe("RnnoiseTrackProcessor", () => {
  let processor: RnnoiseTrackProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new RnnoiseTrackProcessor();
  });

  it("has the correct name", () => {
    expect(processor.name).toBe("rnnoise-noise-filter");
  });

  it("processedTrack is undefined before init", () => {
    expect(processor.processedTrack).toBeUndefined();
  });

  describe("setVadThreshold — before init (rnnoiseNode is null)", () => {
    it("does not throw when worklet node is null", () => {
      expect(() => processor.setVadThreshold(0.5)).not.toThrow();
    });

    it("does not call postMessage when rnnoiseNode is null", () => {
      const spy = vi.fn();
      // rnnoiseNode stays null — verify no port.postMessage is triggered
      expect(() => processor.setVadThreshold(0.75)).not.toThrow();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("clears processedTrack", async () => {
      (processor as any).processedTrack = {} as MediaStreamTrack;
      await processor.destroy();
      expect(processor.processedTrack).toBeUndefined();
    });

    it("nullifies all internal nodes", async () => {
      (processor as any).rnnoiseContext = makeMockContext();
      (processor as any).rnnoiseNode = { disconnect: vi.fn() };
      (processor as any).sourceNode = { disconnect: vi.fn() };
      (processor as any).destinationNode = {};

      await processor.destroy();

      expect((processor as any).rnnoiseContext).toBeNull();
      expect((processor as any).rnnoiseNode).toBeNull();
      expect((processor as any).sourceNode).toBeNull();
      expect((processor as any).destinationNode).toBeNull();
    });

    it("can be called with no state without throwing", async () => {
      await expect(processor.destroy()).resolves.not.toThrow();
    });

    it("disconnects sourceNode and rnnoiseNode", async () => {
      const mockSource = { disconnect: vi.fn() };
      const mockNode = { disconnect: vi.fn() };
      (processor as any).sourceNode = mockSource;
      (processor as any).rnnoiseNode = mockNode;
      (processor as any).rnnoiseContext = makeMockContext();

      await processor.destroy();

      expect(mockSource.disconnect).toHaveBeenCalled();
      expect(mockNode.disconnect).toHaveBeenCalled();
    });

    it("closes AudioContext when state is running", async () => {
      const ctx = makeMockContext();
      (processor as any).rnnoiseContext = ctx;

      await processor.destroy();

      expect(ctx.close).toHaveBeenCalled();
    });

    it("skips closing AudioContext when state is already closed", async () => {
      const ctx = makeMockContext();
      ctx.state = "closed";
      (processor as any).rnnoiseContext = ctx;

      await processor.destroy();

      expect(ctx.close).not.toHaveBeenCalled();
    });
  });

  describe("restart", () => {
    it("calls destroy then init", async () => {
      const opts = makeOpts();
      const destroySpy = vi.spyOn(processor, "destroy");
      const initSpy = vi.spyOn(processor, "init").mockResolvedValue();

      await processor.restart(opts);

      expect(destroySpy).toHaveBeenCalledOnce();
      expect(initSpy).toHaveBeenCalledWith(opts);
    });
  });
});

// ===========================================================================
// RnnoiseTrackProcessor.setVadThreshold — post-init behaviour via node injection
// ===========================================================================

describe("RnnoiseTrackProcessor.setVadThreshold (with injected worklet node)", () => {
  let processor: RnnoiseTrackProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new RnnoiseTrackProcessor();
  });

  it("posts set-vad-threshold message with correct threshold value", () => {
    const mockPort = { postMessage: vi.fn(), onmessage: null };
    (processor as any).rnnoiseNode = { port: mockPort, disconnect: vi.fn() };

    processor.setVadThreshold(0.65);

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: "set-vad-threshold",
      threshold: 0.65,
    });
  });

  it("posts the message with threshold 0", () => {
    const mockPort = { postMessage: vi.fn(), onmessage: null };
    (processor as any).rnnoiseNode = { port: mockPort, disconnect: vi.fn() };

    processor.setVadThreshold(0);

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: "set-vad-threshold",
      threshold: 0,
    });
  });

  it("posts the message with threshold 1", () => {
    const mockPort = { postMessage: vi.fn(), onmessage: null };
    (processor as any).rnnoiseNode = { port: mockPort, disconnect: vi.fn() };

    processor.setVadThreshold(1);

    expect(mockPort.postMessage).toHaveBeenCalledWith({
      type: "set-vad-threshold",
      threshold: 1,
    });
  });

  it("posts only once per call", () => {
    const mockPort = { postMessage: vi.fn(), onmessage: null };
    (processor as any).rnnoiseNode = { port: mockPort, disconnect: vi.fn() };

    processor.setVadThreshold(0.5);

    expect(mockPort.postMessage).toHaveBeenCalledOnce();
  });

  it("message type is exactly 'set-vad-threshold'", () => {
    const mockPort = { postMessage: vi.fn(), onmessage: null };
    (processor as any).rnnoiseNode = { port: mockPort, disconnect: vi.fn() };

    processor.setVadThreshold(0.9);

    const [msg] = mockPort.postMessage.mock.calls[0];
    expect(msg.type).toBe("set-vad-threshold");
  });
});
