import type { Message } from "../types/shared.js";

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

// ── Channels ──

const STATE_CHANNEL = "flux-state";
const COMMAND_CHANNEL = "flux-commands";

// Main window → popout: broadcast state
export function broadcastState(message: StateMessage) {
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
  const ch = new BroadcastChannel(STATE_CHANNEL);
  ch.onmessage = (e) => callback(e.data);
  return () => ch.close();
}

// Popout → main: send command
export function sendCommand(command: CommandMessage) {
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
  const ch = new BroadcastChannel(COMMAND_CHANNEL);
  ch.onmessage = (e) => callback(e.data);
  return () => ch.close();
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
