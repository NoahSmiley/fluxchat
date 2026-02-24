import type { Track, AudioProcessorOptions, TrackProcessor } from "livekit-client";

/**
 * Minimal TrackProcessor that applies a GainNode to the mic track.
 * Used when noise suppression is off but micInputGain != 100%.
 *
 * Audio flow:
 *   mic track -> AudioContext(48kHz) -> MediaStreamSource -> GainNode -> MediaStreamDestination -> processedTrack
 */
export class GainTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "gain-processor";
  processedTrack?: MediaStreamTrack;

  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  private _gain: number;

  constructor(gain: number = 1.0) {
    this._gain = gain;
  }

  setGain(value: number) {
    this._gain = Math.max(0, value);
    if (this.gainNode && this.context) {
      this.gainNode.gain.setValueAtTime(this._gain, this.context.currentTime);
    }
  }

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    const trackSettings = track.getSettings();
    const sampleRate = trackSettings.sampleRate || 48000;
    this.context = new AudioContext({ sampleRate });

    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this._gain;

    const stream = new MediaStream([track]);
    this.sourceNode = this.context.createMediaStreamSource(stream);
    this.destinationNode = this.context.createMediaStreamDestination();

    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.destinationNode);

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    try {
      this.sourceNode?.disconnect();
    } catch {}
    try {
      this.gainNode?.disconnect();
    } catch {}

    if (this.context && this.context.state !== "closed") {
      try {
        await this.context.close();
      } catch {}
    }

    this.sourceNode = null;
    this.gainNode = null;
    this.destinationNode = null;
    this.context = null;
    this.processedTrack = undefined;
  }
}
