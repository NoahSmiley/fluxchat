import { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";

/**
 * LiveKit TrackProcessor wrapping the deepfilternet3-noise-filter package.
 *
 * In dev, Vite proxies /deepfilter-cdn → cdn.mezon.ai to avoid CORS.
 * In prod (Tauri), the webview has no CORS restrictions, so hit the CDN directly.
 */
const CDN_URL = import.meta.env.DEV
  ? "/deepfilter-cdn"
  : "https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3";

export class DeepFilterTrackProcessor extends DeepFilterNoiseFilterProcessor {
  override name = "deepfilter-noise-filter";

  constructor() {
    super({
      noiseReductionLevel: 80,
      assetConfig: { cdnUrl: CDN_URL },
    });
  }
}
