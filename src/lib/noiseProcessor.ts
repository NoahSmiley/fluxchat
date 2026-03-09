import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// Krisp Noise Suppression
//
// Uses LiveKit's Krisp integration — WASM-powered AI noise cancellation.
// Attaches directly to the LocalTrackPublication via setProcessor().
//
// The Krisp SDK has two gates we patch out in scripts/patch-krisp.js:
//   1. Safari/WKWebView version check (isSupported) — Tauri's WKWebView
//      on macOS is fully capable but doesn't report its version correctly.
//   2. Cloud license check (onPublish → setEnabled) — the SDK phones home
//      to the LiveKit Cloud server to verify Krisp is enabled on the account.
//      If this fails, the WASM stays suspended and audio passes through
//      unfiltered, while browser noiseSuppression is also disabled.
//
// IMPORTANT: If setProcessor() fails (WASM load, AudioWorklet, SAB), it can
// replace the WebRTC sender's track with a silent/broken processed track.
// We must call stopProcessor() to restore the original mic track on failure,
// and re-enable browser noiseSuppression since Krisp disables it during init.
// ═══════════════════════════════════════════════════════════════════

export class KrispProcessor {
  private processor: any = null;

  async attach(micPublication: any): Promise<void> {
    await this.detach(micPublication);

    dbg("voice", "Krisp: importing @livekit/krisp-noise-filter...");
    const { KrispNoiseFilter } = await import("@livekit/krisp-noise-filter");
    dbg("voice", "Krisp: module imported, creating filter instance...");
    this.processor = KrispNoiseFilter({ debugLogs: true });

    const track = micPublication.track;
    const originalTrackId = track?.mediaStreamTrack?.id;
    dbg("voice", "Krisp: pre-attach track state", {
      trackSid: track?.sid,
      originalTrackId,
      mediaStreamTrackState: track?.mediaStreamTrack?.readyState,
      channelCount: track?.mediaStreamTrack?.getSettings?.()?.channelCount,
      sampleRate: track?.mediaStreamTrack?.getSettings?.()?.sampleRate,
      hasExistingProcessor: !!track?.processor,
    });

    try {
      await micPublication.track.setProcessor(this.processor);

      dbg("voice", "Krisp: ATTACHED SUCCESSFULLY", {
        processedTrackId: this.processor?.processedTrack?.id,
        processedTrackState: this.processor?.processedTrack?.readyState,
        processedTrackChannels: this.processor?.processedTrack?.getSettings?.()?.channelCount,
        trackSwapped: originalTrackId !== this.processor?.processedTrack?.id,
      });

      // The WASM AudioWorklet has two gates: isEnabled AND isReady.
      // isEnabled() only checks a flag — even if true, audio passes through
      // unfiltered when the WASM module hasn't finished initializing (_isReady=false).
      // Poll and force-enable if needed.
      const p = this.processor;
      setTimeout(async () => {
        try {
          const enabled = p.isEnabled?.();
          dbg("voice", "Krisp: post-attach state check", { enabled });

          if (!enabled && p.setEnabled) {
            dbg("voice", "Krisp: not enabled — forcing setEnabled(true)");
            await p.setEnabled(true);
            dbg("voice", "Krisp: force-enabled, isEnabled now:", p.isEnabled?.());
          }
        } catch (e) {
          dbg("voice", "Krisp: post-attach check failed", e);
        }
      }, 3000);
    } catch (e) {
      // setProcessor failed — restore the original mic track
      dbg("voice", "Krisp: setProcessor FAILED, restoring original track", e);
      try {
        await micPublication.track.stopProcessor();
      } catch { /* track may not have a processor to stop */ }
      try {
        // Re-enable browser noise suppression — Krisp disables it via
        // applyConstraints({ noiseSuppression: false }) during init
        const mst = micPublication.track?.mediaStreamTrack;
        if (mst) await mst.applyConstraints({ noiseSuppression: true });
      } catch { /* ignore constraint errors */ }
      try {
        await this.processor.destroy();
      } catch { /* ignore */ }
      this.processor = null;
      throw e; // Re-throw so caller knows attachment failed
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
