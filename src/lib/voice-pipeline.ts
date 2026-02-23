import { dbg } from "./debug.js";

// ── Audio Pipeline (Web Audio API) ──

export interface AudioPipeline {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  element: HTMLAudioElement;
  highPass: BiquadFilterNode;
  lowPass: BiquadFilterNode;
  deEsser: BiquadFilterNode | null;
  compressor: DynamicsCompressorNode | null;
  gain: GainNode;
  analyser: AnalyserNode;
  analyserData: Float32Array;
}

export interface AudioSettings {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  dtx: boolean;
  highPassFrequency: number;
  lowPassFrequency: number;
  inputSensitivity: number;
  inputSensitivityEnabled: boolean;
  noiseSuppressionModel: import("../stores/voice.js").NoiseSuppressionModel;
  suppressionStrength: number;
  vadThreshold: number;
  micInputGain: number;
  noiseGateHoldTime: number;
  compressorEnabled: boolean;
  compressorThreshold: number;
  compressorRatio: number;
  compressorAttack: number;
  compressorRelease: number;
  deEsserEnabled: boolean;
  deEsserStrength: number;
}

export const audioPipelines = new Map<string, AudioPipeline>();

export function calculateRms(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

export function setGainValue(pipeline: AudioPipeline, value: number) {
  pipeline.gain.gain.cancelScheduledValues(pipeline.context.currentTime);
  pipeline.gain.gain.setValueAtTime(value, pipeline.context.currentTime);
}

export function createAudioPipeline(
  audioElement: HTMLAudioElement,
  trackSid: string,
  settings: AudioSettings,
  volume: number,
): AudioPipeline {
  const mst = (audioElement.srcObject as MediaStream)?.getAudioTracks()[0];
  dbg("voice", `createAudioPipeline sid=${trackSid}`, {
    elementPaused: audioElement.paused,
    elementReadyState: audioElement.readyState,
    elementSrcObject: !!audioElement.srcObject,
    trackKind: mst?.kind,
    trackEnabled: mst?.enabled,
    trackReadyState: mst?.readyState,
    trackMuted: mst?.muted,
    trackLabel: mst?.label,
    volume,
    highPass: settings.highPassFrequency,
    lowPass: settings.lowPassFrequency,
    pipelinesActive: audioPipelines.size,
  });

  // Silence the attached element — all playback goes through the Web Audio pipeline.
  // Use volume=0 (not mute/pause/remove) so the element keeps "playing" and
  // the WebRTC track stays active and feeds data to our MediaStreamSource.
  audioElement.volume = 0;
  dbg("voice", `createAudioPipeline silenced element volume=${audioElement.volume}`);

  const context = new AudioContext();
  dbg("voice", `createAudioPipeline audioContext created state=${context.state} sampleRate=${context.sampleRate}`);
  if (context.state === "suspended") {
    context.resume().then(() => {
      dbg("voice", `createAudioPipeline audioContext resumed state=${context.state}`);
    });
  }

  // Use createMediaStreamSource with the raw MediaStreamTrack — this works
  // reliably with WebRTC tracks (unlike createMediaElementSource which
  // doesn't capture audio from srcObject-based elements).
  const stream = new MediaStream([mst!]);
  const source = context.createMediaStreamSource(stream);
  dbg("voice", `createAudioPipeline mediaStreamSource created channelCount=${source.channelCount}`);

  // Explicit mono→stereo: duplicate channel 0 to both L and R
  // so audio always plays through both ears regardless of source channel count
  const splitter = context.createChannelSplitter(1);
  const merger = context.createChannelMerger(2);
  source.connect(splitter);
  splitter.connect(merger, 0, 0); // → left
  splitter.connect(merger, 0, 1); // → right

  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = settings.highPassFrequency > 0 ? settings.highPassFrequency : 0;

  const lowPass = context.createBiquadFilter();
  lowPass.type = "lowpass";
  lowPass.frequency.value = settings.lowPassFrequency > 0 ? settings.lowPassFrequency : 24000;

  const gain = context.createGain();
  // Fade in over 50ms to prevent click/pop when pipeline starts
  gain.gain.setValueAtTime(0, context.currentTime);
  gain.gain.linearRampToValueAtTime(volume, context.currentTime + 0.05);

  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const analyserData = new Float32Array(analyser.fftSize);

  // Build chain: merger -> highPass -> lowPass -> [deEsser] -> [compressor] -> analyser -> gain -> destination
  merger.connect(highPass);
  highPass.connect(lowPass);

  let lastNode: AudioNode = lowPass;

  // De-esser: highshelf filter that attenuates sibilance (4-8kHz range)
  let deEsser: BiquadFilterNode | null = null;
  if (settings.deEsserEnabled) {
    deEsser = context.createBiquadFilter();
    deEsser.type = "highshelf";
    deEsser.frequency.value = 5500;
    deEsser.gain.value = -(settings.deEsserStrength / 100) * 12; // 0 to -12dB
    lastNode.connect(deEsser);
    lastNode = deEsser;
  }

  // Compressor: dynamics compression
  let compressor: DynamicsCompressorNode | null = null;
  if (settings.compressorEnabled) {
    compressor = context.createDynamicsCompressor();
    compressor.threshold.value = settings.compressorThreshold;
    compressor.ratio.value = settings.compressorRatio;
    compressor.attack.value = settings.compressorAttack;
    compressor.release.value = settings.compressorRelease;
    compressor.knee.value = 10;
    lastNode.connect(compressor);
    lastNode = compressor;
  }

  lastNode.connect(analyser);
  analyser.connect(gain);
  gain.connect(context.destination);

  const pipeline: AudioPipeline = { context, source, element: audioElement, highPass, lowPass, deEsser, compressor, gain, analyser, analyserData };
  audioPipelines.set(trackSid, pipeline);

  // Diagnostic: check if audio data is flowing after 1 second
  setTimeout(() => {
    if (!audioPipelines.has(trackSid)) return;
    analyser.getFloatTimeDomainData(analyserData);
    const rms = calculateRms(analyserData);
    dbg("voice", `createAudioPipeline DIAG sid=${trackSid}`, {
      contextState: context.state,
      rms: rms.toFixed(6),
      hasSignal: rms > 0.0001,
      gainValue: gain.gain.value,
      elementPaused: audioElement.paused,
      elementEnded: audioElement.ended,
      elementCurrentTime: audioElement.currentTime,
      trackEnabled: mst?.enabled,
      trackReadyState: mst?.readyState,
      trackMuted: mst?.muted,
    });
  }, 1500);

  return pipeline;
}

export function getPipelineLevel(pipeline: AudioPipeline): number {
  pipeline.analyser.getFloatTimeDomainData(pipeline.analyserData);
  return calculateRms(pipeline.analyserData);
}

export function destroyAudioPipeline(trackSid: string) {
  const pipeline = audioPipelines.get(trackSid);
  if (pipeline) {
    dbg("voice", `destroyAudioPipeline sid=${trackSid}`, { remaining: audioPipelines.size - 1 });
    // Mute gain instantly to prevent static/click on teardown
    try {
      setGainValue(pipeline, 0);
    } catch {}
    try {
      pipeline.gain.disconnect();
      pipeline.source.disconnect();
    } catch {}
    pipeline.element.pause();
    pipeline.element.srcObject = null;
    pipeline.context.close();
    audioPipelines.delete(trackSid);
  }
}

/** Rebuild all active audio pipelines (e.g. when compressor/de-esser is toggled) */
export function rebuildAllPipelines(settings: AudioSettings, participantVolumes: Record<string, number>, participantTrackMap: Record<string, string>, isDeafened: boolean) {
  // Snapshot current pipelines before destroying (destroy nulls srcObject)
  const snapshot: { trackSid: string; element: HTMLAudioElement; srcObject: MediaStream; volume: number }[] = [];
  for (const [trackSid, pipeline] of audioPipelines.entries()) {
    const srcObject = pipeline.element.srcObject;
    if (!(srcObject instanceof MediaStream)) continue;
    let volume = 1.0;
    for (const [identity, sid] of Object.entries(participantTrackMap)) {
      if (sid === trackSid) {
        volume = isDeafened ? 0 : (participantVolumes[identity] ?? 1.0);
        break;
      }
    }
    snapshot.push({ trackSid, element: pipeline.element, srcObject, volume });
  }
  // Destroy all, then rebuild from snapshot
  for (const { trackSid } of snapshot) {
    destroyAudioPipeline(trackSid);
  }
  for (const { trackSid, element, srcObject, volume } of snapshot) {
    element.srcObject = srcObject;
    createAudioPipeline(element, trackSid, settings, volume);
  }
}

export function destroyAllPipelines() {
  dbg("voice", `destroyAllPipelines count=${audioPipelines.size}`);
  for (const trackSid of [...audioPipelines.keys()]) {
    destroyAudioPipeline(trackSid);
  }
}
