import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// DeepFilterNet3 Noise Suppression
//
// Open-source alternative to Krisp. Uses the same LiveKit TrackProcessor
// API (track.setProcessor / track.stopProcessor) so it's a drop-in swap.
//
// The deepfilternet3-noise-filter package fetches WASM + model assets
// from its own CDN at runtime.
// ═══════════════════════════════════════════════════════════════════

/**
 * Create and attach a DeepFilterNet3 noise filter to a mic track publication.
 * Returns the processor instance (for later toggle/detach), or null on failure.
 */
export async function attachDeepFilter(micPub: any): Promise<any | null> {
  if (!micPub?.track) {
    dbg("voice", "DeepFilter: no mic track to attach to");
    return null;
  }

  try {
    const { DeepFilterNoiseFilter, DeepFilterNoiseFilterProcessor } = await import(
      "deepfilternet3-noise-filter"
    );

    if (!DeepFilterNoiseFilterProcessor.isSupported()) {
      dbg("voice", "DeepFilter: not supported on this browser");
      return null;
    }

    const processor = DeepFilterNoiseFilter({ sampleRate: 48000 });
    await micPub.track.setProcessor(processor);
    await processor.setEnabled(true);
    const isEnabled = processor.isEnabled?.();
    dbg("voice", `DeepFilter: ${isEnabled ? "ACTIVE" : "FAILED to enable"}`);
    return processor;
  } catch (e) {
    dbg("voice", "DeepFilter: attach FAILED", e);
    try {
      await micPub.track.stopProcessor();
    } catch { /* may not have a processor to stop */ }
    return null;
  }
}

/**
 * Detach and destroy a DeepFilterNet3 processor from a mic track.
 */
export async function detachDeepFilter(processor: any, micPub?: any): Promise<void> {
  if (!processor) return;
  try {
    if (micPub?.track) {
      await micPub.track.stopProcessor();
    }
  } catch (e) {
    dbg("voice", "DeepFilter: stopProcessor error (may be already stopped)", e);
  }
  try {
    await processor.destroy();
  } catch { /* ignore */ }
  dbg("voice", "DeepFilter: detached");
}
