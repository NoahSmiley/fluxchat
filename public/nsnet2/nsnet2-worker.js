/**
 * NSNet2 Worker — runs ONNX Runtime inference in a Web Worker thread.
 *
 * Receives 160-sample audio hops from the AudioWorklet, performs STFT,
 * runs NSNet2 inference for a suppression gain mask, applies it, does ISTFT,
 * and sends back denoised audio.
 *
 * 16kHz model: 20ms window (320 samples), 50% hop (160 samples), 161 FFT bins.
 */

importScripts("/nsnet2/ort.min.js");

const N_WIN = 320;     // Window size (20ms at 16kHz)
const N_FFT = 320;     // FFT size
const N_HOP = 160;     // Hop size (50% overlap)
const SPEC_SIZE = 161;  // N_FFT/2 + 1
const MIN_GAIN = Math.pow(10, -80 / 20); // -80dB floor

// Sqrt-Hanning window (symmetric, matching Python's np.sqrt(np.hanning(N)))
const WIN = new Float32Array(N_WIN);
for (let i = 0; i < N_WIN; i++) {
  WIN[i] = Math.sqrt(0.5 * (1 - Math.cos(2 * Math.PI * i / (N_WIN - 1))));
}

// Pre-compute twiddle factors for DFT/IDFT (N_FFT=320 is not power-of-2)
const twiddleRe = new Float32Array(SPEC_SIZE * N_FFT);
const twiddleIm = new Float32Array(SPEC_SIZE * N_FFT);
for (let k = 0; k < SPEC_SIZE; k++) {
  for (let n = 0; n < N_FFT; n++) {
    const angle = -2 * Math.PI * k * n / N_FFT;
    twiddleRe[k * N_FFT + n] = Math.cos(angle);
    twiddleIm[k * N_FFT + n] = Math.sin(angle);
  }
}

let session = null;
let port = null;

// Overlap-add state
const inputBuffer = new Float32Array(N_WIN);
const outputBuffer = new Float32Array(N_WIN);

// ── DFT for non-power-of-2 sizes ──

function rfft(input, outReal, outImag) {
  for (let k = 0; k < SPEC_SIZE; k++) {
    let sumRe = 0, sumIm = 0;
    const base = k * N_FFT;
    for (let n = 0; n < N_FFT; n++) {
      const v = input[n];
      sumRe += v * twiddleRe[base + n];
      sumIm += v * twiddleIm[base + n];
    }
    outReal[k] = sumRe;
    outImag[k] = sumIm;
  }
}

function irfft(real, imag, output) {
  // Reconstruct full spectrum via Hermitian symmetry
  const fullRe = new Float32Array(N_FFT);
  const fullIm = new Float32Array(N_FFT);
  for (let i = 0; i < SPEC_SIZE; i++) {
    fullRe[i] = real[i];
    fullIm[i] = imag[i];
  }
  for (let i = 1; i < SPEC_SIZE - 1; i++) {
    fullRe[N_FFT - i] = real[i];
    fullIm[N_FFT - i] = -imag[i];
  }
  // IDFT
  for (let n = 0; n < N_FFT; n++) {
    let sum = 0;
    const angle = 2 * Math.PI * n / N_FFT;
    for (let k = 0; k < N_FFT; k++) {
      sum += fullRe[k] * Math.cos(angle * k) - fullIm[k] * Math.sin(angle * k);
    }
    output[n] = sum / N_FFT;
  }
}

// ── Signal processing ──

async function processHop(samples) {
  // Shift input buffer: old second half becomes first half, new samples fill second half
  inputBuffer.copyWithin(0, N_HOP);
  inputBuffer.set(samples, N_HOP);

  // Window the frame
  const windowed = new Float32Array(N_FFT);
  for (let i = 0; i < N_WIN; i++) {
    windowed[i] = inputBuffer[i] * WIN[i];
  }

  // Forward DFT
  const specRe = new Float32Array(SPEC_SIZE);
  const specIm = new Float32Array(SPEC_SIZE);
  rfft(windowed, specRe, specIm);

  // Compute log-power spectrum (NSNet2 input feature)
  const logPow = new Float32Array(SPEC_SIZE);
  for (let i = 0; i < SPEC_SIZE; i++) {
    const pow = specRe[i] * specRe[i] + specIm[i] * specIm[i];
    logPow[i] = Math.log10(Math.max(pow, 1e-12));
  }

  // Run ONNX inference — input shape [1, 1, 161]
  const inputTensor = new ort.Tensor("float32", logPow, [1, 1, SPEC_SIZE]);
  const results = await session.run({ input: inputTensor });
  const gain = results.output.data; // Float32Array [1, 1, 161]

  // Apply gain mask to spectrum
  const maskedRe = new Float32Array(SPEC_SIZE);
  const maskedIm = new Float32Array(SPEC_SIZE);
  for (let i = 0; i < SPEC_SIZE; i++) {
    const g = Math.max(Math.min(gain[i], 1.0), MIN_GAIN);
    maskedRe[i] = specRe[i] * g;
    maskedIm[i] = specIm[i] * g;
  }

  // Inverse DFT
  const timeDomain = new Float32Array(N_FFT);
  irfft(maskedRe, maskedIm, timeDomain);

  // Apply synthesis window
  const denoisedFrame = new Float32Array(N_WIN);
  for (let i = 0; i < N_WIN; i++) {
    denoisedFrame[i] = timeDomain[i] * WIN[i];
  }

  // Overlap-add: extract first hop from accumulated buffer, then shift
  const output = new Float32Array(N_HOP);
  for (let i = 0; i < N_HOP; i++) {
    output[i] = outputBuffer[i] + denoisedFrame[i];
  }

  // Shift output buffer and accumulate second half of frame
  outputBuffer.copyWithin(0, N_HOP);
  outputBuffer.fill(0, N_HOP);
  for (let i = N_HOP; i < N_WIN; i++) {
    outputBuffer[i - N_HOP] += denoisedFrame[i];
  }

  return output;
}

// ── Initialization ──

async function init() {
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/nsnet2/";
    session = await ort.InferenceSession.create("/nsnet2/nsnet2-20ms-baseline.onnx", {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
    self.postMessage("ready");
  } catch (e) {
    self.postMessage({ error: e.message || String(e) });
  }
}

// ── Message handling ──

self.onmessage = async (e) => {
  if (e.data?.type === "init-port") {
    port = e.ports[0];
    port.onmessage = async (ev) => {
      if (!session) return;
      try {
        const output = await processHop(ev.data);
        port.postMessage(output, [output.buffer]);
      } catch (err) {
        port.postMessage(new Float32Array(N_HOP));
      }
    };
    return;
  }
};

init();
