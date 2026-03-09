import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// Krisp Noise Suppression
//
// Uses LiveKit's Krisp integration — WASM-powered AI noise cancellation.
// Follows the official LiveKit pattern:
//   1. KrispNoiseFilter() — create instance
//   2. track.setProcessor(processor) — attach to mic track
//   3. processor.setEnabled(true) — explicitly enable filtering
//
// The Krisp SDK has two gates we patch out in scripts/patch-krisp.js:
//   1. Safari/WKWebView version check (isSupported)
//   2. Cloud license check (onPublish → setEnabled)
// ═══════════════════════════════════════════════════════════════════

export class KrispProcessor {
  private processor: any = null;

  async attach(micPublication: any): Promise<void> {
    await this.detach(micPublication);

    dbg("voice", "Krisp: importing @livekit/krisp-noise-filter...");
    const { KrispNoiseFilter } = await import("@livekit/krisp-noise-filter");
    dbg("voice", "Krisp: creating filter instance...");
    this.processor = KrispNoiseFilter();

    try {
      // Step 1: Attach processor to mic track
      await micPublication.track.setProcessor(this.processor);
      dbg("voice", "Krisp: processor attached to track");

      // Step 2: Explicitly enable filtering (matches official LiveKit pattern)
      await this.processor.setEnabled(true);
      dbg("voice", "Krisp: setEnabled(true) — noise suppression ACTIVE");
    } catch (e) {
      dbg("voice", "Krisp: attach FAILED, restoring original track", e);
      try {
        await micPublication.track.stopProcessor();
      } catch { /* track may not have a processor to stop */ }
      try {
        await this.processor.destroy();
      } catch { /* ignore */ }
      this.processor = null;
      throw e;
    }
  }

  async detach(micPublication?: any): Promise<void> {
    if (this.processor) {
      try {
        if (micPublication?.track) {
          await micPublication.track.stopProcessor();
        }
      } catch (e) {
        dbg("voice", "KrispProcessor stopProcessor error (may be already stopped)", e);
      }
      try {
        await this.processor.destroy();
      } catch {}
      this.processor = null;
      dbg("voice", "KrispProcessor detached");
    }
  }
}
