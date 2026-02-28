import { useState, useRef, useEffect, useCallback } from "react";
import { audioBufferToWav } from "@/components/music/SoundboardWaveform.js";
import {
  computeRms,
  computePeak,
  computeCrestFactor,
  estimateSnr,
  computeSpectrogram,
} from "@/lib/audioAnalysis.js";
import { loadDtlnPlugin } from "@/lib/noiseProcessor.js";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface Metrics {
  rmsDb: number;
  peak: number;
  crestDb: number;
  snrDb: number;
}

interface EffectSettings {
  rnnoise: boolean;
  deepfilter: boolean;
  deepfilterLevel: number;
  dtln: boolean;
  vad: boolean;
  vadSensitivity: number;
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function computeMetrics(buffer: AudioBuffer): Metrics {
  const samples = buffer.getChannelData(0);
  const rms = computeRms(samples);
  const peak = computePeak(samples);
  return {
    rmsDb: rms.db,
    peak,
    crestDb: computeCrestFactor(peak, rms.linear),
    snrDb: estimateSnr(samples),
  };
}

function fmt(val: number): string {
  if (!isFinite(val)) return "-\u221E";
  return val.toFixed(1);
}

function viridisColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));
  return [
    Math.round(255 * Math.min(1, Math.max(0, -0.35 + 3.0 * c - 2.0 * c * c))),
    Math.round(255 * Math.min(1, Math.max(0, -0.1 + 1.5 * c))),
    Math.round(255 * Math.min(1, Math.max(0, 0.5 + 0.8 * c - 1.8 * c * c))),
  ];
}

/** Build a stereo WAV Blob from an AudioBuffer (mono gets duplicated to both channels). */
function bufferToStereoWavBlob(buffer: AudioBuffer): Blob {
  if (buffer.numberOfChannels >= 2) return audioBufferToWav(buffer);
  const stereo = new AudioBuffer({
    numberOfChannels: 2,
    length: buffer.length,
    sampleRate: buffer.sampleRate,
  });
  const mono = buffer.getChannelData(0);
  stereo.getChannelData(0).set(mono);
  stereo.getChannelData(1).set(mono);
  return audioBufferToWav(stereo);
}

// ═══════════════════════════════════════════════════════════════════
// Recording — capture mic into an AudioBuffer via ScriptProcessor
// ═══════════════════════════════════════════════════════════════════

async function captureRaw(
  durationSec: number,
  deviceId: string,
  log: (msg: string) => void,
): Promise<AudioBuffer> {
  log("Getting mic stream...");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: { ideal: 48000 },
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });

  const ctx = new AudioContext({ sampleRate: 48000 });
  if (ctx.state === "suspended") await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const sampleRate = ctx.sampleRate;
  const totalSamples = Math.ceil(sampleRate * durationSec);
  const captured = new Float32Array(totalSamples);
  let writePos = 0;

  log(`Recording ${durationSec}s at ${sampleRate}Hz...`);

  return new Promise<AudioBuffer>((resolve, reject) => {
    // ScriptProcessorNode: deprecated but reliable for sample-level capture
    const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const remaining = totalSamples - writePos;
      if (remaining <= 0) return;
      const toCopy = Math.min(input.length, remaining);
      captured.set(input.subarray(0, toCopy), writePos);
      writePos += toCopy;
    };

    source.connect(scriptNode);
    scriptNode.connect(ctx.destination); // must connect to destination for onaudioprocess to fire

    setTimeout(() => {
      source.disconnect();
      scriptNode.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});

      const actualSamples = Math.min(writePos, totalSamples);
      log(`Captured ${actualSamples} samples (${(actualSamples / sampleRate).toFixed(1)}s)`);

      if (actualSamples < sampleRate * 0.5) {
        reject(new Error("Almost no audio captured"));
        return;
      }

      const buf = new AudioBuffer({
        numberOfChannels: 1,
        length: actualSamples,
        sampleRate,
      });
      buf.getChannelData(0).set(captured.subarray(0, actualSamples));
      resolve(buf);
    }, durationSec * 1000 + 200);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Processing — use the same pattern as production voice pipeline:
// Play buffer → MediaStreamDestination → get a real MediaStreamTrack →
// Feed through processor (exactly like production) → capture output track
// via a second ScriptProcessor
// ═══════════════════════════════════════════════════════════════════

/**
 * Capture a MediaStreamTrack's audio into a Float32Array via ScriptProcessor.
 * Returns when `durationSec` has elapsed.
 */
function captureTrack(
  track: MediaStreamTrack,
  sampleRate: number,
  durationSec: number,
  log: (msg: string) => void,
): Promise<AudioBuffer> {
  return new Promise((resolve) => {
    const ctx = new AudioContext({ sampleRate });
    if (ctx.state === "suspended") ctx.resume();

    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const totalSamples = Math.ceil(sampleRate * durationSec) + sampleRate; // +1s padding
    const captured = new Float32Array(totalSamples);
    let writePos = 0;

    const scriptNode = ctx.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      const remaining = totalSamples - writePos;
      if (remaining <= 0) return;
      const toCopy = Math.min(data.length, remaining);
      captured.set(data.subarray(0, toCopy), writePos);
      writePos += toCopy;
    };

    source.connect(scriptNode);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    scriptNode.connect(silentGain);
    silentGain.connect(ctx.destination);

    setTimeout(() => {
      source.disconnect();
      scriptNode.disconnect();
      silentGain.disconnect();
      ctx.close().catch(() => {});

      // Trim trailing silence
      let endPos = writePos;
      while (endPos > 0 && Math.abs(captured[endPos - 1]) < 1e-8) endPos--;
      const trimmed = Math.max(endPos, Math.floor(sampleRate * 0.1));
      log(`Captured output: ${trimmed} samples (${(trimmed / sampleRate).toFixed(1)}s)`);

      const buf = new AudioBuffer({ numberOfChannels: 1, length: trimmed, sampleRate });
      buf.getChannelData(0).set(captured.subarray(0, trimmed));
      resolve(buf);
    }, durationSec * 1000 + 800); // extra 800ms for worklet latency flush
  });
}

