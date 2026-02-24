import { useEffect, useRef } from "react";

// ── WAV encoder ───────────────────────────────────────────────────────────

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(buffer.numberOfChannels, 2);
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2; // int16
  const dataSize = numFrames * numChannels * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  function writeUint32LE(offset: number, val: number) { view.setUint32(offset, val, true); }
  function writeUint16LE(offset: number, val: number) { view.setUint16(offset, val, true); }

  writeString(0, "RIFF");
  writeUint32LE(4, 36 + dataSize);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  writeUint32LE(16, 16); // subchunk1 size
  writeUint16LE(20, 1);  // PCM
  writeUint16LE(22, numChannels);
  writeUint32LE(24, sampleRate);
  writeUint32LE(28, sampleRate * numChannels * bytesPerSample); // byte rate
  writeUint16LE(32, numChannels * bytesPerSample); // block align
  writeUint16LE(34, 16); // bits per sample
  writeString(36, "data");
  writeUint32LE(40, dataSize);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = buffer.getChannelData(ch)[i];
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ── Waveform canvas ───────────────────────────────────────────────────────

export interface WaveformCanvasProps {
  audioBuffer: AudioBuffer;
  startSec: number;
  endSec: number;
  duration: number;
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
}

export function WaveformCanvas({
  audioBuffer,
  startSec,
  endSec,
  duration,
  onStartChange,
  onEndChange,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const data = audioBuffer.getChannelData(0);
    const samplesPerPx = Math.floor(data.length / W);

    ctx.clearRect(0, 0, W, H);

    // Draw waveform
    for (let x = 0; x < W; x++) {
      let max = 0;
      const startIdx = x * samplesPerPx;
      for (let s = 0; s < samplesPerPx; s++) {
        const v = Math.abs(data[startIdx + s] ?? 0);
        if (v > max) max = v;
      }
      const barH = Math.max(2, max * H);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x, (H - barH) / 2, 1, barH);
    }

    // Draw selection region
    const selX1 = Math.round((startSec / duration) * W);
    const selX2 = Math.round((endSec / duration) * W);
    ctx.fillStyle = "rgba(88, 166, 255, 0.25)";
    ctx.fillRect(selX1, 0, selX2 - selX1, H);

    // Draw handles
    ctx.fillStyle = "#58a6ff";
    ctx.fillRect(selX1, 0, 3, H);
    ctx.fillRect(selX2 - 3, 0, 3, H);
  }, [audioBuffer, startSec, endSec, duration]);

  function secFromPointer(e: React.PointerEvent): number {
    const rect = wrapperRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * duration;
  }

  function handlePointerDown(e: React.PointerEvent) {
    const sec = secFromPointer(e);
    const distToStart = Math.abs(sec - startSec);
    const distToEnd = Math.abs(sec - endSec);
    draggingRef.current = distToStart <= distToEnd ? "start" : "end";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const sec = secFromPointer(e);
    if (draggingRef.current === "start") {
      onStartChange(Math.max(0, Math.min(sec, endSec - 0.1)));
    } else {
      onEndChange(Math.min(duration, Math.max(sec, startSec + 0.1)));
    }
  }

  function handlePointerUp() {
    draggingRef.current = null;
  }

  return (
    <div
      ref={wrapperRef}
      className="trim-waveform-wrapper"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ cursor: "ew-resize" }}
    >
      <canvas ref={canvasRef} className="trim-waveform-canvas" width={600} height={64} />
    </div>
  );
}
