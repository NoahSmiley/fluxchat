import { Track } from "livekit-client";
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client";

const DTLN_SAMPLE_RATE = 16000;

/**
 * Custom LiveKit TrackProcessor that wraps dtln-rs (WASM noise suppression).
 *
 * Uses a separate 16kHz AudioContext since the DTLN model is trained on 16kHz audio.
 * The browser auto-resamples the mic input, and LiveKit encodes the 16kHz output as Opus.
 *
 * Audio flow: original mic track → MediaStreamSource → DTLN AudioWorklet → MediaStreamDestination
 */
export class DtlnTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "dtln-noise-filter";
  processedTrack?: MediaStreamTrack;

  private dtlnContext: AudioContext | null = null;
  private dtlnNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    // Create a dedicated 16kHz AudioContext for DTLN processing
    this.dtlnContext = new AudioContext({ sampleRate: DTLN_SAMPLE_RATE });

    // Load the DTLN AudioWorklet (WASM bundle served from public/)
    await this.dtlnContext.audioWorklet.addModule("/dtln/audio-worklet.js");

    // Create the worklet node
    this.dtlnNode = new AudioWorkletNode(
      this.dtlnContext,
      "NoiseSuppressionWorker",
      { processorOptions: { disableMetrics: true } },
    );

    // Wait for the WASM module to initialize
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("DTLN module initialization timed out")),
        10000,
      );
      this.dtlnNode!.port.onmessage = (event) => {
        if (event.data === "ready") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    // Wire up: source → dtln → destination
    const stream = new MediaStream([track]);
    this.sourceNode = this.dtlnContext.createMediaStreamSource(stream);
    this.destinationNode = this.dtlnContext.createMediaStreamDestination();

    this.sourceNode.connect(this.dtlnNode);
    this.dtlnNode.connect(this.destinationNode);

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
      this.dtlnNode?.disconnect();
    } catch {}

    if (this.dtlnContext && this.dtlnContext.state !== "closed") {
      try {
        await this.dtlnContext.close();
      } catch {}
    }

    this.sourceNode = null;
    this.dtlnNode = null;
    this.destinationNode = null;
    this.dtlnContext = null;
    this.processedTrack = undefined;
  }
}
