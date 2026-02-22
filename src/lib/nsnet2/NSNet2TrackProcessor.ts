import { Track } from "livekit-client";
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client";

const NSNET2_SAMPLE_RATE = 16000;

/**
 * Custom LiveKit TrackProcessor that wraps Microsoft NSNet2 noise suppression.
 *
 * Architecture: AudioWorklet (audio thread) <-> Worker (ONNX inference thread)
 *
 * The AudioWorklet buffers 128-sample WebAudio chunks into 160-sample hops,
 * sends them via MessagePort to a Web Worker that runs ONNX Runtime Web
 * with the NSNet2 model, and plays back the denoised audio.
 *
 * Uses 16kHz processing (matching the NSNet2 baseline model).
 * The browser auto-resamples the mic input from 48kHz to 16kHz.
 *
 * Audio flow:
 *   mic track -> MediaStreamSource -> NSNet2 AudioWorklet <-> NSNet2 Worker (ONNX)
 *                                          -> MediaStreamDestination -> processedTrack
 */
export class NSNet2TrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "nsnet2-noise-filter";
  processedTrack?: MediaStreamTrack;

  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private worker: Worker | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track } = opts;

    // Create a 16kHz AudioContext (NSNet2 baseline model rate)
    this.audioContext = new AudioContext({ sampleRate: NSNET2_SAMPLE_RATE });

    // Start the Worker (runs ONNX Runtime Web)
    this.worker = new Worker("/nsnet2/nsnet2-worker.js");

    // Wait for Worker to load ONNX model
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("NSNet2 ONNX model initialization timed out")),
        30000,
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
    await this.audioContext.audioWorklet.addModule("/nsnet2/nsnet2-worklet.js");

    // Create the AudioWorklet node
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "nsnet2-processor",
    );

    // Create a MessageChannel for Worker <-> Worklet communication
    const channel = new MessageChannel();

    // Send one port to the Worker
    this.worker.postMessage({ type: "init-port" }, [channel.port1]);

    // Send the other port to the Worklet
    this.workletNode.port.postMessage(
      { type: "init-port" },
      [channel.port2],
    );

    // Wait for the Worklet to confirm port setup
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("NSNet2 worklet port setup timed out")),
        5000,
      );
      this.workletNode!.port.onmessage = (event) => {
        if (event.data === "ready") {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    // Wire up: source -> nsnet2 worklet -> destination
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
