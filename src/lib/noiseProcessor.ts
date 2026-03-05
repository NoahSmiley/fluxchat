import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// Krisp Noise Suppression
//
// Uses LiveKit's Krisp integration — cloud-powered AI noise cancellation.
// Attaches directly to the LocalTrackPublication via setProcessor().
//
// The Krisp SDK rejects WKWebView because it detects navigator.vendor="Apple"
// and then checks the Safari version from the UA string, which WKWebView
// doesn't report correctly. Tauri's WKWebView on macOS 15+ is fully capable
// (AudioWorklet, SharedArrayBuffer, etc.), so we bypass the check via
// scripts/patch-krisp.js which runs on postinstall.
// ═══════════════════════════════════════════════════════════════════

export class KrispProcessor {
  private processor: any = null;

  async attach(micPublication: any): Promise<void> {
    await this.detach(micPublication);

    const { KrispNoiseFilter } = await import("@livekit/krisp-noise-filter");
    this.processor = KrispNoiseFilter();

    await micPublication.track.setProcessor(this.processor);
    dbg("voice", "KrispProcessor attached");
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
