import { DeepFilterNoiseFilterProcessor } from "deepfilternet3-noise-filter";

/**
 * LiveKit TrackProcessor wrapping the deepfilternet3-noise-filter package.
 *
 * In dev, Vite proxies /deepfilter-cdn → cdn.mezon.ai to avoid CORS.
 * In prod (Tauri), the CDN blocks cross-origin requests, so we proxy
 * through the backend server at /deepfilter-cdn/{path}.
 */
const CDN_URL = import.meta.env.DEV
  ? "/deepfilter-cdn"
  : `${(import.meta.env.VITE_SERVER_URL ?? "").replace(/\/+$/, "")}/deepfilter-cdn`;

export class DeepFilterTrackProcessor extends DeepFilterNoiseFilterProcessor {
  override name = "deepfilter-noise-filter";

  constructor() {
    super({
      noiseReductionLevel: 80,
      assetConfig: { cdnUrl: CDN_URL },
    });
  }
}
