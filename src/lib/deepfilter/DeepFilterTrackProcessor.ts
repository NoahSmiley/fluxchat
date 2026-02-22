import { Track } from "livekit-client";
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client";

const DEEPFILTER_SAMPLE_RATE = 48000;

/**
 * Custom LiveKit TrackProcessor that wraps DeepFilterNet3 (WASM noise suppression).
 *
 * Uses a Worker+Worklet architecture: the AudioWorklet captures audio frames and
 * sends them to a Web Worker via MessagePort. The Worker runs WASM inference and
 * sends back processed frames. This keeps the audio thread lightweight while the
 * heavier model runs in a dedicated thread.
 *
 * Audio flow: mic track → AudioWorklet → Worker (WASM inference) → AudioWorklet → destination
 *
 * Requires WASM binary + model weights in public/deepfilter/:
 *   - deepfilter.wasm (compiled from DeepFilterNet repo via wasm-pack)
 *   - deepfilter-worker.js
 *   - deepfilter-worklet.js
 */
export class DeepFilterTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "deepfilter-noise-filter";
  processedTrack?: MediaStreamTrack;

  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private worker: Worker | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    // Create a 48kHz AudioContext
    this.audioContext = new AudioContext({ sampleRate: DEEPFILTER_SAMPLE_RATE });

    // Start the Web Worker for WASM inference
    this.worker = new Worker("/deepfilter/deepfilter-worker.js");

    // Wait for worker to load WASM + model
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("DeepFilterNet3 worker initialization timed out")),
        30000, // 30s timeout for larger model
      );
      this.worker!.onmessage = (event) => {
        if (event.data === "ready") {
          clearTimeout(timeout);
          resolve();
        } else if (event.data?.error) {
          clearTimeout(timeout);
          reject(new Error(event.data.error));
        }
      };
    });

    // Load the AudioWorklet
    await this.audioContext.audioWorklet.addModule("/deepfilter/deepfilter-worklet.js");

    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "deepfilter-processor",
    );

    // Create a MessageChannel for direct Worker ↔ Worklet communication
    const channel = new MessageChannel();

    // Send one port to the worker
    this.worker.postMessage({ type: "init-port", port: channel.port1 }, [channel.port1]);

    // Send the other port to the worklet
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("DeepFilterNet3 worklet port setup timed out")),
        5000,
      );
      this.workletNode!.port.onmessage = (event) => {
        if (event.data === "ready") {
          clearTimeout(timeout);
          resolve();
        }
      };
      this.workletNode!.port.postMessage(
        { type: "worker-port", port: channel.port2 },
        [channel.port2],
      );
    });

    // Wire up: source → worklet → destination
    const stream = new MediaStream([track]);
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.destinationNode = this.audioContext.createMediaStreamDestination();

    this.sourceNode.connect(this.workletNode);
    this.workletNode.connect(this.destinationNode);

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
      this.workletNode?.disconnect();
    } catch {}

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        await this.audioContext.close();
      } catch {}
    }

    this.sourceNode = null;
    this.workletNode = null;
    this.destinationNode = null;
    this.audioContext = null;
    this.processedTrack = undefined;
  }
}
