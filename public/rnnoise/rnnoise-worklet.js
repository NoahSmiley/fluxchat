/**
 * RNNoise AudioWorklet Processor
 *
 * Loads the RNNoise WASM binary and processes 480-sample frames (10ms at 48kHz).
 * RNNoise expects 16-bit PCM values (range -32768 to 32767) as Float32.
 *
 * Uses a ring buffer for output to handle the frame/chunk size mismatch
 * (480-sample frames vs 128-sample WebAudio render quanta). One frame of
 * silence is pre-filled to prevent underruns, adding 10ms of latency.
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
    // Buffer for accumulating input samples (WebAudio gives 128-sample chunks)
    this._buffer = new Float32Array(480);
    this._bufferOffset = 0;
    // Ring buffer for output (2 frames capacity to prevent underruns)
    this._ringSize = 960;
    this._ringBuffer = new Float32Array(960);
    this._ringRead = 0;
    this._ringWrite = 0;
    this._ringCount = 0;
    // VAD threshold: 0-1 (0 = no gating, 1 = maximum gating)
    this._vadThreshold = 0;
    this._lastVadProb = 0;

    // Listen for messages from the main thread
    this.port.onmessage = (event) => {
      if (event.data?.type === "set-vad-threshold") {
        this._vadThreshold = event.data.threshold;
      } else if (event.data?.type === "wasm-binary") {
        // Receive pre-fetched WASM binary from main thread
        this._initWithWasm(event.data.wasmBytes);
      }
    };
  }

  async _initWithWasm(wasmBytes) {
    try {

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

      // Set up ring buffer: 2 frames capacity
      this._ringSize = this._frameSize * 2;
      this._ringBuffer = new Float32Array(this._ringSize);
      this._ringRead = 0;
      this._ringWrite = this._frameSize; // pre-fill one frame of silence
      this._ringCount = this._frameSize;

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

    // Accumulate input samples into frame buffer
    for (let i = 0; i < chunkSize; i++) {
      this._buffer[this._bufferOffset++] = input[i];

      if (this._bufferOffset >= this._frameSize) {
        // Process a full frame and push to ring buffer
        this._processFrame();
        this._bufferOffset = 0;
      }
    }

    // Read output from ring buffer
    for (let i = 0; i < chunkSize; i++) {
      if (this._ringCount > 0) {
        output[i] = this._ringBuffer[this._ringRead];
        this._ringRead = (this._ringRead + 1) % this._ringSize;
        this._ringCount--;
      } else {
        output[i] = 0; // underrun — output silence
      }
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

    // Convert back from 16-bit PCM range to float (-1 to 1) and push to ring buffer
    const outputOffset = this._outputPtr / 4;
    const applyVadGate = this._vadThreshold > 0 && vadProb < this._vadThreshold;

    for (let i = 0; i < this._frameSize; i++) {
      this._ringBuffer[this._ringWrite] = applyVadGate
        ? 0
        : this._heapF32[outputOffset + i] / 32768.0;
      this._ringWrite = (this._ringWrite + 1) % this._ringSize;
    }
    this._ringCount += this._frameSize;
  }
}

registerProcessor("rnnoise-processor", RnnoiseProcessor);
