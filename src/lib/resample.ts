/**
 * 3:1 resampling between 48kHz and 16kHz.
 * Used by the DTLN processor which operates at 16kHz.
 */

/** Downsample 48kHz → 16kHz by taking every 3rd sample. */
export function downsample48to16(input: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor(input.length / 3));
  for (let i = 0; i < out.length; i++) {
    out[i] = input[i * 3];
  }
  return out;
}

/** Upsample 16kHz → 48kHz via linear interpolation. */
export function upsample16to48(input: Float32Array): Float32Array {
  const out = new Float32Array(input.length * 3);
  for (let i = 0; i < input.length - 1; i++) {
    const base = i * 3;
    const a = input[i];
    const b = input[i + 1];
    out[base] = a;
    out[base + 1] = a + (b - a) / 3;
    out[base + 2] = a + (2 * (b - a)) / 3;
  }
  // Last sample: replicate
  const last = input.length - 1;
  const base = last * 3;
  out[base] = input[last];
  out[base + 1] = input[last];
  out[base + 2] = input[last];
  return out;
}
