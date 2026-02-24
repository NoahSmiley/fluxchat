import {
  destroyNoiseProcessor,
  setDryWetProcessor,
  setGainTrackProcessor,
} from "@/lib/audio/voice-noise.js";

/** Tear down all noise-suppression / gain processors in one call. */
export async function cleanupAudioProcessors() {
  await destroyNoiseProcessor();
  setDryWetProcessor(null);
  setGainTrackProcessor(null);
}
