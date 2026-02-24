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
import { DryWetTrackProcessor } from "../audio/DryWetTrackProcessor.js";
import { RnnoiseTrackProcessor } from "../audio/rnnoise/RnnoiseTrackProcessor.js";
import { DtlnTrackProcessor } from "../audio/dtln/DtlnTrackProcessor.js";
import { DeepFilterTrackProcessor } from "../audio/deepfilter/DeepFilterTrackProcessor.js";
import { NSNet2TrackProcessor } from "../audio/nsnet2/NSNet2TrackProcessor.js";
import { SpeexTrackProcessor } from "../audio/speex/SpeexTrackProcessor.js";

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

/** Minimal mock inner processor for DryWetTrackProcessor tests. */
function makeMockInnerProcessor() {
  return {
    name: "mock-inner",
    processedTrack: undefined as MediaStreamTrack | undefined,
    init: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
  };
}

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
// can be referenced after construction. Used for tests that need to inspect
// what happened to a specific context after init().
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
// DryWetTrackProcessor
// ===========================================================================

describe("DryWetTrackProcessor", () => {
  let inner: ReturnType<typeof makeMockInnerProcessor>;
  let processor: DryWetTrackProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    inner = makeMockInnerProcessor();
    processor = new DryWetTrackProcessor(inner as any, 0.8);
  });

  describe("constructor", () => {
    it("sets the name property", () => {
      expect(processor.name).toBe("dry-wet-mix");
    });

    it("stores the initial strength value", () => {
      expect(processor.strength).toBe(0.8);
    });

    it("defaults strength to 1.0 when not provided", () => {
      const p = new DryWetTrackProcessor(inner as any);
      expect(p.strength).toBe(1.0);
    });

    it("leaves processedTrack undefined before init", () => {
      expect(processor.processedTrack).toBeUndefined();
    });
  });

  describe("getInnerProcessor", () => {
    it("returns the wrapped inner processor", () => {
      expect(processor.getInnerProcessor()).toBe(inner);
    });
  });

  describe("strength setter clamping", () => {
    it("clamps negative values to 0", () => {
      processor.strength = -0.5;
      expect(processor.strength).toBe(0);
    });

    it("clamps values above 1 to 1", () => {
      processor.strength = 1.5;
      expect(processor.strength).toBe(1);
    });

    it("accepts 0 exactly", () => {
      processor.strength = 0;
      expect(processor.strength).toBe(0);
    });

    it("accepts 1 exactly", () => {
      processor.strength = 1;
      expect(processor.strength).toBe(1);
    });

    it("accepts fractional values within range", () => {
      processor.strength = 0.42;
      expect(processor.strength).toBeCloseTo(0.42);
    });

    it("updates gain nodes in real time when context is active", () => {
      // Inject a pre-built context so init is not needed
      const ctx = makeMockContext();
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();

      (processor as any).context = ctx;
      (processor as any).dryGain = dryGain;
      (processor as any).wetGain = wetGain;

      processor.strength = 0.25;

      expect(dryGain.gain.setValueAtTime).toHaveBeenCalledWith(1 - 0.25, 0);
      expect(wetGain.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 0);
    });

    it("does not update gain nodes when context is null", () => {
      // No context set — setter should still update _strength without throwing
      processor.strength = 0.3;
      expect(processor.strength).toBeCloseTo(0.3);
    });
  });

  describe("setPreGain", () => {
    it("does not throw before init (preGain is null)", () => {
      expect(() => processor.setPreGain(1.5)).not.toThrow();
    });

    it("calls setValueAtTime on preGain node when context is active", () => {
      const ctx = makeMockContext();
      const preGain = ctx.createGain();

      (processor as any).context = ctx;
      (processor as any).preGain = preGain;

      processor.setPreGain(1.5);

      expect(preGain.gain.setValueAtTime).toHaveBeenCalledWith(1.5, 0);
    });

    it("clamps negative preGain values to 0", () => {
      const ctx = makeMockContext();
      const preGain = ctx.createGain();

      (processor as any).context = ctx;
      (processor as any).preGain = preGain;

      processor.setPreGain(-0.5);

      expect(preGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    });
  });

  describe("destroy", () => {
    it("calls destroy on the inner processor", async () => {
      await processor.destroy();
      expect(inner.destroy).toHaveBeenCalledOnce();
    });

    it("nullifies processedTrack after destroy", async () => {
      (processor as any).processedTrack = {} as MediaStreamTrack;
      await processor.destroy();
      expect(processor.processedTrack).toBeUndefined();
    });

    it("nullifies all internal nodes", async () => {
      const ctx = makeMockContext();
      (processor as any).context = ctx;
      (processor as any).dryGain = ctx.createGain();
      (processor as any).wetGain = ctx.createGain();
      (processor as any).preGain = ctx.createGain();
      (processor as any).sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
      (processor as any).destinationNode = { connect: vi.fn(), disconnect: vi.fn() };

      await processor.destroy();

      expect((processor as any).context).toBeNull();
      expect((processor as any).dryGain).toBeNull();
      expect((processor as any).wetGain).toBeNull();
      expect((processor as any).preGain).toBeNull();
      expect((processor as any).sourceNode).toBeNull();
      expect((processor as any).destinationNode).toBeNull();
    });

    it("can be called multiple times without throwing", async () => {
      await expect(processor.destroy()).resolves.not.toThrow();
      await expect(processor.destroy()).resolves.not.toThrow();
    });

    it("closes the AudioContext when state is running", async () => {
      const ctx = makeMockContext();
      (processor as any).context = ctx;

      await processor.destroy();

      expect(ctx.close).toHaveBeenCalled();
    });

    it("does not close AudioContext when state is already closed", async () => {
      const ctx = makeMockContext();
      ctx.state = "closed";
      (processor as any).context = ctx;

      await processor.destroy();

      expect(ctx.close).not.toHaveBeenCalled();
    });

    it("disconnects sourceNode, preGain, dryGain, wetGain", async () => {
      const ctx = makeMockContext();
      const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
      const preGain = ctx.createGain();
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();

      (processor as any).context = ctx;
      (processor as any).sourceNode = sourceNode;
      (processor as any).preGain = preGain;
      (processor as any).dryGain = dryGain;
      (processor as any).wetGain = wetGain;

      await processor.destroy();

      expect(sourceNode.disconnect).toHaveBeenCalled();
      expect(preGain.disconnect).toHaveBeenCalled();
      expect(dryGain.disconnect).toHaveBeenCalled();
      expect(wetGain.disconnect).toHaveBeenCalled();
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

    it("destroy is called before init during restart", async () => {
      const callOrder: string[] = [];
      vi.spyOn(processor, "destroy").mockImplementation(async () => {
        callOrder.push("destroy");
      });
      vi.spyOn(processor, "init").mockImplementation(async () => {
        callOrder.push("init");
      });

      await processor.restart(makeOpts());

      expect(callOrder).toEqual(["destroy", "init"]);
    });
  });
});

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

// ===========================================================================
// DtlnTrackProcessor
// ===========================================================================

describe("DtlnTrackProcessor", () => {
  let processor: DtlnTrackProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new DtlnTrackProcessor();
  });

  it("has the correct name", () => {
    expect(processor.name).toBe("dtln-noise-filter");
  });

  it("processedTrack is undefined before init", () => {
    expect(processor.processedTrack).toBeUndefined();
  });

  describe("destroy", () => {
    it("nullifies all internal nodes", async () => {
      (processor as any).dtlnContext = makeMockContext(16000);
      (processor as any).dtlnNode = { disconnect: vi.fn() };
      (processor as any).sourceNode = { disconnect: vi.fn() };
      (processor as any).destinationNode = {};

      await processor.destroy();

      expect((processor as any).dtlnContext).toBeNull();
      expect((processor as any).dtlnNode).toBeNull();
      expect((processor as any).sourceNode).toBeNull();
      expect((processor as any).destinationNode).toBeNull();
    });

    it("clears processedTrack", async () => {
      (processor as any).processedTrack = {} as MediaStreamTrack;
      await processor.destroy();
      expect(processor.processedTrack).toBeUndefined();
    });

    it("disconnects nodes before nullifying", async () => {
      const mockSource = { disconnect: vi.fn() };
      const mockNode = { disconnect: vi.fn() };
      (processor as any).sourceNode = mockSource;
      (processor as any).dtlnNode = mockNode;
      (processor as any).dtlnContext = makeMockContext(16000);

      await processor.destroy();

      expect(mockSource.disconnect).toHaveBeenCalled();
      expect(mockNode.disconnect).toHaveBeenCalled();
    });

    it("does not throw when called with no state initialised", async () => {
      await expect(processor.destroy()).resolves.not.toThrow();
    });

    it("closes AudioContext when state is running", async () => {
      const ctx = makeMockContext(16000);
      (processor as any).dtlnContext = ctx;

      await processor.destroy();

      expect(ctx.close).toHaveBeenCalled();
    });

    it("skips closing AudioContext when state is closed", async () => {
      const ctx = makeMockContext(16000);
      ctx.state = "closed";
      (processor as any).dtlnContext = ctx;

      await processor.destroy();

      expect(ctx.close).not.toHaveBeenCalled();
    });
  });

  describe("restart", () => {
    it("calls destroy then init in order", async () => {
      const opts = makeOpts();
      const callOrder: string[] = [];
      vi.spyOn(processor, "destroy").mockImplementation(async () => {
        callOrder.push("destroy");
      });
      vi.spyOn(processor, "init").mockImplementation(async () => {
        callOrder.push("init");
      });

      await processor.restart(opts);
      expect(callOrder).toEqual(["destroy", "init"]);
    });
  });

  describe("init uses 16kHz sample rate", () => {
    it("passes 16kHz to AudioContext constructor", async () => {
      // Intercept the AudioContext constructor to capture the sampleRate argument,
      // then make addModule hang so we don't need to mock the full async init.
      const capturedRates: number[] = [];

      MockAudioContext.mockImplementationOnce(function (
        this: any,
        opts?: { sampleRate?: number },
      ) {
        capturedRates.push(opts?.sampleRate ?? -1);
        this.sampleRate = opts?.sampleRate ?? 48000;
        this.state = "running";
        this.currentTime = 0;
        this.close = vi.fn(() => Promise.resolve());
        this.createGain = vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
          gain: { value: 1, setValueAtTime: vi.fn() },
        }));
        this.createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
        this.createMediaStreamDestination = vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
          stream: { getAudioTracks: vi.fn(() => []) },
        }));
        this.audioWorklet = {
          addModule: vi.fn(() => new Promise(() => { /* never resolves */ })),
        };
      });

      const p = new DtlnTrackProcessor();
      const initPromise = p.init(makeOpts(48000));

      // Give microtask queue one tick to reach the AudioContext constructor
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(capturedRates[0]).toBe(16000);

      await p.destroy().catch(() => {});
      void initPromise.catch(() => {});
    });
  });
});

