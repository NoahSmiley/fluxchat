// ═══════════════════════════════════════════════════════════════════
// Audio Analysis Utilities
//
// Pure functions for computing audio metrics and spectrograms.
// No React dependencies — used by AudioTestTab.
// ═══════════════════════════════════════════════════════════════════

/** RMS (Root Mean Square) in linear and dBFS. */
export function computeRms(samples: Float32Array): { linear: number; db: number } {
  if (samples.length === 0) return { linear: 0, db: -Infinity };
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const linear = Math.sqrt(sum / samples.length);
  const db = linear > 0 ? 20 * Math.log10(linear) : -Infinity;
  return { linear, db };
}

/** Peak absolute sample value (0.0–1.0). */
export function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/** Crest factor = 20 * log10(peak / rmsLinear) in dB. */
export function computeCrestFactor(peak: number, rmsLinear: number): number {
  if (rmsLinear <= 0 || peak <= 0) return 0;
  return 20 * Math.log10(peak / rmsLinear);
}

/**
 * SNR estimate: sort samples by |value|, bottom 10% = noise floor, top 50% = signal.
 * Returns 20 * log10(signalRms / noiseRms).
 */
export function estimateSnr(samples: Float32Array): number {
  if (samples.length < 20) return 0;

  const sorted = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) sorted[i] = Math.abs(samples[i]);
  sorted.sort();

  const noiseEnd = Math.floor(sorted.length * 0.1);
  const signalStart = Math.floor(sorted.length * 0.5);

  let noiseSum = 0;
  for (let i = 0; i < noiseEnd; i++) noiseSum += sorted[i] * sorted[i];
  const noiseRms = Math.sqrt(noiseSum / noiseEnd);

  let signalSum = 0;
  const signalCount = sorted.length - signalStart;
  for (let i = signalStart; i < sorted.length; i++) signalSum += sorted[i] * sorted[i];
  const signalRms = Math.sqrt(signalSum / signalCount);

  if (noiseRms <= 0) return 60; // essentially silent noise floor
  return 20 * Math.log10(signalRms / noiseRms);
}

// ── Radix-2 Cooley-Tukey FFT ────────────────────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const a = i + j;
        const b = a + halfLen;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Compute spectrogram: slide FFT window across buffer, return magnitude grid.
 * Returns magnitude in dB (clamped to [-100, 0]).
 */
export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  fftSize = 1024,
  hopSize = 256,
): { data: Float32Array[]; freqBinCount: number; timeSlices: number } {
  const freqBinCount = fftSize >> 1;
  const timeSlices = Math.max(0, Math.floor((samples.length - fftSize) / hopSize) + 1);
  const data: Float32Array[] = [];

  // Hann window (precompute)
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let t = 0; t < timeSlices; t++) {
    const offset = t * hopSize;
    // Windowed samples
    for (let i = 0; i < fftSize; i++) {
      re[i] = (samples[offset + i] ?? 0) * window[i];
      im[i] = 0;
    }
    fft(re, im);

    const magnitudes = new Float32Array(freqBinCount);
    for (let i = 0; i < freqBinCount; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / fftSize;
      // dB, clamped to [-100, 0]
      magnitudes[i] = Math.max(-100, mag > 0 ? 20 * Math.log10(mag) : -100);
    }
    data.push(magnitudes);
  }

  return { data, freqBinCount, timeSlices };
}
