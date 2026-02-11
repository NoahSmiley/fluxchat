import { Track } from "livekit-client";
import type { AudioProcessorOptions, TrackProcessor } from "livekit-client";
import type KrispSDK from "./krispsdk.js";
import type { KrispFilterNode } from "./krispsdk.js";

/**
 * Custom LiveKit TrackProcessor that wraps the standalone Krisp JS SDK.
 *
 * Audio flow: original mic track → MediaStreamSource → KrispFilterNode → MediaStreamDestination
 * LiveKit publishes the processedTrack (output of the noise filter) instead of the raw mic.
 */
export class KrispTrackProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  name = "krisp-noise-filter";
  processedTrack?: MediaStreamTrack;

  private sdk: KrispSDK | null = null;
  private filterNode: KrispFilterNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;

  async init(opts: AudioProcessorOptions): Promise<void> {
    const { track, audioContext } = opts;

    // Dynamic import — the SDK module is placed manually from portal download
    const { default: KrispSDKModule } = await import("./krispsdk.mjs");

    this.sdk = new KrispSDKModule({
      params: {
        debugLogs: false,
        logProcessStats: false,
        models: {
          model8: "/krisp-models/model_8.kef",
          modelNC: "/krisp-models/model_nc_mq.kef",
        },
      },
    });

    await this.sdk.init();

    // Create the noise filter AudioWorklet node
    this.filterNode = await this.sdk.createNoiseFilter(
      audioContext,
      () => {
        // onReady — enable filtering once the worklet is initialized
        this.filterNode?.enable();
      },
      () => {
        // onDispose — cleanup callback
      },
    );

    // Wire up: source → krisp → destination
    const stream = new MediaStream([track]);
    this.sourceNode = audioContext.createMediaStreamSource(stream);
    this.destinationNode = audioContext.createMediaStreamDestination();

    this.sourceNode.connect(this.filterNode as unknown as AudioNode);
    (this.filterNode as unknown as AudioNode).connect(this.destinationNode);

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
      (this.filterNode as unknown as AudioNode)?.disconnect();
    } catch {}

    this.sourceNode = null;
    this.filterNode = null;
    this.destinationNode = null;
    this.processedTrack = undefined;
    this.sdk = null;
  }
}
