/**
 * NSNet2 AudioWorklet Processor
 *
 * Buffers 128-sample WebAudio chunks into 160-sample hops (16kHz, 10ms),
 * sends them to the NSNet2 Worker for ONNX inference, and outputs the
 * denoised audio.
 *
 * Communication: uses a MessagePort (passed from main thread) to talk
 * to the Worker. Since inference is async, we maintain a ring buffer of
 * denoised output to handle timing jitter.
 */
class NSNet2Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._destroyed = false;
    this._workerPort = null;
    this._ready = false;

    // Input buffering: accumulate 128-sample chunks into 160-sample hops
    this._inputBuffer = new Float32Array(160);
    this._inputOffset = 0;

    // Output ring buffer: store denoised hops for playback
    // Use a larger buffer to handle async timing
    this._outputRing = new Float32Array(4800); // 300ms at 16kHz
    this._outputWritePos = 0;
    this._outputReadPos = 0;
    this._outputAvailable = 0;

    // Track pending inference count to prevent overflow
    this._pendingCount = 0;
    this._maxPending = 8; // Limit concurrent inferences

    this.port.onmessage = (e) => {
      if (e.data?.type === "init-port") {
        this._workerPort = e.ports[0];
        this._workerPort.onmessage = (ev) => {
          this._onDenoisedHop(ev.data);
        };
        this._ready = true;
        this.port.postMessage("ready");
      }
    };
  }

  _onDenoisedHop(samples) {
    this._pendingCount = Math.max(0, this._pendingCount - 1);

    // Write denoised samples into ring buffer
    const len = samples.length;
    const ring = this._outputRing;
    const ringLen = ring.length;
    for (let i = 0; i < len; i++) {
      ring[this._outputWritePos] = samples[i];
      this._outputWritePos = (this._outputWritePos + 1) % ringLen;
    }
    this._outputAvailable += len;

    // Prevent ring buffer overflow
    if (this._outputAvailable > ringLen) {
      const overflow = this._outputAvailable - ringLen;
      this._outputReadPos = (this._outputReadPos + overflow) % ringLen;
      this._outputAvailable = ringLen;
    }
  }

  _sendHopToWorker(hop) {
    if (!this._workerPort || this._pendingCount >= this._maxPending) return;
    this._pendingCount++;
    // Transfer the buffer for zero-copy
    const copy = new Float32Array(hop);
    this._workerPort.postMessage(copy, [copy.buffer]);
  }

  process(inputs, outputs) {
    if (this._destroyed) return false;

    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const chunkSize = input.length; // typically 128

    if (!this._ready) {
      // Pass through while not initialized
      output.set(input);
      return true;
    }

    // Accumulate input samples into 160-sample hops
    for (let i = 0; i < chunkSize; i++) {
      this._inputBuffer[this._inputOffset++] = input[i];
      if (this._inputOffset >= 160) {
        this._sendHopToWorker(this._inputBuffer);
        this._inputOffset = 0;
      }
    }

    // Read denoised output from ring buffer
    if (this._outputAvailable >= chunkSize) {
      const ring = this._outputRing;
      const ringLen = ring.length;
      for (let i = 0; i < chunkSize; i++) {
        output[i] = ring[this._outputReadPos];
        this._outputReadPos = (this._outputReadPos + 1) % ringLen;
      }
      this._outputAvailable -= chunkSize;
    } else {
      // Not enough denoised audio yet — output silence
      output.fill(0);
    }

    return true;
  }
}

registerProcessor("nsnet2-processor", NSNet2Processor);
