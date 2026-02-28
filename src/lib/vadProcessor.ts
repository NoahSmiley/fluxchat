import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// Silero VAD Processor
//
// Uses @ricky0123/vad-web (Silero VAD ONNX model) for ML-based voice
// activity detection. Controls transmission gating — only sends audio
// when the user is actually speaking.
// ═══════════════════════════════════════════════════════════════════

export class VadProcessor {
  private vad: any = null;
  private speaking = false;

  async init(
    stream: MediaStream,
    sensitivity: number,
    onChange: (speaking: boolean) => void,
  ): Promise<void> {
    await this.destroy();

    const { MicVAD } = await import("@ricky0123/vad-web");

    // Map sensitivity 0–1 to positiveSpeechThreshold:
    // sensitivity 0.0 (most sensitive) → threshold 0.3
    // sensitivity 0.5 (default) → threshold 0.5
    // sensitivity 1.0 (least sensitive) → threshold 0.9
    const threshold = 0.3 + sensitivity * 0.6;

    this.vad = await MicVAD.new({
      getStream: async () => stream,
      pauseStream: async () => {},    // We manage the stream — don't stop it
      resumeStream: async () => stream,
      positiveSpeechThreshold: threshold,
      negativeSpeechThreshold: Math.max(0.1, threshold - 0.15),
      redemptionMs: 240,   // ~240ms grace period before closing gate
      minSpeechMs: 90,     // ~90ms of speech to trigger
      startOnLoad: true,
      onSpeechStart: () => {
        this.speaking = true;
        onChange(true);
        dbg("voice", "VAD: speech start");
      },
      onSpeechEnd: () => {
        this.speaking = false;
        onChange(false);
        dbg("voice", "VAD: speech end");
      },
    });

    dbg("voice", `VadProcessor initialized (sensitivity=${sensitivity}, threshold=${threshold})`);
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  async destroy(): Promise<void> {
    if (this.vad) {
      try {
        await this.vad.pause();
        await this.vad.destroy();
      } catch (e) {
        dbg("voice", "VadProcessor destroy error", e);
      }
      this.vad = null;
      this.speaking = false;
      dbg("voice", "VadProcessor destroyed");
    }
  }
}
