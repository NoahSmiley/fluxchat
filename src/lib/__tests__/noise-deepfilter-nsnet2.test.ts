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
import { DeepFilterTrackProcessor } from "@/lib/audio/deepfilter/DeepFilterTrackProcessor.js";
import { NSNet2TrackProcessor } from "@/lib/audio/nsnet2/NSNet2TrackProcessor.js";

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
