import { dbg } from "@/lib/debug.js";
import {
  LOBBY_WAIT_MS,
  LOBBY_FADE_IN_S,
  LOBBY_FADE_OUT_S,
} from "@/lib/audio/voice-constants.js";
import type { StoreApi } from "zustand";
import type { VoiceState } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// Lobby Music (Easter Egg)
// ═══════════════════════════════════════════════════════════════════

const lobbyMusicState = {
  timer: null as ReturnType<typeof setTimeout> | null,
  audio: null as HTMLAudioElement | null,
  gain: null as GainNode | null,
  ctx: null as AudioContext | null,
};

// Lazy reference to the store — set via initLobbyMusic()
let storeRef: StoreApi<VoiceState> | null = null;

export function initLobbyMusic(store: StoreApi<VoiceState>) {
  storeRef = store;
}

function getStore() {
  return storeRef!;
}

export function checkLobbyMusic() {
  if (localStorage.getItem("flux-lobby-music-enabled") === "false") return;

  const { room } = getStore().getState();
  if (!room) return;

  const isAlone = room.remoteParticipants.size === 0;

  if (isAlone) {
    if (!lobbyMusicState.timer && !lobbyMusicState.audio) {
      lobbyMusicState.timer = setTimeout(() => {
        lobbyMusicState.timer = null;
        startLobbyMusic();
      }, LOBBY_WAIT_MS);
    }
  } else {
    if (lobbyMusicState.timer) {
      clearTimeout(lobbyMusicState.timer);
      lobbyMusicState.timer = null;
    }
    if (lobbyMusicState.audio) {
      fadeOutLobbyMusic();
    }
  }
}

function startLobbyMusic() {
  if (lobbyMusicState.audio) return;

  const vol = getStore().getState().lobbyMusicVolume;
  const audio = new Audio("/lobby-music.mp3");
  audio.loop = true;

  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(audio);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + LOBBY_FADE_IN_S);

  source.connect(gain);
  gain.connect(ctx.destination);

  audio.play().catch((e) => {
    dbg("voice", "Failed to play lobby music", e);
    ctx.close().catch((e2) => { dbg("voice", "Failed to close lobby music AudioContext after play error", e2); });
    getStore().setState({ lobbyMusicPlaying: false });
  });

  lobbyMusicState.audio = audio;
  lobbyMusicState.gain = gain;
  lobbyMusicState.ctx = ctx;
  getStore().setState({ lobbyMusicPlaying: true });
}

function fadeOutLobbyMusic() {
  if (!lobbyMusicState.gain || !lobbyMusicState.ctx || !lobbyMusicState.audio) return;

  const gain = lobbyMusicState.gain;
  const ctx = lobbyMusicState.ctx;
  const audio = lobbyMusicState.audio;

  gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + LOBBY_FADE_OUT_S);

  setTimeout(() => {
    audio.pause();
    audio.src = "";
    ctx.close().catch((e) => { dbg("voice", "Failed to close lobby music AudioContext after fade-out", e); });
  }, LOBBY_FADE_OUT_S * 1000);

  lobbyMusicState.audio = null;
  lobbyMusicState.gain = null;
  lobbyMusicState.ctx = null;
  getStore().setState({ lobbyMusicPlaying: false });
}

export function stopLobbyMusic() {
  if (lobbyMusicState.timer) {
    clearTimeout(lobbyMusicState.timer);
    lobbyMusicState.timer = null;
  }
  if (lobbyMusicState.audio) {
    lobbyMusicState.audio.pause();
    lobbyMusicState.audio.src = "";
  }
  if (lobbyMusicState.ctx) {
    lobbyMusicState.ctx.close().catch((e) => { dbg("voice", "Failed to close lobby music AudioContext on stop", e); });
  }
  lobbyMusicState.audio = null;
  lobbyMusicState.gain = null;
  lobbyMusicState.ctx = null;
  if (storeRef) getStore().setState({ lobbyMusicPlaying: false });
}

// Clean up lobby music on app close
window.addEventListener("beforeunload", stopLobbyMusic);

export function setLobbyMusicGain(volume: number) {
  if (lobbyMusicState.gain && lobbyMusicState.ctx) {
    lobbyMusicState.gain.gain.setValueAtTime(lobbyMusicState.gain.gain.value, lobbyMusicState.ctx.currentTime);
    lobbyMusicState.gain.gain.linearRampToValueAtTime(volume, lobbyMusicState.ctx.currentTime + 0.1);
  }
}
