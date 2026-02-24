import { Room, Track } from "livekit-client";
import { dbg } from "../../lib/debug.js";
import {
  getOrCreateNoiseProcessor,
  destroyNoiseProcessor,
  setDryWetProcessor,
  setGainTrackProcessor,
} from "../../lib/audio/voice-noise.js";
import type { VoiceState } from "./types.js";

export async function setupNoiseProcessor(
  room: Room,
  audioSettings: VoiceState["audioSettings"],
  get: () => VoiceState,
  set: (partial: Partial<VoiceState>) => void,
) {
  if (audioSettings.noiseSuppressionModel !== "off") {
    try {
      const processor = await getOrCreateNoiseProcessor(audioSettings.noiseSuppressionModel);
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.track && processor) {
        if (audioSettings.noiseSuppressionModel === "rnnoise" && "setVadThreshold" in processor) {
          (processor as any).setVadThreshold(audioSettings.vadThreshold / 100);
        }
        const strength = audioSettings.suppressionStrength / 100;
        const { DryWetTrackProcessor } = await import("../../lib/audio/DryWetTrackProcessor.js");
        const dwp = new DryWetTrackProcessor(processor, strength);
        dwp.setPreGain(audioSettings.micInputGain / 100);
        setDryWetProcessor(dwp);
        await micPub.track.setProcessor(dwp as any);
      }
    } catch (e) {
      dbg("voice", "joinVoiceChannel noise filter setup failed", e);
      await destroyNoiseProcessor();
      setDryWetProcessor(null);
      set({ audioSettings: { ...get().audioSettings, noiseSuppressionModel: "off" } });
    }
  } else if (audioSettings.micInputGain !== 100) {
    try {
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (micPub?.track) {
        const { GainTrackProcessor } = await import("../../lib/audio/GainTrackProcessor.js");
        const gtp = new GainTrackProcessor(audioSettings.micInputGain / 100);
        setGainTrackProcessor(gtp);
        await micPub.track.setProcessor(gtp as any);
      }
    } catch (e) {
      dbg("voice", "joinVoiceChannel GainTrackProcessor setup failed", e);
      setGainTrackProcessor(null);
    }
  }
}
