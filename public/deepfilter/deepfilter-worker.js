/**
 * DeepFilterNet3 Web Worker
 *
 * Offloads WASM model inference to a Web Worker so the AudioWorklet thread
 * stays fast. Communicates with the worklet via a MessagePort.
 *
 * Protocol:
 *   worklet → worker: { type: "process", frame: Float32Array }
 *   worker → worklet: { type: "processed", frame: Float32Array }
 *   worker → main:    "ready" | { error: string }
 */

let wasmModule = null;
let modelState = null;
let heapF32 = null;
let inputPtr = 0;
let outputPtr = 0;
let frameSize = 480; // 10ms at 48kHz
let workletPort = null;

async function init() {
  try {
    // Load the DeepFilterNet3 WASM binary
    const wasmResponse = await fetch("/deepfilter/deepfilter.wasm");
    const wasmBytes = await wasmResponse.arrayBuffer();

    const importObject = {
      env: {
        memory: new WebAssembly.Memory({ initial: 512, maximum: 2048 }),
        __assert_fail: () => { throw new Error("deepfilter assert"); },
        emscripten_resize_heap: () => 0,
        fd_write: () => 0,
      },
      wasi_snapshot_preview1: {
        fd_write: () => 0,
        fd_close: () => 0,
        fd_seek: () => 0,
        proc_exit: () => {},
        environ_sizes_get: () => 0,
        environ_get: () => 0,
      },
    };

    const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
    wasmModule = instance.exports;

    // Initialize the model
    if (wasmModule.__wasm_call_ctors) wasmModule.__wasm_call_ctors();
    if (wasmModule.emscripten_stack_init) wasmModule.emscripten_stack_init();

    // Create DeepFilter state (model init)
    if (wasmModule.df_create) {
      modelState = wasmModule.df_create();
    }

    frameSize = wasmModule.df_get_frame_size ? wasmModule.df_get_frame_size() : 480;

    const floatBytes = 4;
    inputPtr = wasmModule.malloc(frameSize * floatBytes);
    outputPtr = wasmModule.malloc(frameSize * floatBytes);
    heapF32 = new Float32Array(wasmModule.memory.buffer);

    self.postMessage("ready");
  } catch (e) {
    self.postMessage({ error: `DeepFilterNet3 init failed: ${e.message || e}` });
  }
}

function processFrame(inputFrame) {
  if (!wasmModule || !modelState) return inputFrame;

  // Refresh heap view if memory grew
  if (heapF32.buffer !== wasmModule.memory.buffer) {
    heapF32 = new Float32Array(wasmModule.memory.buffer);
  }

  const inOff = inputPtr / 4;
  for (let i = 0; i < frameSize; i++) {
    heapF32[inOff + i] = inputFrame[i];
  }

  if (wasmModule.df_process_frame) {
    wasmModule.df_process_frame(modelState, outputPtr, inputPtr);
  }

  const outOff = outputPtr / 4;
  const result = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    result[i] = heapF32[outOff + i];
  }
  return result;
}

self.onmessage = (e) => {
  const { type, port } = e.data;
  if (type === "init-port") {
    // AudioWorklet sends its port for direct communication
    workletPort = port;
    workletPort.onmessage = (msg) => {
      if (msg.data.type === "process") {
        const processed = processFrame(msg.data.frame);
        workletPort.postMessage({ type: "processed", frame: processed }, [processed.buffer]);
      }
    };
  }
};

init();
