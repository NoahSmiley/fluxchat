// ── Sound Effects ──

function playTone(frequencies: number[], duration = 0.08) {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  gain.gain.value = 0.15;
  let t = ctx.currentTime;
  for (const freq of frequencies) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + duration);
    t += duration + 0.02;
  }
  gain.gain.setValueAtTime(0.15, t - 0.02);
  gain.gain.linearRampToValueAtTime(0, t + 0.05);
  setTimeout(() => ctx.close(), (t - ctx.currentTime + 0.1) * 1000);
}

export function playJoinSound() {
  playTone([480]);
}

export function playLeaveSound() {
  playTone([380]);
}

export function playScreenShareStartSound() {
  playTone([660, 880], 0.06);
}

export function playScreenShareStopSound() {
  playTone([880, 660], 0.06);
}

export function playMuteSound() {
  playTone([480, 320], 0.05);
}

export function playUnmuteSound() {
  playTone([320, 480], 0.05);
}

export function playDeafenSound() {
  playTone([400, 280, 200], 0.04);
}

export function playUndeafenSound() {
  playTone([200, 280, 400], 0.04);
}
