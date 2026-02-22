import { Track } from "livekit-client";
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client";

/**
 * Wrapper TrackProcessor that blends processed + original signals for suppression strength control.
 *
 * Audio flow:
 *   original track ─── preGain ─── dryGain (1 - strength) ──┐
 *                                                             ├── destination -> processedTrack
 *   original track ─── preGain ─── innerProcessor ── wetGain (strength) ──┘
 *
 * Also includes a mic pre-gain GainNode for micInputGain control.
 */
export class DryWetTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "dry-wet-mix";
  processedTrack?: MediaStreamTrack;

  private context: AudioContext | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private preGain: GainNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  private innerProcessor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>;
  private _strength: number; // 0-1

  constructor(
    innerProcessor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>,
    strength: number = 1.0,
  ) {
    this.innerProcessor = innerProcessor;
    this._strength = strength;
  }

  get strength(): number {
    return this._strength;
  }

  set strength(value: number) {
    this._strength = Math.max(0, Math.min(1, value));
    if (this.dryGain && this.wetGain && this.context) {
      const t = this.context.currentTime;
      this.dryGain.gain.setValueAtTime(1 - this._strength, t);
      this.wetGain.gain.setValueAtTime(this._strength, t);
    }
  }

  /** Update mic pre-gain (0-2 range, where 1 = unity) */
  setPreGain(value: number) {
    if (this.preGain && this.context) {
      this.preGain.gain.setValueAtTime(Math.max(0, value), this.context.currentTime);
    }
  }

  getInnerProcessor(): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
    return this.innerProcessor;
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    // Create audio context matching the track sample rate
    const trackSettings = track.getSettings();
    const sampleRate = trackSettings.sampleRate || 48000;
    this.context = new AudioContext({ sampleRate });

    // Create pre-gain for mic input gain control
    this.preGain = this.context.createGain();
    this.preGain.gain.value = 1.0;

    // Create dry/wet gain nodes
    this.dryGain = this.context.createGain();
    this.dryGain.gain.value = 1 - this._strength;

    this.wetGain = this.context.createGain();
    this.wetGain.gain.value = this._strength;

    // Create source from original track
    const stream = new MediaStream([track]);
    this.sourceNode = this.context.createMediaStreamSource(stream);
    this.destinationNode = this.context.createMediaStreamDestination();

    // Source -> preGain
    this.sourceNode.connect(this.preGain);

    // Dry path: preGain -> dryGain -> destination
    this.preGain.connect(this.dryGain);
    this.dryGain.connect(this.destinationNode);

    // Create a pre-gained track for the inner processor
    const preGainDest = this.context.createMediaStreamDestination();
    this.preGain.connect(preGainDest);
    const preGainedTrack = preGainDest.stream.getAudioTracks()[0];

    // Initialize inner processor with the pre-gained track
    await this.innerProcessor.init({ track: preGainedTrack } as AudioProcessorOptions);

    // Wet path: inner processor output -> wetGain -> destination
    if (this.innerProcessor.processedTrack) {
      const wetStream = new MediaStream([this.innerProcessor.processedTrack]);
      const wetSource = this.context.createMediaStreamSource(wetStream);
      wetSource.connect(this.wetGain);
      this.wetGain.connect(this.destinationNode);
    }

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    // Destroy inner processor first
    try {
      await this.innerProcessor.destroy?.();
    } catch {}

    try {
      this.sourceNode?.disconnect();
    } catch {}
    try {
      this.preGain?.disconnect();
    } catch {}
    try {
      this.dryGain?.disconnect();
    } catch {}
    try {
      this.wetGain?.disconnect();
    } catch {}

    if (this.context && this.context.state !== "closed") {
      try {
        await this.context.close();
      } catch {}
    }

    this.sourceNode = null;
    this.preGain = null;
    this.dryGain = null;
    this.wetGain = null;
    this.destinationNode = null;
    this.context = null;
    this.processedTrack = undefined;
  }
}
