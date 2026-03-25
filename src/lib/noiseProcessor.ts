import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// Krisp Noise Suppression
//
// Uses LiveKit's official Krisp integration pattern:
//   1. Listen for LocalTrackPublished (microphone)
//   2. KrispNoiseFilter() — create instance
//   3. track.setProcessor(processor) — attach to mic track
//   4. processor.setEnabled(true) — enable filtering
//
// The Krisp SDK fetches models at runtime from LiveKit's CDN and
// validates the license against the LiveKit Cloud server.
//
// scripts/patch-krisp.js patches:
//   - Safari/WKWebView version gate (Tauri reports incorrectly)
//   - SharedArrayBuffer noise level init (SDK bug: zero-init → level 0)
// ═══════════════════════════════════════════════════════════════════

/**
 * Create and attach a Krisp noise filter to a mic track publication.
 * Returns the processor instance (for later toggle/detach), or null on failure.
 */
export async function attachNoiseFilter(micPub: any): Promise<any | null> {
  if (!micPub?.track) {
    dbg("voice", "Krisp: no mic track to attach to");
    return null;
  }

  try {
    const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import(
      "@livekit/krisp-noise-filter"
    );

    if (!isKrispNoiseFilterSupported()) {
      dbg("voice", "Krisp: not supported on this browser");
      return null;
    }

    const processor = KrispNoiseFilter({ useBVC: false });
    await micPub.track.setProcessor(processor);
    await processor.setEnabled(true);
    const isEnabled = processor.isEnabled?.();
    dbg("voice", `Krisp: ${isEnabled ? "ACTIVE" : "FAILED to enable"}`);
    return processor;
  } catch (e) {
    dbg("voice", "Krisp: attach FAILED", e);
    try {
      await micPub.track.stopProcessor();
    } catch { /* may not have a processor to stop */ }
    return null;
  }
}

/**
 * Detach and destroy a noise filter processor from a mic track.
 */
export async function detachNoiseFilter(processor: any, micPub?: any): Promise<void> {
  if (!processor) return;
  try {
    if (micPub?.track) {
      await micPub.track.stopProcessor();
    }
  } catch (e) {
    dbg("voice", "Krisp: stopProcessor error (may be already stopped)", e);
  }
  try {
    await processor.destroy();
  } catch { /* ignore */ }
  dbg("voice", "Krisp: detached");
}
