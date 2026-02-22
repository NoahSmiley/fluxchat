import { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";

/**
 * LiveKit TrackProcessor wrapping the deepfilternet3-noise-filter package.
 *
 * On first init it fetches the compiled WASM binary + ONNX model via a Vite
 * proxy (/deepfilter-cdn → cdn.mezon.ai) to avoid CORS restrictions.
 * The package compiles the WASM on the main thread and spins up an inline
 * AudioWorklet that handles 48 kHz noise suppression via DeepFilterNet3.
 */
export class DeepFilterTrackProcessor extends DeepFilterNoiseFilterProcessor {
  override name = "deepfilter-noise-filter";

  constructor() {
    super({
      noiseReductionLevel: 80,
      // Route through Vite proxy to bypass CORS (cdn.mezon.ai has no CORS headers)
      assetConfig: { cdnUrl: "/deepfilter-cdn" },
    });
  }
}
