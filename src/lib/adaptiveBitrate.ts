import { dbg } from "@/lib/debug.js";

// ═══════════════════════════════════════════════════════════════════
// Adaptive Bitrate (AIMD Algorithm)
//
// Driven by packet loss stats from the 2s polling loop in stats.ts.
// Additive increase, multiplicative decrease — same approach as TCP
// congestion control.
// ═══════════════════════════════════════════════════════════════════

const MIN_BITRATE = 32_000;      // 32kbps floor
const INCREASE_FACTOR = 1.10;    // +10%
const LOW_LOSS_THRESHOLD = 1;    // % — increase if below this
const MED_LOSS_THRESHOLD = 2;    // % — decrease 10% if above this
const HIGH_LOSS_THRESHOLD = 5;   // % — decrease 20% if above this
const CONSECUTIVE_GOOD_NEEDED = 3; // polls with <1% loss before increasing

let consecutiveGoodPolls = 0;
let currentBitrate = 0;
let ceilingBitrate = 0;
let applyFn: ((bitrate: number) => void) | null = null;

export function initAdaptiveBitrate(
  initialBitrate: number,
  apply: (bitrate: number) => void,
): void {
  currentBitrate = initialBitrate;
  ceilingBitrate = initialBitrate;
  consecutiveGoodPolls = 0;
  applyFn = apply;
  dbg("voice", `adaptiveBitrate init ceiling=${ceilingBitrate}`);
}

export function resetAdaptiveBitrate(): void {
  consecutiveGoodPolls = 0;
  currentBitrate = 0;
  ceilingBitrate = 0;
  applyFn = null;
}

export function tickAdaptiveBitrate(packetLossPercent: number): void {
  if (!applyFn || ceilingBitrate === 0) return;

  const prevBitrate = currentBitrate;

  if (packetLossPercent > HIGH_LOSS_THRESHOLD) {
    // Heavy loss — cut by 20%
    currentBitrate = Math.round(currentBitrate * 0.80);
    consecutiveGoodPolls = 0;
  } else if (packetLossPercent > MED_LOSS_THRESHOLD) {
    // Moderate loss — cut by 10%
    currentBitrate = Math.round(currentBitrate * 0.90);
    consecutiveGoodPolls = 0;
  } else if (packetLossPercent < LOW_LOSS_THRESHOLD) {
    consecutiveGoodPolls++;
    if (consecutiveGoodPolls >= CONSECUTIVE_GOOD_NEEDED) {
      // Good conditions — increase by 10%
      currentBitrate = Math.round(currentBitrate * INCREASE_FACTOR);
      consecutiveGoodPolls = 0;
    }
  } else {
    // Between 1–2% loss — hold steady
    consecutiveGoodPolls = 0;
  }

  // Clamp
  currentBitrate = Math.max(MIN_BITRATE, Math.min(ceilingBitrate, currentBitrate));

  if (currentBitrate !== prevBitrate) {
    dbg("voice", `adaptiveBitrate ${prevBitrate} → ${currentBitrate} (loss=${packetLossPercent}%)`);
    applyFn(currentBitrate);
  }
}
