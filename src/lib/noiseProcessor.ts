import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// Noise Suppression Processors
//
// Three tiers:
// - "standard":  RNNoise via AudioWorklet (lightweight, proven)
// - "enhanced":  DeepFilterNet3 via LiveKit TrackProcessor (heavier, higher quality)
// - "dtln":      DTLN via ScriptProcessorNode (Datadog's open-source LSTM)
// ═══════════════════════════════════════════════════════════════════

/**
 * RNNoise AudioWorklet processor.
 * Intercepts the raw mic MediaStreamTrack, routes it through the RNNoise
 * worklet, and returns a processed track that replaces the LiveKit mic track.
 */
export class RnnoiseProcessor {
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;

  async init(inputTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
    await this.destroy();

    const { RnnoiseWorkletNode, loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");
    const rnnoiseWorkletPath = (await import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url")).default;
    const rnnoiseWasmPath = (await import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url")).default;
    const rnnoiseSimdWasmPath = (await import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url")).default;

    this.ctx = new AudioContext({ sampleRate: 48000 });

    const wasmBinary = await loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseSimdWasmPath });
    await this.ctx.audioWorklet.addModule(rnnoiseWorkletPath);

    this.source = this.ctx.createMediaStreamSource(new MediaStream([inputTrack]));
    this.worklet = new RnnoiseWorkletNode(this.ctx, { maxChannels: 2, wasmBinary });
    this.destination = this.ctx.createMediaStreamDestination();

    this.source.connect(this.worklet);
    this.worklet.connect(this.destination);

    dbg("voice", "RnnoiseProcessor initialized");
    return this.destination.stream.getAudioTracks()[0];
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    if (this.worklet && "destroy" in this.worklet) {
      (this.worklet as any).destroy();
    }
    this.worklet?.disconnect();
    this.destination?.disconnect();
    await this.ctx?.close().catch(() => {});
    this.source = null;
    this.worklet = null;
    this.destination = null;
    this.ctx = null;
    dbg("voice", "RnnoiseProcessor destroyed");
  }
}

/**
 * DeepFilterNet3 processor using LiveKit's TrackProcessor interface.
 * Attaches directly to the LocalTrackPublication via setProcessor().
 */
export class DeepFilterProcessor {
  private processor: any = null;

  async attach(micPublication: any): Promise<void> {
    await this.detach(micPublication);

    const { DeepFilterNoiseFilterProcessor } = await import("deepfilternet3-noise-filter");
    this.processor = new DeepFilterNoiseFilterProcessor({
      sampleRate: 48000,
      noiseReductionLevel: 50, // Conservative — avoids speech distortion
    });

    await micPublication.track.setProcessor(this.processor);
    dbg("voice", "DeepFilterProcessor attached");
  }

  async detach(micPublication?: any): Promise<void> {
    if (this.processor) {
      try {
        if (micPublication?.track) {
          await micPublication.track.stopProcessor();
        }
      } catch (e) {
        dbg("voice", "DeepFilterProcessor stopProcessor error (may be already stopped)", e);
      }
      try {
        await this.processor.destroy();
      } catch {}
      this.processor = null;
      dbg("voice", "DeepFilterProcessor detached");
    }
  }
}

/**
 * Load the DTLN Emscripten bundle and wait for WASM to be fully initialized.
 * The bundle sets `var Module` and `var DtlnPlugin` at global scope.
 * Module.postRun fires DtlnPlugin.postRun callbacks when ready.
 */
let dtlnPluginPromise: Promise<any> | null = null;
export function loadDtlnPlugin(): Promise<any> {
  if (dtlnPluginPromise) return dtlnPluginPromise;
  dtlnPluginPromise = (async () => {
    const g = globalThis as any;

    // If already loaded and ready (e.g. from Audio Test tab), reuse
    if (g._dtlnPlugin?.dtln_create) {
      try {
        const t = g._dtlnPlugin.dtln_create();
        if (t) { g._dtlnPlugin.dtln_destroy(t); return g._dtlnPlugin; }
      } catch { /* not ready yet */ }
    }

    dbg("voice", "Fetching /dtln/dtln.js...");
    const resp = await fetch("/dtln/dtln.js");
    if (!resp.ok) throw new Error(`Failed to fetch /dtln/dtln.js: ${resp.status}`);
    const code = await resp.text();

    // The Emscripten bundle ends with:
    //   var DtlnPlugin = {...};
    //   if (typeof module !== "undefined") { module.exports = DtlnPlugin }
    //   globalThis.DtlnPlugin = DtlnPlugin;
    //   Module.postRun = [...];
    //
    // WebKit's eval rejects `var DtlnPlugin` if globalThis.DtlnPlugin already
    // exists ("Can't create duplicate variable in eval"). To avoid this, we
    // wrap the code in a Function so `var` declarations stay local to that
    // function scope. We provide a fake `module` object so the
    // `module.exports = DtlnPlugin` line captures the plugin for us.
    const fakeModule: any = { exports: null };
    const wrapper = new Function("module", code);
    wrapper(fakeModule);
    dbg("voice", `DTLN script evaluated. fakeModule.exports=${!!fakeModule.exports}, g.DtlnPlugin=${!!g.DtlnPlugin}`);

    // The DtlnPlugin is available either via our fake module.exports
    // or via globalThis.DtlnPlugin (set by the patched script).
    // Wait for WASM to initialize (dtln_create becomes functional).
    const plugin: any = await new Promise<any>((resolve, reject) => {
      let resolved = false;
      const getPlugin = () => fakeModule.exports ?? g.DtlnPlugin ?? g._dtlnPlugin;
      const tryResolve = () => {
        if (resolved) return false;
        const p = getPlugin();
        if (!p?.dtln_create) return false;
        try {
          const t = p.dtln_create();
          if (!t) return false;
          // Verify HEAPF32 is available (dtln_denoise needs Module.HEAPF32)
          p.dtln_denoise(t, new Float32Array(512), new Float32Array(512));
          p.dtln_destroy(t);
          dbg("voice", "DTLN tryResolve passed full denoise test");
          resolved = true; g._dtlnPlugin = p; resolve(p); return true;
        } catch (e: any) {
          dbg("voice", `DTLN tryResolve failed: ${e?.message ?? e}`);
          return false;
        }
      };

      // Try immediately
      if (tryResolve()) return;

      // Register postRun callback on the plugin if available
      const p = getPlugin();
      if (p) {
        const prev = Array.isArray(p.postRun) ? p.postRun : [];
        p.postRun = [...prev, () => tryResolve()];
      }

      // Poll as fallback every 100ms for up to 15s
      let attempts = 0;
      const interval = setInterval(() => {
        tryResolve();
        if (resolved || ++attempts > 150) {
          clearInterval(interval);
          if (!resolved) { dtlnPluginPromise = null; reject(new Error("DTLN WASM initialization timed out")); }
        }
      }, 100);
    });

    dbg("voice", "DTLN WASM ready");
    return plugin;
  })();
  dtlnPluginPromise.catch(() => { dtlnPluginPromise = null; });
  return dtlnPluginPromise;
}

/**
 * DTLN (Dual-Signal Transformation LSTM) processor.
 * Uses Datadog's open-source dtln-rs compiled to WASM.
 * Operates at 16kHz with 512-sample frames (~32ms latency).
 * Routes through ScriptProcessorNode on the main thread to avoid
 * AudioWorklet structured-clone issues in WKWebView.
 *
 * The Emscripten bundle exposes a DtlnPlugin global with:
 *   dtln_create() → handle
 *   dtln_denoise(handle, inputF32, outputF32) — 512 samples at 16kHz
 *   dtln_destroy(handle)
 */
export class DtlnProcessor {
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private dtlnHandle: number | null = null;
  private dtlnPlugin: any = null;

  // Ring buffer for 16kHz frame accumulation
  private inBuffer = new Float32Array(0);
  private inWritePos = 0;

  async init(inputTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
    await this.destroy();

    this.dtlnPlugin = await loadDtlnPlugin();

    const plugin = this.dtlnPlugin;
    this.dtlnHandle = plugin.dtln_create();
    if (!this.dtlnHandle) throw new Error("dtln_create returned null");

    const FRAME = 512; // DTLN frame size at 16kHz

    // Pre-allocate buffers
    this.inBuffer = new Float32Array(FRAME * 2);
    this.inWritePos = 0;
    const frameIn = new Float32Array(FRAME);
    const frameOut = new Float32Array(FRAME);

    // Run the entire pipeline at 16kHz — the browser's native resampler
    // handles 48kHz→16kHz (input) and 16kHz→48kHz (output from the
    // returned MediaStreamTrack consumed by LiveKit/WebRTC at 48kHz).
    // This avoids manual resampling artifacts entirely.
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.source = this.ctx.createMediaStreamSource(new MediaStream([inputTrack]));
    this.destination = this.ctx.createMediaStreamDestination();

    // At 16kHz, ScriptProcessor with bufferSize=512 gives us exactly
    // one DTLN frame per callback — no ring buffer needed for output.
    // Use 256 for lower latency (accumulate 2 callbacks into 1 frame).
    this.scriptNode = this.ctx.createScriptProcessor(FRAME, 1, 1);

    this.scriptNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);

      // Accumulate input samples
      for (let i = 0; i < input.length; i++) {
        this.inBuffer[this.inWritePos++] = input[i];
      }

      // Process complete DTLN frames
      let outPos = 0;
      while (this.inWritePos >= FRAME) {
        frameIn.set(this.inBuffer.subarray(0, FRAME));
        plugin.dtln_denoise(this.dtlnHandle, frameIn, frameOut);

        // Copy processed frame to output
        const toCopy = Math.min(FRAME, output.length - outPos);
        output.set(frameOut.subarray(0, toCopy), outPos);
        outPos += toCopy;

        // Shift remaining input
        const remaining = this.inWritePos - FRAME;
        if (remaining > 0) {
          this.inBuffer.copyWithin(0, FRAME, this.inWritePos);
        }
        this.inWritePos = remaining;
      }

      // Zero-fill any remaining output (underrun)
      for (let i = outPos; i < output.length; i++) {
        output[i] = 0;
      }
    };

    this.source.connect(this.scriptNode);
    this.scriptNode.connect(this.destination);

    dbg("voice", "DtlnProcessor initialized (16kHz native)");
    return this.destination.stream.getAudioTracks()[0];
  }

  async destroy(): Promise<void> {
    this.source?.disconnect();
    this.scriptNode?.disconnect();
    this.destination?.disconnect();
    if (this.dtlnHandle !== null && this.dtlnPlugin) {
      try { this.dtlnPlugin.dtln_destroy(this.dtlnHandle); } catch {}
    }
    await this.ctx?.close().catch(() => {});
    this.source = null;
    this.scriptNode = null;
    this.destination = null;
    this.ctx = null;
    this.dtlnHandle = null;
    this.dtlnPlugin = null;
    this.inWritePos = 0;
    dbg("voice", "DtlnProcessor destroyed");
  }
}

