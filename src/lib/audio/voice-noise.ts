import { Track } from "livekit-client";
import type { TrackProcessor, AudioProcessorOptions } from "livekit-client";
import type { NoiseSuppressionModel } from "../../stores/voice/index.js";

// ── AI Noise Suppression (multiple models) ──

let noiseProcessor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> | null = null;
let activeNoiseModel: NoiseSuppressionModel = "off";
let noiseSwitchNonce = 0; // concurrency guard for model switching
let dryWetProcessor: import("./DryWetTrackProcessor.js").DryWetTrackProcessor | null = null;
let gainTrackProcessor: import("./GainTrackProcessor.js").GainTrackProcessor | null = null;

async function createNoiseProcessor(model: NoiseSuppressionModel): Promise<TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>> {
  switch (model) {
    case "speex": {
      const { SpeexTrackProcessor } = await import("./speex/SpeexTrackProcessor.js");
      return new SpeexTrackProcessor();
    }
    case "dtln": {
      const { DtlnTrackProcessor } = await import("./dtln/DtlnTrackProcessor.js");
      return new DtlnTrackProcessor();
    }
    case "rnnoise": {
      const { RnnoiseTrackProcessor } = await import("./rnnoise/RnnoiseTrackProcessor.js");
      return new RnnoiseTrackProcessor();
    }
    case "deepfilter": {
      const { DeepFilterTrackProcessor } = await import("./deepfilter/DeepFilterTrackProcessor.js");
      return new DeepFilterTrackProcessor();
    }
    case "nsnet2": {
      const { NSNet2TrackProcessor } = await import("./nsnet2/NSNet2TrackProcessor.js");
      return new NSNet2TrackProcessor();
    }
    default:
      throw new Error(`Unknown noise suppression model: ${model}`);
  }
}

export async function getOrCreateNoiseProcessor(model: NoiseSuppressionModel) {
  if (model === "off") {
    await destroyNoiseProcessor();
    return null;
  }
  // If switching models, destroy old first
  if (noiseProcessor && activeNoiseModel !== model) {
    await destroyNoiseProcessor();
  }
  if (!noiseProcessor) {
    noiseProcessor = await createNoiseProcessor(model);
    activeNoiseModel = model;
  }
  return noiseProcessor;
}

export async function destroyNoiseProcessor() {
  if (noiseProcessor) {
    await (noiseProcessor as any).destroy?.();
    noiseProcessor = null;
    activeNoiseModel = "off";
  }
}

export function getNoiseProcessor() {
  return noiseProcessor;
}

export function getActiveNoiseModel() {
  return activeNoiseModel;
}

export function getNoiseSwitchNonce() {
  return noiseSwitchNonce;
}

export function incrementNoiseSwitchNonce() {
  return ++noiseSwitchNonce;
}

export function getDryWetProcessor() {
  return dryWetProcessor;
}

export function setDryWetProcessor(p: typeof dryWetProcessor) {
  dryWetProcessor = p;
}

export function getGainTrackProcessor() {
  return gainTrackProcessor;
}

export function setGainTrackProcessor(p: typeof gainTrackProcessor) {
  gainTrackProcessor = p;
}