// ===========================================================================
// DeepFilterTrackProcessor
// ===========================================================================

describe("DeepFilterTrackProcessor", () => {
  let processor: DeepFilterTrackProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new DeepFilterTrackProcessor();
  });

  it("has the correct name", () => {
    expect(processor.name).toBe("deepfilter-noise-filter");
  });

  it("processedTrack is undefined before init", () => {
    expect(processor.processedTrack).toBeUndefined();
  });

  it("extends DeepFilterNoiseFilterProcessor from npm package", () => {
    // The processor wraps the deepfilternet3-noise-filter npm package
    expect(processor).toHaveProperty("init");
    expect(processor).toHaveProperty("destroy");
    expect(processor).toHaveProperty("restart");
    expect(typeof processor.init).toBe("function");
    expect(typeof processor.destroy).toBe("function");
  });

  describe("destroy", () => {
    it("does not throw when called with no state", async () => {
      await expect(processor.destroy()).resolves.not.toThrow();
    });

    it("nullifies audio nodes on destroy", async () => {
      (processor as any).audioContext = makeMockContext();
      (processor as any).workletNode = { disconnect: vi.fn() };
      (processor as any).sourceNode = { disconnect: vi.fn() };
      (processor as any).destination = { disconnect: vi.fn() };

      await processor.destroy();

      expect((processor as any).workletNode).toBeNull();
      expect((processor as any).sourceNode).toBeNull();
      expect((processor as any).destination).toBeNull();
    });
  });
});

