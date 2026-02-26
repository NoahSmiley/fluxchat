/**
 * Synthesized voice notification sounds using Web Audio API.
 * No audio files needed — all sounds are generated programmatically.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.15,
  ramp?: { to: number },
) {
  const ctx = getCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ctx.currentTime);
  if (ramp) {
    osc.frequency.linearRampToValueAtTime(ramp.to, ctx.currentTime + duration);
  }
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

/** Two-tone ascending chime — someone joined */
export function playJoinSound() {
  playTone(440, 0.12, "sine", 0.12);
  setTimeout(() => playTone(587, 0.15, "sine", 0.12), 80);
}

/** Two-tone descending — someone left */
export function playLeaveSound() {
  playTone(587, 0.12, "sine", 0.10);
  setTimeout(() => playTone(392, 0.18, "sine", 0.10), 80);
}

/** Short low click — someone muted */
export function playMuteSound() {
  playTone(300, 0.08, "triangle", 0.08);
}

/** Short higher click — someone unmuted */
export function playUnmuteSound() {
  playTone(500, 0.08, "triangle", 0.08);
}

/** Low double-pulse — someone deafened */
export function playDeafenSound() {
  playTone(250, 0.06, "triangle", 0.06);
  setTimeout(() => playTone(250, 0.06, "triangle", 0.06), 70);
}

/** Higher double-pulse — someone undeafened */
export function playUndeafenSound() {
  playTone(400, 0.06, "triangle", 0.06);
  setTimeout(() => playTone(400, 0.06, "triangle", 0.06), 70);
}
