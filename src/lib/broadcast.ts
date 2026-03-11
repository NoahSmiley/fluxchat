import type { Message } from "@/types/shared.js";

// ── State messages (main → popout) ──

export interface ChatStateMessage {
  type: "chat-state";
  messages: Message[];
  activeChannelId: string | null;
  channelName: string | null;
}

export interface VoiceStateMessage {
  type: "voice-state";
  connectedChannelId: string | null;
  watchingScreenShare: string | null;
  screenSharerParticipantId: string | null;
  screenSharerUsername: string | null;
}

export type StateMessage = ChatStateMessage | VoiceStateMessage;

// ── Command messages (popout → main) ──

interface SendMessageCommand {
  type: "send-message";
  content: string;
}

interface WatchScreenShareCommand {
  type: "watch-screenshare";
  participantId: string;
}

interface StopWatchingCommand {
  type: "stop-watching";
}

interface RequestStateCommand {
  type: "request-state";
}

type CommandMessage = SendMessageCommand | WatchScreenShareCommand | StopWatchingCommand | RequestStateCommand;

// ── Tauri event names ──
const TAURI_STATE_EVENT = "flux-state";
const TAURI_COMMAND_EVENT = "flux-command";

// ── BroadcastChannel names (fallback for dev mode / web) ──
const STATE_CHANNEL = "flux-state";
const COMMAND_CHANNEL = "flux-commands";

// Lazy-load Tauri APIs to avoid importing in non-Tauri contexts
let _tauriEmit: ((event: string, payload: unknown) => Promise<void>) | null = null;
let _tauriListen: ((event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>) | null = null;
let _tauriReady = false;
let _tauriFailed = false;

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

async function ensureTauri() {
  if (_tauriReady) return true;
  if (_tauriFailed) return false;
  if (!hasTauriRuntime()) {
    _tauriFailed = true;
    return false;
  }
  try {
    const { emit, listen } = await import("@tauri-apps/api/event");
    _tauriEmit = emit;
    _tauriListen = listen;
    _tauriReady = true;
    return true;
  } catch {
    _tauriFailed = true;
    return false;
  }
}

// Pre-load Tauri APIs (only when running inside Tauri)
if (hasTauriRuntime()) ensureTauri();

// Main window → popout: broadcast state
export function broadcastState(message: StateMessage) {
  // Tauri events (works across WebView2 instances)
  if (_tauriEmit) {
    _tauriEmit(TAURI_STATE_EVENT, message).catch(() => {});
  }
  // BroadcastChannel fallback (works in dev mode / same webview)
  try {
    const ch = new BroadcastChannel(STATE_CHANNEL);
    ch.postMessage(message);
    ch.close();
  } catch {
    // BroadcastChannel not supported or closed
  }
}

// Popout → listen for state
export function onStateUpdate(callback: (message: StateMessage) => void): () => void {
  let bcCleanup: (() => void) | null = null;
  let tauriCleanup: (() => void) | null = null;

  // BroadcastChannel listener (fallback)
  try {
    const ch = new BroadcastChannel(STATE_CHANNEL);
    ch.onmessage = (e) => callback(e.data);
    bcCleanup = () => ch.close();
  } catch { /* not supported */ }

  // Tauri event listener (primary — works across WebView2 instances)
  ensureTauri().then((ok) => {
    if (ok && _tauriListen) {
      _tauriListen(TAURI_STATE_EVENT, (event) => {
        callback(event.payload as StateMessage);
      }).then((unlisten) => {
        tauriCleanup = unlisten;
      });
    }
  });

  return () => {
    bcCleanup?.();
    tauriCleanup?.();
  };
}

// Popout → main: send command
export function sendCommand(command: CommandMessage) {
  // Tauri events (primary)
  if (_tauriEmit) {
    _tauriEmit(TAURI_COMMAND_EVENT, command).catch(() => {});
  }
  // BroadcastChannel fallback
  try {
    const ch = new BroadcastChannel(COMMAND_CHANNEL);
    ch.postMessage(command);
    ch.close();
  } catch {
    // BroadcastChannel not supported or closed
  }
}

// Main window → listen for commands
export function onCommand(callback: (command: CommandMessage) => void): () => void {
  let bcCleanup: (() => void) | null = null;
  let tauriCleanup: (() => void) | null = null;

  // BroadcastChannel listener (fallback)
  try {
    const ch = new BroadcastChannel(COMMAND_CHANNEL);
    ch.onmessage = (e) => callback(e.data);
    bcCleanup = () => ch.close();
  } catch { /* not supported */ }

  // Tauri event listener (primary)
  ensureTauri().then((ok) => {
    if (ok && _tauriListen) {
      _tauriListen(TAURI_COMMAND_EVENT, (event) => {
        callback(event.payload as CommandMessage);
      }).then((unlisten) => {
        tauriCleanup = unlisten;
      });
    }
  });

  return () => {
    bcCleanup?.();
    tauriCleanup?.();
  };
}

// ── Popout detection ──

export function getPopoutType(): "chat" | "screenshare" | null {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("popout");
  if (type === "chat" || type === "screenshare") return type;
  return null;
}

export function isPopout(): boolean {
  return getPopoutType() !== null;
}
