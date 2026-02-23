import type { Track, AudioProcessorOptions, TrackProcessor } from "livekit-client";

const SPEEX_SAMPLE_RATE = 48000;

/**
 * Custom LiveKit TrackProcessor that wraps Speex DSP-based noise suppression.
 *
 * Uses @sapphi-red/web-noise-suppressor which provides a lightweight (~50KB WASM)
 * Speex-based noise preprocessor. Ultra-low CPU usage, minimal latency.
 *
 * Audio flow: original mic track -> MediaStreamSource -> SpeexWorkletNode -> MediaStreamDestination
 */
export class SpeexTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "speex-noise-filter";
  processedTrack?: MediaStreamTrack;

  private speexContext: AudioContext | null = null;
  private speexNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    // Import the Speex worklet JS and WASM paths using Vite ?url imports
    const speexWorkletUrl = (await import("@sapphi-red/web-noise-suppressor/speexWorklet.js?url")).default;
    const speexWasmUrl = (await import("@sapphi-red/web-noise-suppressor/speex.wasm?url")).default;

    // Load the WASM binary
    const { loadSpeex, SpeexWorkletNode } = await import("@sapphi-red/web-noise-suppressor");
    const wasmBinary = await loadSpeex({ url: speexWasmUrl });

    // Create a 48kHz AudioContext
    this.speexContext = new AudioContext({ sampleRate: SPEEX_SAMPLE_RATE });

    // Load the Speex AudioWorklet
    await this.speexContext.audioWorklet.addModule(speexWorkletUrl);

    // Create the worklet node
    this.speexNode = new SpeexWorkletNode(this.speexContext, {
      maxChannels: 1,
      wasmBinary,
    });

    // Wire up: source -> speex -> destination
    const stream = new MediaStream([track]);
    this.sourceNode = this.speexContext.createMediaStreamSource(stream);
    this.destinationNode = this.speexContext.createMediaStreamDestination();

    this.sourceNode.connect(this.speexNode);
    this.speexNode.connect(this.destinationNode);

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
      this.speexNode?.disconnect();
    } catch {}

    // Call destroy on SpeexWorkletNode if available
    if (this.speexNode && "destroy" in this.speexNode) {
      try {
        (this.speexNode as any).destroy();
      } catch {}
    }

    if (this.speexContext && this.speexContext.state !== "closed") {
      try {
        await this.speexContext.close();
      } catch {}
    }

    this.sourceNode = null;
    this.speexNode = null;
    this.destinationNode = null;
    this.speexContext = null;
    this.processedTrack = undefined;
  }
}
