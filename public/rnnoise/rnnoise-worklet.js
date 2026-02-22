/**
 * RNNoise AudioWorklet Processor
 *
 * Loads the RNNoise WASM binary and processes 480-sample frames (10ms at 48kHz).
 * RNNoise expects 16-bit PCM values (range -32768 to 32767) as Float32.
 */
class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ready = false;
    this._destroyed = false;
    this._state = 0; // pointer to DenoiseState
    this._inputPtr = 0;
    this._outputPtr = 0;
    this._heapF32 = null;
    this._module = null;
    this._frameSize = 480;
    // Buffer for accumulating samples (WebAudio gives 128-sample chunks)
    this._buffer = new Float32Array(480);
    this._bufferOffset = 0;
    this._outputBuffer = new Float32Array(480);
    this._outputOffset = 0;
    this._outputReady = false;
    // VAD threshold: 0-1 (0 = no gating, 1 = maximum gating)
    this._vadThreshold = 0;
    this._lastVadProb = 0;

    // Listen for VAD threshold updates from the main thread
    this.port.onmessage = (event) => {
      if (event.data?.type === "set-vad-threshold") {
        this._vadThreshold = event.data.threshold;
      }
    };

    this._init();
  }

  async _init() {
    try {
      const response = await fetch("/rnnoise/rnnoise.wasm");
      const wasmBytes = await response.arrayBuffer();

      // Minimal Emscripten-compatible imports for rnnoise.wasm
      const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });

      const importObject = {
        env: {
          memory,
          __assert_fail: (a, b, c, d) => { throw new Error("rnnoise assert failed"); },
          emscripten_resize_heap: () => 0,
          fd_write: () => 0,
        },
        wasi_snapshot_preview1: {
          fd_write: () => 0,
        },
      };

      const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
      this._module = instance.exports;

      // Initialize stack
      if (this._module.emscripten_stack_init) {
        this._module.emscripten_stack_init();
      }
      if (this._module.__wasm_call_ctors) {
        this._module.__wasm_call_ctors();
      }

      this._frameSize = this._module.rnnoise_get_frame_size();
      this._state = this._module.rnnoise_create(0);

      const floatBytes = 4;
      this._inputPtr = this._module.malloc(this._frameSize * floatBytes);
      this._outputPtr = this._module.malloc(this._frameSize * floatBytes);

      this._heapF32 = new Float32Array(this._module.memory.buffer);
      this._buffer = new Float32Array(this._frameSize);
      this._outputBuffer = new Float32Array(this._frameSize);

      this._ready = true;
      this.port.postMessage("ready");
    } catch (e) {
      this.port.postMessage({ error: e.message || String(e) });
    }
  }

  process(inputs, outputs) {
    if (this._destroyed) return false;
    if (!this._ready) {
      // Pass through while loading
      const input = inputs[0]?.[0];
      const output = outputs[0]?.[0];
      if (input && output) output.set(input);
      return true;
    }

    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const chunkSize = input.length; // typically 128

    // Copy input samples into accumulation buffer
    for (let i = 0; i < chunkSize; i++) {
      this._buffer[this._bufferOffset++] = input[i];

      if (this._bufferOffset >= this._frameSize) {
        // Process a full frame
        this._processFrame();
        this._bufferOffset = 0;
      }
    }

    // Output from the processed buffer
    if (this._outputReady) {
      for (let i = 0; i < chunkSize; i++) {
        output[i] = this._outputBuffer[this._outputOffset++];
        if (this._outputOffset >= this._frameSize) {
          this._outputOffset = 0;
        }
      }
    } else {
      // No output ready yet, pass silence
      output.fill(0);
    }

    return true;
  }

  _processFrame() {
    // Refresh heap view if buffer was detached (memory growth)
    if (this._heapF32.buffer !== this._module.memory.buffer) {
      this._heapF32 = new Float32Array(this._module.memory.buffer);
    }

    const inputOffset = this._inputPtr / 4;

    // RNNoise expects values in 16-bit PCM range (-32768 to 32767)
    for (let i = 0; i < this._frameSize; i++) {
      this._heapF32[inputOffset + i] = this._buffer[i] * 32768.0;
    }

    // rnnoise_process_frame returns voice probability (0.0 - 1.0)
    const vadProb = this._module.rnnoise_process_frame(
      this._state,
      this._outputPtr,
      this._inputPtr
    );
    this._lastVadProb = vadProb;

    // Convert back from 16-bit PCM range to float (-1 to 1)
    const outputOffset = this._outputPtr / 4;

    // If VAD probability is below threshold, output silence instead of denoised audio
    if (this._vadThreshold > 0 && vadProb < this._vadThreshold) {
      for (let i = 0; i < this._frameSize; i++) {
        this._outputBuffer[i] = 0;
      }
    } else {
      for (let i = 0; i < this._frameSize; i++) {
        this._outputBuffer[i] = this._heapF32[outputOffset + i] / 32768.0;
      }
    }
    this._outputOffset = 0;
    this._outputReady = true;
  }
}

registerProcessor("rnnoise-processor", RnnoiseProcessor);