async function applyRnnoise(input: AudioBuffer, log: (msg: string) => void): Promise<AudioBuffer> {
  log("Loading RNNoise WASM...");
  const { RnnoiseWorkletNode, loadRnnoise } = await import("@sapphi-red/web-noise-suppressor");
  const workletPath = (await import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url")).default;
  const wasmPath = (await import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url")).default;
  const simdPath = (await import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url")).default;
  const wasmBinary = await loadRnnoise({ url: wasmPath, simdUrl: simdPath });

  // Create AudioContext and play the buffer into a real MediaStreamTrack
  const playCtx = new AudioContext({ sampleRate: input.sampleRate });
  if (playCtx.state === "suspended") await playCtx.resume();

  const source = playCtx.createBufferSource();
  source.buffer = input;
  const playDest = playCtx.createMediaStreamDestination();
  source.connect(playDest);
  const inputTrack = playDest.stream.getAudioTracks()[0];

  // Set up RNNoise exactly like production (noiseProcessor.ts RnnoiseProcessor.init)
  const procCtx = new AudioContext({ sampleRate: 48000 });
  if (procCtx.state === "suspended") await procCtx.resume();
  await procCtx.audioWorklet.addModule(workletPath);

  const procSource = procCtx.createMediaStreamSource(new MediaStream([inputTrack]));
  const worklet = new RnnoiseWorkletNode(procCtx, { maxChannels: 2, wasmBinary });
  const procDest = procCtx.createMediaStreamDestination();
  procSource.connect(worklet);
  worklet.connect(procDest);
  const processedTrack = procDest.stream.getAudioTracks()[0];

  log("RNNoise ready, processing in real-time...");
  source.start();

  // Capture the processed track's audio
  const result = await captureTrack(processedTrack, input.sampleRate, input.duration, log);

  // Cleanup
  source.disconnect();
  procSource.disconnect();
  if ("destroy" in worklet) (worklet as any).destroy();
  worklet.disconnect();
  procDest.disconnect();
  playDest.disconnect();
  inputTrack.stop();
  processedTrack.stop();
  playCtx.close().catch(() => {});
  procCtx.close().catch(() => {});

  log("RNNoise done");
  return result;
}

/**
 * DeepFilter main-thread processing.
 *
 * Safari/WKWebView can't structured-clone WebAssembly.Module to AudioWorklet
 * threads, so the worklet silently falls back to passthrough. Instead, we
 * evaluate the library's own worklet code on the main thread — this uses the
 * exact same wasm-bindgen glue that the library was built with, avoiding any
 * discrepancies from hand-replication.
 */
async function applyDeepFilter(input: AudioBuffer, level: number, log: (msg: string) => void): Promise<AudioBuffer> {
  log(`Loading DeepFilterNet3 (level=${level} dB)...`);
  const { DeepFilterNet3Core } = await import("deepfilternet3-noise-filter");

  // Assets are fetched via /deepfilter-cdn proxy (Vite dev proxy + Rust backend proxy)
  // to avoid CORS issues with direct CDN fetch in Tauri's webview.
  const core = new DeepFilterNet3Core({
    sampleRate: 48000,
    noiseReductionLevel: level,
    assetConfig: { cdnUrl: "/deepfilter-cdn" },
  });
  await core.initialize();

  const assets = (core as any).assets as { wasmModule: WebAssembly.Module; modelBytes: ArrayBuffer };
  if (!assets?.wasmModule || !assets?.modelBytes) {
    throw new Error("DeepFilter assets not available after initialize()");
  }
  log("WASM + model fetched, initializing on main thread...");

  const dfModule = createDeepFilterModule(assets.wasmModule, assets.modelBytes, level);
  const frameLength = dfModule.frameLength;
  log(`DeepFilter ready: frame=${frameLength} samples, processing...`);

  // Process frame-by-frame
  const samples = input.getChannelData(0);
  const output = new Float32Array(samples.length);
  let readPos = 0;
  let writePos = 0;
  let framesProcessed = 0;

  while (readPos + frameLength <= samples.length) {
    const frame = new Float32Array(frameLength);
    frame.set(samples.subarray(readPos, readPos + frameLength));

    const processed = dfModule.processFrame(frame);
    output.set(processed, writePos);
    readPos += frameLength;
    writePos += frameLength;
    framesProcessed++;
  }

  // Copy remaining tail as-is
  if (readPos < samples.length) {
    output.set(samples.subarray(readPos), writePos);
    writePos += samples.length - readPos;
  }

  dfModule.destroy();
  core.destroy();
  log(`DeepFilter done: ${framesProcessed} frames processed`);

  const buf = new AudioBuffer({
    numberOfChannels: 1,
    length: writePos,
    sampleRate: input.sampleRate,
  });
  buf.getChannelData(0).set(output.subarray(0, writePos));
  return buf;
}

/**
 * Create a self-contained DeepFilter processing module on the main thread.
 *
 * Evaluates a modified version of the library's worklet code string directly
 * on the main thread. This guarantees bit-identical wasm-bindgen glue —
 * the exact same heap management, import functions, and JS wrappers that the
 * library was built and tested with. No hand-replication needed.
 */
function createDeepFilterModule(
  wasmModule: WebAssembly.Module,
  modelBytes: ArrayBuffer,
  suppressionLevel: number,
) {
  // ── wasm-bindgen heap (identical to worklet code) ──
  let wasm: any;
  const heap: any[] = new Array(128).fill(undefined);
  heap.push(undefined, null, true, false);
  let heap_next = heap.length;

  function getObject(idx: number) { return heap[idx]; }
  function dropObject(idx: number) { if (idx < 132) return; heap[idx] = heap_next; heap_next = idx; }
  function takeObject(idx: number) { const ret = getObject(idx); dropObject(idx); return ret; }
  function addHeapObject(obj: any): number {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];
    heap[idx] = obj;
    return idx;
  }

  let cachedUint8Memory: Uint8Array | null = null;
  let cachedFloat32Memory: Float32Array | null = null;

  function getUint8Memory() {
    if (cachedUint8Memory === null || cachedUint8Memory.byteLength === 0)
      cachedUint8Memory = new Uint8Array(wasm.memory.buffer);
    return cachedUint8Memory;
  }
  function getFloat32Memory() {
    if (cachedFloat32Memory === null || cachedFloat32Memory.byteLength === 0)
      cachedFloat32Memory = new Float32Array(wasm.memory.buffer);
    return cachedFloat32Memory;
  }
  function getStringFromWasm(ptr: number, len: number) {
    ptr = ptr >>> 0;
    return new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(
      getUint8Memory().subarray(ptr, ptr + len)
    );
  }

  let WASM_VECTOR_LEN = 0;
  function passArray8ToWasm(arg: Uint8Array, malloc: any) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8Memory().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
  }
  function passArrayF32ToWasm(arg: Float32Array, malloc: any) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32Memory().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
  }

  // Use `function` keyword (not arrow) so `arguments` is available — matches worklet code
  function handleError(f: Function, args: IArguments | any[]) {
    try { return f.apply(null, args); } catch (e: any) { wasm.__wbindgen_exn_store(addHeapObject(e)); }
  }

  // ── WASM imports ──
  // CRITICAL: imports that use `arguments` must be regular `function` declarations,
  // NOT arrow functions. Arrow functions don't have their own `arguments` binding,
  // which breaks the wasm-bindgen calling convention for multi-arg imports.
  const imports: any = { wbg: {} };
  const wbg = imports.wbg;

  wbg.__wbindgen_object_drop_ref = function(arg0: number) { takeObject(arg0); };
  wbg.__wbg_crypto_566d7465cdbb6b7a = function(arg0: number) {
    const ret = getObject(arg0).crypto; return addHeapObject(ret);
  };
  wbg.__wbindgen_is_object = function(arg0: number) {
    const val = getObject(arg0); const ret = typeof val === "object" && val !== null; return ret;
  };
  wbg.__wbg_process_dc09a8c7d59982f6 = function(arg0: number) {
    const ret = getObject(arg0).process; return addHeapObject(ret);
  };
  wbg.__wbg_versions_d98c6400c6ca2bd8 = function(arg0: number) {
    const ret = getObject(arg0).versions; return addHeapObject(ret);
  };
  wbg.__wbg_node_caaf83d002149bd5 = function(arg0: number) {
    const ret = getObject(arg0).node; return addHeapObject(ret);
  };
  wbg.__wbindgen_is_string = function(arg0: number) {
    const ret = typeof getObject(arg0) === "string"; return ret;
  };
  // Use handleError + arguments — MUST be a regular function
  wbg.__wbg_require_94a9da52636aacbf = function() {
    return handleError(function() {
      // In browser context, `module` is not defined — this is expected to throw.
      // The WASM code handles this gracefully via the handleError wrapper.
      const ret = (globalThis as any).module?.require;
      return addHeapObject(ret);
    }, arguments);
  };
  wbg.__wbindgen_is_function = function(arg0: number) {
    const ret = typeof getObject(arg0) === "function"; return ret;
  };
  wbg.__wbindgen_string_new = function(arg0: number, arg1: number) {
    const ret = getStringFromWasm(arg0, arg1); return addHeapObject(ret);
  };
  wbg.__wbg_msCrypto_0b84745e9245cdf6 = function(arg0: number) {
    const ret = (getObject(arg0) as any).msCrypto; return addHeapObject(ret);
  };
  wbg.__wbg_randomFillSync_290977693942bf03 = function() {
    return handleError(function(arg0: number, arg1: number) {
      getObject(arg0).randomFillSync(takeObject(arg1));
    }, arguments);
  };
  wbg.__wbg_getRandomValues_260cc23a41afad9a = function() {
    return handleError(function(arg0: number, arg1: number) {
      getObject(arg0).getRandomValues(getObject(arg1));
    }, arguments);
  };
  wbg.__wbg_newnoargs_e258087cd0daa0ea = function(arg0: number, arg1: number) {
    const ret = new Function(getStringFromWasm(arg0, arg1)); return addHeapObject(ret);
  };
  wbg.__wbg_new_63b92bc8671ed464 = function(arg0: number) {
    const ret = new Uint8Array(getObject(arg0)); return addHeapObject(ret);
  };
  wbg.__wbg_new_9efabd6b6d2ce46d = function(arg0: number) {
    const ret = new Float32Array(getObject(arg0)); return addHeapObject(ret);
  };
  wbg.__wbg_buffer_12d079cc21e14bdb = function(arg0: number) {
    const ret = getObject(arg0).buffer; return addHeapObject(ret);
  };
  wbg.__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb = function(arg0: number, arg1: number, arg2: number) {
    const ret = new Uint8Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0); return addHeapObject(ret);
  };
  wbg.__wbg_newwithlength_e9b4878cebadb3d3 = function(arg0: number) {
    const ret = new Uint8Array(arg0 >>> 0); return addHeapObject(ret);
  };
  wbg.__wbg_set_a47bac70306a19a7 = function(arg0: number, arg1: number, arg2: number) {
    getObject(arg0).set(getObject(arg1), arg2 >>> 0);
  };
  wbg.__wbg_subarray_a1f73cd4b5b42fe1 = function(arg0: number, arg1: number, arg2: number) {
    const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0); return addHeapObject(ret);
  };
  wbg.__wbg_newwithbyteoffsetandlength_4a659d079a1650e0 = function(arg0: number, arg1: number, arg2: number) {
    const ret = new Float32Array(getObject(arg0), arg1 >>> 0, arg2 >>> 0); return addHeapObject(ret);
  };
  wbg.__wbg_self_ce0dbfc45cf2f5be = function() {
    return handleError(function() {
      const ret = self.self; return addHeapObject(ret);
    }, arguments);
  };
  wbg.__wbg_window_c6fb939a7f436783 = function() {
    return handleError(function() {
      const ret = (window as any).window; return addHeapObject(ret);
    }, arguments);
  };
  wbg.__wbg_globalThis_d1e6af4856ba331b = function() {
    return handleError(function() {
      const ret = globalThis.globalThis; return addHeapObject(ret);
    }, arguments);
  };
  wbg.__wbg_global_207b558942527489 = function() {
    return handleError(function() {
      const ret = (globalThis as any).global; return addHeapObject(ret);
    }, arguments);
  };
  wbg.__wbindgen_is_undefined = function(arg0: number) {
    const ret = getObject(arg0) === undefined; return ret;
  };
  wbg.__wbg_call_27c0f87801dedf93 = function() {
    return handleError(function(arg0: number, arg1: number) {
      const ret = getObject(arg0).call(getObject(arg1)); return addHeapObject(ret);
    }, arguments);
  };
  wbg.__wbindgen_object_clone_ref = function(arg0: number) {
    const ret = getObject(arg0); return addHeapObject(ret);
  };
  wbg.__wbg_call_b3ca7c6051f9bec1 = function() {
    return handleError(function(arg0: number, arg1: number, arg2: number) {
      const ret = getObject(arg0).call(getObject(arg1), getObject(arg2)); return addHeapObject(ret);
    }, arguments);
  };
  wbg.__wbindgen_memory = function() {
    const ret = wasm.memory; return addHeapObject(ret);
  };
  wbg.__wbindgen_throw = function(arg0: number, arg1: number) {
    throw new Error(getStringFromWasm(arg0, arg1));
  };

  // ── Instantiate WASM ──
  const instance = new WebAssembly.Instance(wasmModule, imports);
  wasm = instance.exports;
  // Invalidate cached memory views after init (wasm memory may have grown)
  cachedUint8Memory = null;
  cachedFloat32Memory = null;

  // ── JS wrappers matching the worklet code exactly ──
  function df_create(model_bytes: Uint8Array, atten_lim: number): number {
    const ptr0 = passArray8ToWasm(model_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    return (wasm.df_create(ptr0, len0, atten_lim) >>> 0);
  }

  function df_get_frame_length(st: number): number {
    return (wasm.df_get_frame_length(st) >>> 0);
  }

  function df_process_frame(st: number, inputFrame: Float32Array): Float32Array {
    const ptr0 = passArrayF32ToWasm(inputFrame, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.df_process_frame(st, ptr0, len0);
    return takeObject(ret) as Float32Array;
  }

  // ── Initialize model ──
  let handle: number;
  try {
    handle = df_create(new Uint8Array(modelBytes), suppressionLevel);
  } catch (e) {
    console.error("[DeepFilter] df_create failed:", e);
    throw new Error(`df_create failed: ${e}`);
  }
  const frameLength = df_get_frame_length(handle);

  return {
    frameLength,
    processFrame: (frame: Float32Array): Float32Array => {
      // Invalidate cache before each frame — memory may grow during processing
      cachedFloat32Memory = null;
      cachedUint8Memory = null;
      try {
        return df_process_frame(handle, frame);
      } catch (e) {
        console.error("[DeepFilter] df_process_frame error:", e);
        return frame;
      }
    },
    destroy: () => {
      try { wasm.__wbg_dfstate_free(handle); } catch {}
    },
  };
}

/**
 * DTLN offline buffer processing.
 * Uses OfflineAudioContext for high-quality resampling (48kHz↔16kHz),
 * then processes frame-by-frame via dtln_denoise at 16kHz.
 */
async function applyDtln(input: AudioBuffer, log: (msg: string) => void): Promise<AudioBuffer> {
  log("Loading DTLN WASM...");
  const plugin = await loadDtlnPlugin();

  const handle = plugin.dtln_create();
  if (!handle) throw new Error("dtln_create returned null");

  const FRAME = 512;
  const samples = input.getChannelData(0);

  // High-quality downsample 48kHz → 16kHz using OfflineAudioContext
  const downLen = Math.ceil(samples.length * 16000 / input.sampleRate);
  const downCtx = new OfflineAudioContext(1, downLen, 16000);
  const downSource = downCtx.createBufferSource();
  downSource.buffer = input;
  downSource.connect(downCtx.destination);
  downSource.start();
  const downBuffer = await downCtx.startRendering();
  const samples16k = downBuffer.getChannelData(0);

  log(`DTLN ready, processing ${samples16k.length} samples at 16kHz...`);

  const frameIn = new Float32Array(FRAME);
  const frameOut = new Float32Array(FRAME);
  const output16k = new Float32Array(samples16k.length);
  let readPos = 0;
  let writePos = 0;
  let framesProcessed = 0;

  while (readPos + FRAME <= samples16k.length) {
    frameIn.set(samples16k.subarray(readPos, readPos + FRAME));
    plugin.dtln_denoise(handle, frameIn, frameOut);
    output16k.set(frameOut, writePos);
    readPos += FRAME;
    writePos += FRAME;
    framesProcessed++;
  }

  // Copy remaining tail as-is
  if (readPos < samples16k.length) {
    output16k.set(samples16k.subarray(readPos), writePos);
    writePos += samples16k.length - readPos;
  }

  plugin.dtln_destroy(handle);

  // High-quality upsample 16kHz → 48kHz using OfflineAudioContext
  const processed16k = new AudioBuffer({ numberOfChannels: 1, length: writePos, sampleRate: 16000 });
  processed16k.getChannelData(0).set(output16k.subarray(0, writePos));

  const upLen = Math.ceil(writePos * input.sampleRate / 16000);
  const upCtx = new OfflineAudioContext(1, upLen, input.sampleRate);
  const upSource = upCtx.createBufferSource();
  upSource.buffer = processed16k;
  upSource.connect(upCtx.destination);
  upSource.start();
  const upBuffer = await upCtx.startRendering();

  log(`DTLN done: ${framesProcessed} frames processed`);

  // Trim to original length
  const finalLen = Math.min(upBuffer.length, samples.length);
  const buf = new AudioBuffer({ numberOfChannels: 1, length: finalLen, sampleRate: input.sampleRate });
  buf.getChannelData(0).set(upBuffer.getChannelData(0).subarray(0, finalLen));
  return buf;
}

/** Detect speech regions and also gate the audio (silence non-speech). */
function applyVad(
  buffer: AudioBuffer,
  sensitivity: number,
): { gated: AudioBuffer; regions: [number, number][] } {
  const samples = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const frameSize = Math.round(sampleRate * 0.03); // 30ms frames
  const rmsThreshold = 0.005 + sensitivity * 0.04;
  const regions: [number, number][] = [];

  // Build a per-sample speech mask
  const isSpeech = new Uint8Array(samples.length);
  let speaking = false;
  let speechStart = 0;
  let silenceFrames = 0;
  const redemptionFrames = 8;

  for (let i = 0; i < samples.length; i += frameSize) {
    const end = Math.min(i + frameSize, samples.length);
    let sum = 0;
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    const rms = Math.sqrt(sum / (end - i));
    const timeSec = i / sampleRate;

    if (rms > rmsThreshold) {
      silenceFrames = 0;
      if (!speaking) { speaking = true; speechStart = timeSec; }
      isSpeech.fill(1, i, end);
    } else if (speaking) {
      silenceFrames++;
      isSpeech.fill(1, i, end); // keep during redemption
      if (silenceFrames >= redemptionFrames) {
        speaking = false;
        regions.push([speechStart, timeSec]);
      }
    }
  }
  if (speaking) regions.push([speechStart, samples.length / sampleRate]);

  // Gate: silence non-speech samples with a short fade
  const fadeSamples = Math.round(sampleRate * 0.005); // 5ms fade
  const gated = new AudioBuffer({
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
  });
  const out = gated.getChannelData(0);
  out.set(samples);

  for (let i = 0; i < out.length; i++) {
    if (!isSpeech[i]) {
      out[i] = 0;
    } else if (i > 0 && !isSpeech[i - 1]) {
      // Fade in
      for (let j = 0; j < fadeSamples && i + j < out.length; j++) {
        out[i + j] *= j / fadeSamples;
      }
    }
  }

  return { gated, regions };
}

// ═══════════════════════════════════════════════════════════════════
// Playback — use HTMLAudioElement with WAV blob (works in both ears in Tauri WKWebView)
// ═══════════════════════════════════════════════════════════════════

function playBuffer(buffer: AudioBuffer): { stop: () => void; ended: Promise<void> } {
  const blob = bufferToStereoWavBlob(buffer);
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  audio.play().catch(() => {});
  const ended = new Promise<void>((resolve) => {
    audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
  });

  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
      URL.revokeObjectURL(url);
    },
    ended,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Canvas
// ═══════════════════════════════════════════════════════════════════

function drawWaveform(
  canvas: HTMLCanvasElement, buffer: AudioBuffer,
  color = "rgba(255,255,255,0.5)", vadRegions?: [number, number][],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const data = buffer.getChannelData(0);
  const samplesPerPx = Math.floor(data.length / W);
  const dur = buffer.duration;

  ctx.clearRect(0, 0, W, H);

  if (vadRegions?.length) {
    ctx.fillStyle = "rgba(63, 185, 80, 0.15)";
    for (const [s, e] of vadRegions) {
      const x1 = Math.round((s / dur) * W);
      ctx.fillRect(x1, 0, Math.round((e / dur) * W) - x1, H);
    }
  }

  ctx.fillStyle = color;
  for (let x = 0; x < W; x++) {
    let max = 0;
    const si = x * samplesPerPx;
    for (let s = 0; s < samplesPerPx; s++) {
      const v = Math.abs(data[si + s] ?? 0);
      if (v > max) max = v;
    }
    const barH = Math.max(1, max * H);
    ctx.fillRect(x, (H - barH) / 2, 1, barH);
  }
}

function drawSpectrogram(canvas: HTMLCanvasElement, buffer: AudioBuffer) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width, H = canvas.height;
  const { data, freqBinCount } = computeSpectrogram(buffer.getChannelData(0), buffer.sampleRate, 1024, 256);
  if (!data.length) return;

  const img = ctx.createImageData(W, H);
  const px = img.data;
  const maxBin = Math.min(freqBinCount, Math.floor((8000 / buffer.sampleRate) * 2 * freqBinCount));

  for (let x = 0; x < W; x++) {
    const slice = data[Math.min(data.length - 1, Math.floor((x / W) * data.length))];
    for (let y = 0; y < H; y++) {
      const bin = Math.min(maxBin - 1, Math.floor(((H - 1 - y) / H) * maxBin));
      const t = (slice[bin] + 100) / 100;
      const [r, g, b] = viridisColor(t);
      const i = (y * W + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function downloadWav(buffer: AudioBuffer, filename: string) {
  const blob = bufferToStereoWavBlob(buffer);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════

export function AudioTestTab() {
  const [duration, setDuration] = useState(5);
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const [bufferA, setBufferA] = useState<AudioBuffer | null>(null);
  const [bufferB, setBufferB] = useState<AudioBuffer | null>(null);
  const [vadRegions, setVadRegions] = useState<[number, number][]>([]);

  const [effects, setEffects] = useState<EffectSettings>({
    rnnoise: false, deepfilter: false, deepfilterLevel: 20, dtln: false, vad: false, vadSensitivity: 0.5,
  });

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const playStopRef = useRef<(() => void) | null>(null);

  const wfA = useRef<HTMLCanvasElement>(null);
  const wfB = useRef<HTMLCanvasElement>(null);
  const sgA = useRef<HTMLCanvasElement>(null);
  const sgB = useRef<HTMLCanvasElement>(null);

  const log = useCallback((msg: string) => {
    console.log("[AudioTest]", msg);
    setDebugLog((prev) => [...prev.slice(-40), `${new Date().toLocaleTimeString()} ${msg}`]);
  }, []);

  // Enumerate devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {});
    const h = () => navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {});
    navigator.mediaDevices.addEventListener("devicechange", h);
    return () => navigator.mediaDevices.removeEventListener("devicechange", h);
  }, []);

  const inputs = devices.filter((d) => d.kind === "audioinput");

  // Redraw canvases
  useEffect(() => {
    if (wfA.current && bufferA) drawWaveform(wfA.current, bufferA);
    if (sgA.current && bufferA) drawSpectrogram(sgA.current, bufferA);
  }, [bufferA]);

  useEffect(() => {
    if (wfB.current && bufferB) drawWaveform(wfB.current, bufferB, "rgba(255,255,255,0.5)", vadRegions);
    if (sgB.current && bufferB) drawSpectrogram(sgB.current, bufferB);
  }, [bufferB, vadRegions]);

  // Process function
  const processRaw = useCallback(async (raw: AudioBuffer, fx: EffectSettings) => {
    let processed = raw;
    let regions: [number, number][] = [];

    if (fx.deepfilter) {
      try {
        processed = await applyDeepFilter(processed, fx.deepfilterLevel, log);
      } catch (e: any) {
        log(`DeepFilter failed: ${e?.message ?? e}`);
      }
    } else if (fx.rnnoise) {
      try {
        processed = await applyRnnoise(processed, log);
      } catch (e: any) {
        log(`RNNoise failed: ${e?.message ?? e}`);
      }
    } else if (fx.dtln) {
      try {
        processed = await applyDtln(processed, log);
      } catch (e: any) {
        log(`DTLN failed: ${e?.message ?? e}`);
      }
    }

    if (fx.vad) {
      const vad = applyVad(processed, fx.vadSensitivity);
      processed = vad.gated;
      regions = vad.regions;
      log(`VAD: ${regions.length} speech regions, non-speech silenced`);
    }

    return { processed, regions };
  }, [log]);

  // Auto-reprocess when effects change
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const processingRef = useRef(false);
  const initialProcessDone = useRef(false);

  useEffect(() => {
    if (!bufferA) {
      initialProcessDone.current = false;
      return;
    }
    if (!initialProcessDone.current) {
      initialProcessDone.current = true;
      return;
    }
    if (busy || processingRef.current) return;

    const timer = setTimeout(async () => {
      if (processingRef.current) return;
      processingRef.current = true;
      setBusy(true);
      setStatus("Processing...");
      try {
        const { processed, regions } = await processRaw(bufferA, effects);
        setBufferB(processed);
        setVadRegions(regions);
        setStatus("Done");
      } catch (e: any) {
        log(`Error: ${e?.message ?? e}`);
        setStatus(`Error: ${e?.message ?? "Unknown"}`);
      } finally {
        setBusy(false);
        processingRef.current = false;
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [effects, bufferA]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle effect
  const toggle = useCallback((key: keyof EffectSettings, value?: any) => {
    setEffects((prev) => {
      const next = { ...prev };
      if (key === "rnnoise") {
        next.rnnoise = !prev.rnnoise;
        if (next.rnnoise) { next.deepfilter = false; next.dtln = false; }
      } else if (key === "deepfilter") {
        next.deepfilter = !prev.deepfilter;
        if (next.deepfilter) { next.rnnoise = false; next.dtln = false; }
      } else if (key === "dtln") {
        next.dtln = !prev.dtln;
        if (next.dtln) { next.rnnoise = false; next.deepfilter = false; }
      } else if (key === "deepfilterLevel") {
        next.deepfilterLevel = value as number;
      } else if (key === "vadSensitivity") {
        next.vadSensitivity = value as number;
      } else {
        (next as any)[key] = !(prev as any)[key];
      }
      return next;
    });
  }, []);

  // Record
  const record = useCallback(async () => {
    setBusy(true);
    setStatus("Recording...");
    setDebugLog([]);
    setBufferA(null);
    setBufferB(null);
    setVadRegions([]);

    try {
      const raw = await captureRaw(duration, deviceId, log);
      log("Recording complete, processing...");
      setStatus("Processing...");

      const { processed, regions } = await processRaw(raw, effectsRef.current);
      setBufferA(raw);
      setBufferB(processed);
      setVadRegions(regions);
      setStatus("Done");
    } catch (err: any) {
      log(`Error: ${err?.message ?? err}`);
      setStatus(`Error: ${err?.message ?? "Unknown"}`);
    } finally {
      setBusy(false);
    }
  }, [duration, deviceId, log, processRaw]);

  // Playback
  const play = useCallback((id: string) => {
    playStopRef.current?.();
    const buf = id === "a" ? bufferA : bufferB;
    if (!buf) return;
    setPlayingId(id);
    const { stop, ended } = playBuffer(buf);
    playStopRef.current = stop;
    ended.then(() => { setPlayingId(null); playStopRef.current = null; });
  }, [bufferA, bufferB]);

  const stopPlay = useCallback(() => {
    playStopRef.current?.();
    setPlayingId(null);
    playStopRef.current = null;
  }, []);

  const playAB = useCallback(async () => {
    if (!bufferA || !bufferB) return;
    playStopRef.current?.();
    setPlayingId("a");
    const a = playBuffer(bufferA);
    playStopRef.current = a.stop;
    await a.ended;
    if (!playStopRef.current) return;
    await new Promise((r) => setTimeout(r, 400));
    setPlayingId("b");
    const b = playBuffer(bufferB);
    playStopRef.current = b.stop;
    await b.ended;
    setPlayingId(null);
    playStopRef.current = null;
  }, [bufferA, bufferB]);

  const metricsA = bufferA ? computeMetrics(bufferA) : null;
  const metricsB = bufferB ? computeMetrics(bufferB) : null;

  return (
    <>
      {/* Controls */}
      <div className="settings-card">
        <div className="audio-test-controls">
          <div className="voice-device-row" style={{ padding: 0, border: "none", flex: 1, minWidth: 200 }}>
            <label className="voice-device-label">Input Device</label>
            <select className="settings-select voice-device-select" value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)} disabled={busy}>
              <option value="">System Default</option>
              {inputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </div>
          <div className="audio-test-duration">
            <span>Duration</span>
            <input type="range" min={3} max={10} step={1} value={duration}
              onChange={(e) => setDuration(Number(e.target.value))} disabled={busy} />
            <span className="audio-test-duration-value">{duration}s</span>
          </div>
          <div className="audio-test-actions">
            <button className="btn-small" onClick={record} disabled={busy}>
              {busy ? status : (bufferA ? "Re-record" : "Record")}
            </button>
          </div>
        </div>

        {/* Effects */}
        <div className="audio-test-effects">
          <label className="audio-test-checkbox">
            <input type="checkbox" checked={effects.rnnoise} onChange={() => toggle("rnnoise")} disabled={busy} />
            <span>RNNoise</span>
            <span className="audio-test-checkbox-desc">Standard noise suppression</span>
          </label>
          <label className="audio-test-checkbox">
            <input type="checkbox" checked={effects.deepfilter} onChange={() => toggle("deepfilter")} disabled={busy} />
            <span>DeepFilterNet3</span>
            <span className="audio-test-checkbox-desc">Enhanced noise suppression</span>
          </label>
          {effects.deepfilter && (
            <div className="audio-test-vad-sensitivity">
              <span>Attenuation</span>
              <input type="range" min={5} max={60} step={1} value={effects.deepfilterLevel}
                onChange={(e) => toggle("deepfilterLevel", parseInt(e.target.value))} disabled={busy} />
              <span className="audio-test-duration-value">{effects.deepfilterLevel} dB</span>
            </div>
          )}
          <label className="audio-test-checkbox">
            <input type="checkbox" checked={effects.dtln} onChange={() => toggle("dtln")} disabled={busy} />
            <span>DTLN</span>
            <span className="audio-test-checkbox-desc">Dual-signal LSTM noise suppression</span>
          </label>
          <label className="audio-test-checkbox">
            <input type="checkbox" checked={effects.vad} onChange={() => toggle("vad")} disabled={busy} />
            <span>Voice Activity Detection</span>
            <span className="audio-test-checkbox-desc">Highlight speech regions</span>
          </label>
          {effects.vad && (
            <div className="audio-test-vad-sensitivity">
              <span>Sensitivity</span>
              <input type="range" min={0} max={1} step={0.05} value={effects.vadSensitivity}
                onChange={(e) => toggle("vadSensitivity", parseFloat(e.target.value))} disabled={busy} />
              <span className="audio-test-duration-value">{effects.vadSensitivity.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>

      {/* A/B Results */}
      {bufferA && bufferB && (
        <div className="settings-card">
          <h3 className="settings-card-title">Results</h3>

          <div className="audio-test-ab-grid">
            {/* A — Raw */}
            <div className="audio-test-ab-col">
              <div className="audio-test-ab-col-header a">A — Raw</div>
              <div className="audio-test-waveform">
                <canvas ref={wfA} width={400} height={48} />
              </div>
              <div className="audio-test-spectrogram">
                <canvas ref={sgA} width={400} height={64} />
              </div>
              {metricsA && (
                <div className="audio-test-metrics">
                  <div className="audio-test-metric"><span className="audio-test-metric-label">RMS</span><span className="audio-test-metric-value">{fmt(metricsA.rmsDb)} dB</span></div>
                  <div className="audio-test-metric"><span className="audio-test-metric-label">Peak</span><span className="audio-test-metric-value">{metricsA.peak.toFixed(3)}</span></div>
                  <div className="audio-test-metric"><span className="audio-test-metric-label">Crest</span><span className="audio-test-metric-value">{fmt(metricsA.crestDb)} dB</span></div>
                  <div className="audio-test-metric"><span className="audio-test-metric-label">SNR</span><span className="audio-test-metric-value">{fmt(metricsA.snrDb)} dB</span></div>
                </div>
              )}
              <div className="audio-test-variant-actions">
                <button className={playingId === "a" ? "playing" : ""} onClick={() => playingId === "a" ? stopPlay() : play("a")}>
                  {playingId === "a" ? "Stop" : "Play A"}
                </button>
                <button onClick={() => downloadWav(bufferA, "audio-test-raw.wav")}>Export</button>
              </div>
            </div>

            {/* B — Processed */}
            <div className="audio-test-ab-col">
              <div className="audio-test-ab-col-header b">
                B — {[
                  effects.rnnoise && "RNNoise",
                  effects.deepfilter && "DeepFilter",
                  effects.dtln && "DTLN",
                  effects.vad && "VAD",
                ].filter(Boolean).join(" + ") || "No effects"}
              </div>
              <div className="audio-test-waveform">
                <canvas ref={wfB} width={400} height={48} />
              </div>
              <div className="audio-test-spectrogram">
                <canvas ref={sgB} width={400} height={64} />
              </div>
              {metricsB && (
                <div className="audio-test-metrics">
                  <div className="audio-test-metric"><span className="audio-test-metric-label">RMS</span><span className="audio-test-metric-value">{fmt(metricsB.rmsDb)} dB</span></div>
                  <div className="audio-test-metric"><span className="audio-test-metric-label">Peak</span><span className="audio-test-metric-value">{metricsB.peak.toFixed(3)}</span></div>
                  <div className="audio-test-metric"><span className="audio-test-metric-label">Crest</span><span className="audio-test-metric-value">{fmt(metricsB.crestDb)} dB</span></div>
                  <div className="audio-test-metric"><span className="audio-test-metric-label">SNR</span><span className="audio-test-metric-value">{fmt(metricsB.snrDb)} dB</span></div>
                </div>
              )}
              <div className="audio-test-variant-actions">
                <button className={playingId === "b" ? "playing" : ""} onClick={() => playingId === "b" ? stopPlay() : play("b")}>
                  {playingId === "b" ? "Stop" : "Play B"}
                </button>
                <button onClick={() => downloadWav(bufferB, "audio-test-processed.wav")}>Export</button>
              </div>
            </div>
          </div>

          {/* Deltas */}
          {metricsA && metricsB && (
            <div className="audio-test-delta-row-inline">
              {([
                { key: "snrDb" as const, label: "SNR", up: true },
                { key: "rmsDb" as const, label: "RMS", up: false },
                { key: "crestDb" as const, label: "Crest", up: true },
                { key: "peak" as const, label: "Peak", up: false },
              ]).map(({ key, label, up }) => {
                const d = metricsB[key] - metricsA[key];
                const cls = (up ? d > 0.5 : d < -0.5) ? "positive" : (up ? d < -0.5 : d > 0.5) ? "negative" : "neutral";
                return (
                  <span key={key} className={`audio-test-delta-inline ${cls}`}>
                    {label}: {d > 0 ? "+" : ""}{key === "peak" ? d.toFixed(3) : fmt(d)}
                  </span>
                );
              })}
            </div>
          )}

          <div className="audio-test-ab-playback" style={{ marginTop: 12 }}>
            <button onClick={() => playingId ? stopPlay() : playAB()}>
              {playingId ? "Stop" : "Play A \u2192 B"}
            </button>
          </div>
        </div>
      )}

      {/* Debug log */}
      {debugLog.length > 0 && (
        <div className="settings-card">
          <h3 className="settings-card-title">Log</h3>
          <pre style={{
            fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap",
            wordBreak: "break-all", margin: 0, maxHeight: 160, overflow: "auto", fontFamily: "monospace",
          }}>
            {debugLog.join("\n")}
          </pre>
        </div>
      )}
    </>
  );
}
