import { Track } from "livekit-client";
import { dbg } from "../lib/debug.js";
import type { AudioSettings } from "../lib/audio/voice-pipeline.js";
import {
  audioPipelines,
  rebuildAllPipelines,
} from "../lib/audio/voice-pipeline.js";
import {
  getOrCreateNoiseProcessor,
  destroyNoiseProcessor,
  getNoiseProcessor,
  getActiveNoiseModel,
  getNoiseSwitchNonce,
  incrementNoiseSwitchNonce,
  getDryWetProcessor,
  setDryWetProcessor,
  getGainTrackProcessor,
  setGainTrackProcessor,
} from "../lib/audio/voice-noise.js";
import { getLocalMicTrack } from "../lib/audio/voice-analysis.js";
import { saveAudioSettings } from "./voice-audio-settings.js";
import { cleanupAudioProcessors } from "./voice-helpers.js";
import type { NoiseSuppressionModel, VoiceState } from "./voice-types.js";
import type { StoreApi } from "zustand";

export function createUpdateAudioSetting(storeRef: StoreApi<VoiceState>) {
  return (key: keyof AudioSettings, value: boolean | number | string) => {
    dbg("voice", `updateAudioSetting ${key}=${value}`);
    const get = () => storeRef.getState();
    const set = (partial: Partial<VoiceState>) => { storeRef.setState(partial); };

    const { room, audioSettings } = get();
    const newSettings = { ...audioSettings, [key]: value } as AudioSettings;
    set({ audioSettings: newSettings });
    saveAudioSettings(newSettings);

    // Input sensitivity settings are handled by the polling loop, no action needed
    if (key === "inputSensitivity" || key === "inputSensitivityEnabled") {
      // If disabling the gate, release it immediately
      if (key === "inputSensitivityEnabled" && !value && room) {
        // Re-enable track when disabling the gate
        const micTrack = getLocalMicTrack();
        if (micTrack) micTrack.enabled = true;
        room.localParticipant.setMicrophoneEnabled(true);
      }
      return;
    }

    // Noise gate hold time is used by the polling loop directly
    if (key === "noiseGateHoldTime") return;

    // Suppression strength — update DryWetTrackProcessor live
    if (key === "suppressionStrength") {
      const dwp = getDryWetProcessor();
      if (dwp) {
        dwp.strength = (value as number) / 100;
      }
      return;
    }

    // VAD threshold — post message to RNNoise worklet
    if (key === "vadThreshold") {
      if (getActiveNoiseModel() === "rnnoise" && getNoiseProcessor()) {
        const dwp = getDryWetProcessor();
        const innerProc = dwp
          ? dwp.getInnerProcessor()
          : getNoiseProcessor();
        if (innerProc && "setVadThreshold" in innerProc) {
          (innerProc as any).setVadThreshold((value as number) / 100);
        }
      }
      return;
    }

    // Mic input gain — update DryWetTrackProcessor pre-gain or GainTrackProcessor
    if (key === "micInputGain") {
      const dwp = getDryWetProcessor();
      if (dwp) {
        dwp.setPreGain((value as number) / 100);
      } else if (newSettings.noiseSuppressionModel === "off" && room) {
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        if (micPub?.track) {
          if ((value as number) !== 100) {
            // Need gain processing — create or update GainTrackProcessor
            const gtp = getGainTrackProcessor();
            if (gtp) {
              gtp.setGain((value as number) / 100);
            } else {
              const setupGain = async () => {
                try {
                  const { GainTrackProcessor } = await import("../lib/audio/GainTrackProcessor.js");
                  const newGtp = new GainTrackProcessor((value as number) / 100);
                  setGainTrackProcessor(newGtp);
                  await micPub.track!.setProcessor(newGtp as any);
                } catch (e) {
                  dbg("voice", "Failed to setup GainTrackProcessor:", e);
                  setGainTrackProcessor(null);
                }
              };
              setupGain();
            }
          } else if (getGainTrackProcessor()) {
            // Gain is 100% (unity) — remove processor
            micPub.track.stopProcessor().then(() => {
              setGainTrackProcessor(null);
            }).catch((e) => {
              dbg("voice", "Failed to stop gain processor:", e);
              setGainTrackProcessor(null);
            });
          }
        }
      }
      return;
    }

    // Compressor settings — update DynamicsCompressorNode params on all active pipelines
    if (key === "compressorThreshold" || key === "compressorRatio" || key === "compressorAttack" || key === "compressorRelease") {
      for (const pipeline of audioPipelines.values()) {
        if (pipeline.compressor) {
          if (key === "compressorThreshold") pipeline.compressor.threshold.value = value as number;
          if (key === "compressorRatio") pipeline.compressor.ratio.value = value as number;
          if (key === "compressorAttack") pipeline.compressor.attack.value = value as number;
          if (key === "compressorRelease") pipeline.compressor.release.value = value as number;
        }
      }
      return;
    }

    // Compressor toggle — rebuild pipelines
    if (key === "compressorEnabled") {
      rebuildAllPipelines(newSettings, get().participantVolumes, get().participantTrackMap, get().isDeafened);
      return;
    }

    // De-esser strength — update BiquadFilterNode gain on all active pipelines
    if (key === "deEsserStrength") {
      for (const pipeline of audioPipelines.values()) {
        if (pipeline.deEsser) {
          pipeline.deEsser.gain.value = -((value as number) / 100) * 12;
        }
      }
      return;
    }

    // De-esser toggle — rebuild pipelines
    if (key === "deEsserEnabled") {
      rebuildAllPipelines(newSettings, get().participantVolumes, get().participantTrackMap, get().isDeafened);
      return;
    }

    // AI noise suppression model switch
    if (key === "noiseSuppressionModel") {
      if (!room) {
        dbg("voice", "noiseSuppressionModel: no room, skipping");
        return;
      }
      const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (!micPub?.track) {
        dbg("voice", "noiseSuppressionModel: no mic track published, skipping");
        return;
      }
      const model = value as NoiseSuppressionModel;

      if (model === "off") {
        const currentGain = get().audioSettings.micInputGain;
        micPub.track.stopProcessor()
          .then(async () => {
            destroyNoiseProcessor();
            setDryWetProcessor(null);
            // If mic gain is non-unity, set up GainTrackProcessor
            if (currentGain !== 100 && micPub.track) {
              try {
                const { GainTrackProcessor } = await import("../lib/audio/GainTrackProcessor.js");
                const gtp = new GainTrackProcessor(currentGain / 100);
                setGainTrackProcessor(gtp);
                await micPub.track.setProcessor(gtp as any);
              } catch (e2) {
                dbg("voice", "Failed to setup GainTrackProcessor:", e2);
                setGainTrackProcessor(null);
              }
            }
          })
          .catch((e) => {
            dbg("voice", "Failed to stop noise processor during model switch:", e);
            destroyNoiseProcessor();
            setDryWetProcessor(null);
          });
      } else {
        // Stop existing processor first, then attach new one
        const myNonce = incrementNoiseSwitchNonce();
        const switchModel = async () => {
          try {
            if (getNoiseProcessor() || getDryWetProcessor() || getGainTrackProcessor()) {
              await micPub.track!.stopProcessor();
              await cleanupAudioProcessors();
            }
            if (myNonce !== getNoiseSwitchNonce()) return;
            const processor = await getOrCreateNoiseProcessor(model);
            if (myNonce !== getNoiseSwitchNonce()) return;
            if (processor) {
              const currentSettings = get().audioSettings;
              const strength = currentSettings.suppressionStrength / 100;

              // Apply VAD threshold if switching to RNNoise
              if (model === "rnnoise" && "setVadThreshold" in processor) {
                (processor as any).setVadThreshold(currentSettings.vadThreshold / 100);
              }

              // Always wrap with DryWetTrackProcessor so micInputGain works at any suppression strength
              const { DryWetTrackProcessor } = await import("../lib/audio/DryWetTrackProcessor.js");
              const dwp = new DryWetTrackProcessor(processor, strength);
              dwp.setPreGain(currentSettings.micInputGain / 100);
              setDryWetProcessor(dwp);
              await micPub.track!.setProcessor(dwp as any);
              dbg("voice", `Noise suppression model switched to ${model}`);
            }
          } catch (e) {
            if (myNonce !== getNoiseSwitchNonce()) return;
            dbg("voice", `Noise model ${model} failed — reverting to off`, e instanceof Error ? e.message : e);
            await destroyNoiseProcessor();
            setDryWetProcessor(null);
            set({ audioSettings: { ...get().audioSettings, noiseSuppressionModel: "off" } });
            saveAudioSettings(get().audioSettings);
          }
        };
        switchModel();
      }
      return;
    }

    // Apply filter changes instantly to all pipelines
    if (key === "highPassFrequency") {
      for (const pipeline of audioPipelines.values()) {
        pipeline.highPass.frequency.value = (value as number) > 0 ? (value as number) : 0;
      }
      return;
    }
    if (key === "lowPassFrequency") {
      for (const pipeline of audioPipelines.values()) {
        pipeline.lowPass.frequency.value = (value as number) > 0 ? (value as number) : 24000;
      }
      return;
    }

    if (!room) return;

    // DTX or audio processing changes require republishing
    if (key === "dtx" || key === "noiseSuppression" || key === "echoCancellation" || key === "autoGainControl") {
      const micEnabled = room.localParticipant.isMicrophoneEnabled;
      if (micEnabled) {
        room.localParticipant.setMicrophoneEnabled(false).then(() => {
          room.localParticipant.setMicrophoneEnabled(true, {
            echoCancellation: newSettings.echoCancellation,
            noiseSuppression: newSettings.noiseSuppression,
            autoGainControl: newSettings.autoGainControl,
          });
        });
      }
    }
  };
}
