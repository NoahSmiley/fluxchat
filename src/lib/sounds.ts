/**
 * Synthesized voice notification sounds using Web Audio API.
 * No audio files needed — all sounds are generated programmatically.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
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

/** Two-tone ascending chime — default join sound (no custom set) */
export function playJoinSound() {
  playTone(440, 0.12, "sine", 0.12);
  setTimeout(() => playTone(587, 0.15, "sine", 0.12), 80);
}

/** Two-tone descending — default leave sound (no custom set) */
export function playLeaveSound() {
  playTone(587, 0.12, "sine", 0.10);
  setTimeout(() => playTone(392, 0.18, "sine", 0.10), 80);
}

/** Single rising beep — plays alongside custom sound on join */
export function playJoinBeep() {
  playTone(520, 0.12, "sine", 0.12);
}

/** Single falling beep — plays alongside custom sound on leave */
export function playLeaveBeep() {
  playTone(400, 0.14, "sine", 0.10);
}

/** Play a custom sound from a full URL (fire-and-forget). */
export function playCustomSound(url: string) {
  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audio.volume = 0.5;
      audio.onended = () => URL.revokeObjectURL(blobUrl);
      audio.onerror = () => URL.revokeObjectURL(blobUrl);
      return audio.play();
    })
    .catch(() => {});
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

/** Metallic click — room locked */
export function playLockSound() {
  playTone(800, 0.06, "square", 0.06);
  setTimeout(() => playTone(600, 0.10, "triangle", 0.08), 60);
}

/** Rising click — room unlocked */
export function playUnlockSound() {
  playTone(500, 0.06, "triangle", 0.06);
  setTimeout(() => playTone(700, 0.10, "sine", 0.08), 60);
}

/** Ascending three-tone chime — someone started streaming */
export function playStreamStartSound() {
  playTone(523, 0.10, "sine", 0.12);       // C5
  setTimeout(() => playTone(659, 0.10, "sine", 0.12), 100);  // E5
  setTimeout(() => playTone(784, 0.15, "sine", 0.14), 200);  // G5
}