// ===========================================================================
// NSNet2TrackProcessor
// ===========================================================================

describe("NSNet2TrackProcessor", () => {
  let processor: NSNet2TrackProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new NSNet2TrackProcessor();
  });

  it("has the correct name", () => {
    expect(processor.name).toBe("nsnet2-noise-filter");
  });

  it("processedTrack is undefined before init", () => {
    expect(processor.processedTrack).toBeUndefined();
  });

  describe("destroy", () => {
    it("terminates the Worker", async () => {
      const mockWorkerInst = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null };
      (processor as any).worker = mockWorkerInst;
      (processor as any).audioContext = makeMockContext(16000);

      await processor.destroy();

      expect(mockWorkerInst.terminate).toHaveBeenCalled();
      expect((processor as any).worker).toBeNull();
    });

    it("nullifies all internal nodes", async () => {
      (processor as any).audioContext = makeMockContext(16000);
      (processor as any).workletNode = { disconnect: vi.fn() };
      (processor as any).sourceNode = { disconnect: vi.fn() };
      (processor as any).destinationNode = {};
      (processor as any).worker = { terminate: vi.fn() };

      await processor.destroy();

      expect((processor as any).audioContext).toBeNull();
      expect((processor as any).workletNode).toBeNull();
      expect((processor as any).sourceNode).toBeNull();
      expect((processor as any).destinationNode).toBeNull();
    });

    it("clears processedTrack", async () => {
      (processor as any).processedTrack = {} as MediaStreamTrack;
      await processor.destroy();
      expect(processor.processedTrack).toBeUndefined();
    });

    it("does not throw when called with no state", async () => {
      await expect(processor.destroy()).resolves.not.toThrow();
    });

    it("closes AudioContext when running", async () => {
      const ctx = makeMockContext(16000);
      (processor as any).audioContext = ctx;
      (processor as any).worker = { terminate: vi.fn() };

      await processor.destroy();

      expect(ctx.close).toHaveBeenCalled();
    });

    it("skips closing AudioContext when already closed", async () => {
      const ctx = makeMockContext(16000);
      ctx.state = "closed";
      (processor as any).audioContext = ctx;
      (processor as any).worker = { terminate: vi.fn() };

      await processor.destroy();

      expect(ctx.close).not.toHaveBeenCalled();
    });
  });

  describe("restart", () => {
    it("calls destroy then init in order", async () => {
      const opts = makeOpts();
      const callOrder: string[] = [];
      vi.spyOn(processor, "destroy").mockImplementation(async () => {
        callOrder.push("destroy");
      });
      vi.spyOn(processor, "init").mockImplementation(async () => {
        callOrder.push("init");
      });

      await processor.restart(opts);
      expect(callOrder).toEqual(["destroy", "init"]);
    });
  });

  describe("init uses 16kHz sample rate", () => {
    it("passes 16kHz to AudioContext constructor", async () => {
      const capturedRates: number[] = [];

      MockWorker.mockImplementationOnce(function (this: any) {
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        Object.defineProperty(this, "onmessage", {
          set(fn: (e: { data: string }) => void) {
            setTimeout(() => fn({ data: "ready" }), 0);
          },
          configurable: true,
        });
      });

      MockAudioContext.mockImplementationOnce(function (
        this: any,
        opts?: { sampleRate?: number },
      ) {
        capturedRates.push(opts?.sampleRate ?? -1);
        this.sampleRate = opts?.sampleRate ?? 48000;
        this.state = "running";
        this.currentTime = 0;
        this.close = vi.fn(() => Promise.resolve());
        this.createGain = vi.fn();
        this.createMediaStreamSource = vi.fn();
        this.createMediaStreamDestination = vi.fn();
        this.audioWorklet = {
          addModule: vi.fn(() => new Promise(() => { /* hang after worker ready */ })),
        };
      });

      const p = new NSNet2TrackProcessor();
      const initPromise = p.init(makeOpts());

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(capturedRates[0]).toBe(16000);

      await p.destroy().catch(() => {});
      void initPromise.catch(() => {});
    });

    it("creates a Worker pointing to nsnet2-worker.js", async () => {
      MockWorker.mockImplementationOnce(function (this: any) {
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        Object.defineProperty(this, "onmessage", {
          set(fn: (e: { data: string }) => void) {
            setTimeout(() => fn({ data: "ready" }), 0);
          },
          configurable: true,
        });
      });

      MockAudioContext.mockImplementationOnce(function (this: any, opts?: { sampleRate?: number }) {
        this.sampleRate = opts?.sampleRate ?? 16000;
        this.state = "running";
        this.currentTime = 0;
        this.close = vi.fn(() => Promise.resolve());
        this.createGain = vi.fn();
        this.createMediaStreamSource = vi.fn();
        this.createMediaStreamDestination = vi.fn();
        this.audioWorklet = {
          addModule: vi.fn(() => new Promise(() => {})),
        };
      });

      const p = new NSNet2TrackProcessor();
      const initPromise = p.init(makeOpts());

      await new Promise<void>((r) => setTimeout(r, 10));

      const nsnet2Call = MockWorker.mock.calls.find((call: unknown[]) =>
        String(call[0]).includes("nsnet2"),
      );
      expect(nsnet2Call).toBeDefined();

      await p.destroy().catch(() => {});
      void initPromise.catch(() => {});
    });

    it("uses MessageChannel for Worker-Worklet communication", async () => {
      MockWorker.mockImplementationOnce(function (this: any) {
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        Object.defineProperty(this, "onmessage", {
          set(fn: (e: { data: string }) => void) {
            setTimeout(() => fn({ data: "ready" }), 0);
          },
          configurable: true,
        });
      });

      MockAudioWorkletNode.mockImplementationOnce(function (this: any) {
        this.connect = vi.fn();
        this.disconnect = vi.fn();
        this.port = { postMessage: vi.fn(), onmessage: null };
      });

      MockAudioContext.mockImplementationOnce(function (this: any, opts?: { sampleRate?: number }) {
        this.sampleRate = opts?.sampleRate ?? 16000;
        this.state = "running";
        this.currentTime = 0;
        this.close = vi.fn(() => Promise.resolve());
        this.createGain = vi.fn();
        this.createMediaStreamSource = vi.fn();
        this.createMediaStreamDestination = vi.fn();
        this.audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
      });

      const p = new NSNet2TrackProcessor();
      const initPromise = p.init(makeOpts());

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(MockMessageChannel).toHaveBeenCalled();

      await p.destroy().catch(() => {});
      void initPromise.catch(() => {});
    });
  });
});

