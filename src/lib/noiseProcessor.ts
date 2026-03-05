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
//
// IMPORTANT: If setProcessor() fails (WASM load, AudioWorklet, SAB), it can
// replace the WebRTC sender's track with a silent/broken processed track.
// We must call stopProcessor() to restore the original mic track on failure.
// ═══════════════════════════════════════════════════════════════════

export class KrispProcessor {
  private processor: any = null;

  async attach(micPublication: any): Promise<void> {
    await this.detach(micPublication);

    dbg("voice", "Krisp: importing @livekit/krisp-noise-filter...");
    const { KrispNoiseFilter } = await import("@livekit/krisp-noise-filter");
    dbg("voice", "Krisp: module imported, creating filter instance...");
    this.processor = KrispNoiseFilter();
    dbg("voice", "Krisp: filter created", {
      processorType: typeof this.processor,
      processorKeys: this.processor ? Object.keys(this.processor) : [],
    });

    const track = micPublication.track;
    dbg("voice", "Krisp: pre-attach track state", {
      trackSid: track?.sid,
      mediaStreamTrackId: track?.mediaStreamTrack?.id,
      mediaStreamTrackState: track?.mediaStreamTrack?.readyState,
      mediaStreamTrackEnabled: track?.mediaStreamTrack?.enabled,
      mediaStreamTrackMuted: track?.mediaStreamTrack?.muted,
      channelCount: track?.mediaStreamTrack?.getSettings?.()?.channelCount,
      sampleRate: track?.mediaStreamTrack?.getSettings?.()?.sampleRate,
      hasExistingProcessor: !!track?.processor,
    });

    try {
      await micPublication.track.setProcessor(this.processor);

      // Verify post-attach state
      dbg("voice", "Krisp: post-attach track state", {
        trackSid: track?.sid,
        mediaStreamTrackId: track?.mediaStreamTrack?.id,
        mediaStreamTrackState: track?.mediaStreamTrack?.readyState,
        mediaStreamTrackEnabled: track?.mediaStreamTrack?.enabled,
        processedTrack: !!this.processor?.processedTrack,
        processedTrackState: this.processor?.processedTrack?.readyState,
        processedTrackEnabled: this.processor?.processedTrack?.enabled,
        processedTrackChannels: this.processor?.processedTrack?.getSettings?.()?.channelCount,
      });
      dbg("voice", "Krisp: ATTACHED SUCCESSFULLY");

      // Verify audio is actually flowing through the processed track
      try {
        const processedMst = this.processor?.processedTrack;
        if (processedMst) {
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(new MediaStream([processedMst]));
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);

          // Sample audio levels over 2 seconds
          let sampleCount = 0;
          const interval = setInterval(() => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            sampleCount++;
            dbg("voice", `Krisp: audio level sample #${sampleCount} RMS=${rms.toFixed(4)}`);
            if (sampleCount >= 4) {
              clearInterval(interval);
              source.disconnect();
              analyser.disconnect();
              ctx.close().catch(() => {});
              dbg("voice", "Krisp: audio level monitoring complete");
            }
          }, 500);
        }
      } catch (e2) {
        dbg("voice", "Krisp: audio level check failed (non-fatal)", e2);
      }
    } catch (e) {
      // setProcessor failed — restore the original mic track
      dbg("voice", "Krisp: setProcessor FAILED, restoring original track", e);
      try {
        await micPublication.track.stopProcessor();
      } catch { /* track may not have a processor to stop */ }
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
