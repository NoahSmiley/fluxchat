/**
 * DeepFilterNet3 AudioWorklet Processor
 *
 * Buffers 480-sample frames (10ms at 48kHz) and sends them to a Web Worker
 * for WASM inference. Uses double-buffering to maintain smooth audio output
 * while waiting for processed frames from the worker.
 */
class DeepFilterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._destroyed = false;
    this._workerPort = null;
    this._frameSize = 480;

    // Input accumulation buffer
    this._inputBuffer = new Float32Array(this._frameSize);
    this._inputOffset = 0;

    // Double-buffered output
    this._outputBufferA = new Float32Array(this._frameSize);
    this._outputBufferB = new Float32Array(this._frameSize);
    this._activeOutput = this._outputBufferA;
    this._outputOffset = 0;
    this._hasOutput = false;
    this._pendingFrame = false;

    // Listen for the MessagePort from the main thread
    this.port.onmessage = (e) => {
      if (e.data.type === "worker-port") {
        this._workerPort = e.data.port;
        this._workerPort.onmessage = (msg) => {
          if (msg.data.type === "processed") {
            // Store processed frame in the inactive buffer
            const inactiveBuffer = this._activeOutput === this._outputBufferA
              ? this._outputBufferB
              : this._outputBufferA;
            inactiveBuffer.set(msg.data.frame);
            this._pendingFrame = false;

            if (!this._hasOutput) {
              // First frame — swap immediately
              this._activeOutput = inactiveBuffer;
              this._outputOffset = 0;
              this._hasOutput = true;
            }
          }
        };
        this.port.postMessage("ready");
      }
    };
  }

  process(inputs, outputs) {
    if (this._destroyed) return false;

    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const chunkSize = input.length;

    // Accumulate input samples
    for (let i = 0; i < chunkSize; i++) {
      this._inputBuffer[this._inputOffset++] = input[i];

      if (this._inputOffset >= this._frameSize) {
        // Send full frame to worker for processing
        if (this._workerPort && !this._pendingFrame) {
          const frameCopy = new Float32Array(this._inputBuffer);
          this._workerPort.postMessage(
            { type: "process", frame: frameCopy },
            [frameCopy.buffer]
          );
          this._pendingFrame = true;
        }
        this._inputOffset = 0;
      }
    }

    // Output from active buffer
    if (this._hasOutput) {
      for (let i = 0; i < chunkSize; i++) {
        output[i] = this._activeOutput[this._outputOffset++];
        if (this._outputOffset >= this._frameSize) {
          // Swap buffers
          this._activeOutput = this._activeOutput === this._outputBufferA
            ? this._outputBufferB
            : this._outputBufferA;
          this._outputOffset = 0;
        }
      }
    } else {
      // No output ready yet, pass through input
      output.set(input);
    }

    return true;
  }
}

registerProcessor("deepfilter-processor", DeepFilterProcessor);
