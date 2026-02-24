import { dbg } from "../lib/debug.js";
import { collectWebRTCStats, resetStatsDelta } from "../lib/webrtcStats.js";
import type { StoreApi } from "zustand";
import type { VoiceState } from "./voice-types.js";

// ═══════════════════════════════════════════════════════════════════
// WebRTC Stats Polling
// ═══════════════════════════════════════════════════════════════════

let statsInterval: ReturnType<typeof setInterval> | null = null;
let storeRef: StoreApi<VoiceState> | null = null;

export function initStatsPolling(store: StoreApi<VoiceState>) {
  storeRef = store;
}

export function startStatsPolling() {
  stopStatsPolling();
  resetStatsDelta();
  statsInterval = setInterval(async () => {
    const { room, showStatsOverlay } = storeRef!.getState();
    if (!room || !showStatsOverlay) return;
    try {
      const stats = await collectWebRTCStats(room);
      storeRef!.setState({ webrtcStats: stats });
    } catch (e) {
      dbg("voice", "stats polling error", e);
    }
  }, 2000);
}

export function stopStatsPolling() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  resetStatsDelta();
}