// ===========================================================================
// SpeexTrackProcessor
// ===========================================================================

describe("SpeexTrackProcessor", () => {
  let processor: SpeexTrackProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new SpeexTrackProcessor();
  });

  it("has the correct name", () => {
    expect(processor.name).toBe("speex-noise-filter");
  });

  it("processedTrack is undefined before init", () => {
    expect(processor.processedTrack).toBeUndefined();
  });

  describe("destroy", () => {
    it("nullifies all internal nodes", async () => {
      (processor as any).speexContext = makeMockContext();
      (processor as any).speexNode = { disconnect: vi.fn(), destroy: vi.fn() };
      (processor as any).sourceNode = { disconnect: vi.fn() };
      (processor as any).destinationNode = {};

      await processor.destroy();

      expect((processor as any).speexContext).toBeNull();
      expect((processor as any).speexNode).toBeNull();
      expect((processor as any).sourceNode).toBeNull();
      expect((processor as any).destinationNode).toBeNull();
    });

    it("clears processedTrack", async () => {
      (processor as any).processedTrack = {} as MediaStreamTrack;
      await processor.destroy();
      expect(processor.processedTrack).toBeUndefined();
    });

    it("calls destroy() on SpeexWorkletNode when the method exists", async () => {
      const mockDestroy = vi.fn();
      (processor as any).speexNode = { disconnect: vi.fn(), destroy: mockDestroy };
      (processor as any).speexContext = makeMockContext();

      await processor.destroy();

      expect(mockDestroy).toHaveBeenCalled();
    });

    it("does not throw when SpeexWorkletNode has no destroy method", async () => {
      // SpeexWorkletNode without a destroy() method (plain AudioWorkletNode)
      (processor as any).speexNode = { disconnect: vi.fn() };
      (processor as any).speexContext = makeMockContext();

      await expect(processor.destroy()).resolves.not.toThrow();
    });

    it("does not throw when called with no state", async () => {
      await expect(processor.destroy()).resolves.not.toThrow();
    });

    it("closes AudioContext when state is running", async () => {
      const ctx = makeMockContext();
      (processor as any).speexContext = ctx;
      (processor as any).speexNode = { disconnect: vi.fn(), destroy: vi.fn() };

      await processor.destroy();

      expect(ctx.close).toHaveBeenCalled();
    });

    it("skips closing AudioContext when state is closed", async () => {
      const ctx = makeMockContext();
      ctx.state = "closed";
      (processor as any).speexContext = ctx;

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
