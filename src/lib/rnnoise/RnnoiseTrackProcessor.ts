import type { Track, AudioProcessorOptions, TrackProcessor } from "livekit-client";

const RNNOISE_SAMPLE_RATE = 48000;

/**
 * Custom LiveKit TrackProcessor that wraps RNNoise (WASM noise suppression).
 *
 * RNNoise operates natively at 48kHz (matching the browser's default capture rate),
 * so no resampling is needed. Processes 480-sample frames (10ms).
 *
 * Audio flow: original mic track → MediaStreamSource → RNNoise AudioWorklet → MediaStreamDestination
 */
export class RnnoiseTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "rnnoise-noise-filter";
  processedTrack?: MediaStreamTrack;

  private rnnoiseContext: AudioContext | null = null;
  private rnnoiseNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    // Pre-fetch the WASM binary in the main thread (AudioWorklet scope
    // in Tauri's WebView doesn't have fetch available)
    const wasmResponse = await fetch("/rnnoise/rnnoise.wasm");
    const wasmBytes = await wasmResponse.arrayBuffer();

    // Create a 48kHz AudioContext (RNNoise native rate)
    this.rnnoiseContext = new AudioContext({ sampleRate: RNNOISE_SAMPLE_RATE });

    // Load the RNNoise AudioWorklet (WASM bundle served from public/)
    await this.rnnoiseContext.audioWorklet.addModule("/rnnoise/rnnoise-worklet.js");

    // Create the worklet node
    this.rnnoiseNode = new AudioWorkletNode(
      this.rnnoiseContext,
      "rnnoise-processor",
    );

    // Send the pre-fetched WASM binary to the worklet
    this.rnnoiseNode.port.postMessage({ type: "wasm-binary", wasmBytes }, [wasmBytes]);

    // Wait for the WASM module to initialize
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("RNNoise module initialization timed out")),
        15000,
      );
      this.rnnoiseNode!.port.onmessage = (event) => {
        if (event.data === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (event.data?.error) {
          clearTimeout(timeout);
          reject(new Error(event.data.error));
        }
      };
    });

    // Wire up: source → rnnoise → destination
    const stream = new MediaStream([track]);
    this.sourceNode = this.rnnoiseContext.createMediaStreamSource(stream);
    this.destinationNode = this.rnnoiseContext.createMediaStreamDestination();

    this.sourceNode.connect(this.rnnoiseNode);
    this.rnnoiseNode.connect(this.destinationNode);

    this.processedTrack = this.destinationNode.stream.getAudioTracks()[0];
  }

  /** Set VAD threshold (0-1). Below this probability, output silence. */
  setVadThreshold(threshold: number): void {
    if (this.rnnoiseNode) {
      this.rnnoiseNode.port.postMessage({ type: "set-vad-threshold", threshold });
    }
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
      this.rnnoiseNode?.disconnect();
    } catch {}

    if (this.rnnoiseContext && this.rnnoiseContext.state !== "closed") {
      try {
        await this.rnnoiseContext.close();
      } catch {}
    }

    this.sourceNode = null;
    this.rnnoiseNode = null;
    this.destinationNode = null;
    this.rnnoiseContext = null;
    this.processedTrack = undefined;
  }
}
