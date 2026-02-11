/**
 * Type declarations for the Krisp JS SDK.
 * The actual SDK module (krispsdk.mjs) must be downloaded from https://sdk.krisp.ai/
 */

interface KrispSDKParams {
  debugLogs?: boolean;
  logProcessStats?: boolean;
  useSharedArrayBuffer?: boolean;
  models: {
    modelBVC?: string;
    model8: string;
    modelNC: string;
  };
}

interface KrispSDKOptions {
  params: KrispSDKParams;
}

interface KrispFilterNode extends AudioNode {
  enable(): void;
  disable(): void;
  addEventListener(event: string, handler: (e: { data: { errorCode: string; errorMessage: string } }) => void): void;
}

declare class KrispSDK {
  constructor(options: KrispSDKOptions);
  static isSupported(): boolean;
  init(): Promise<void>;
  createNoiseFilter(
    audioContext: AudioContext,
    onReady: () => void,
    onDispose: () => void,
  ): Promise<KrispFilterNode>;
}

export default KrispSDK;
export { KrispSDK, KrispFilterNode, KrispSDKOptions, KrispSDKParams };
