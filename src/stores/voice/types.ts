import type { ScalabilityMode } from "livekit-client";
import type { Room } from "livekit-client";
import type { VoiceParticipant } from "@/types/shared.js";

// ═══════════════════════════════════════════════════════════════════
// Types & Constants
// ═══════════════════════════════════════════════════════════════════

export interface AudioSettings {
  audioInputDeviceId: string;
  audioOutputDeviceId: string;
  dtx: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  voiceGating: boolean;
  sensitivity: number; // VAD threshold 0.0–1.0
  adaptiveBitrate: boolean;
  micVolume: number;     // 0.0–2.0 (default 1.0 = 100%)
  speakerVolume: number; // 0.0–2.0 (default 1.0 = 100%)
}

export interface VoiceUser {
  userId: string;
  username: string;
  isMuted: boolean;
  isDeafened: boolean;
}

export interface ScreenShareInfo {
  participantId: string;
  username: string;
}

export type ScreenShareQuality = "1080p144" | "1080p60" | "1080p30" | "720p60" | "720p30" | "480p30" | "Lossless";

export interface ScreenSharePreset {
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
  codec: "h264" | "vp9";
  scalabilityMode: ScalabilityMode;
  degradationPreference: "balanced" | "maintain-resolution" | "maintain-framerate";
  contentHint: "detail" | "motion" | "text";
}

export const SCREEN_SHARE_PRESETS: Record<ScreenShareQuality, ScreenSharePreset> = {
  // H.264 (hardware-accelerated), L1T1 (no SVC layering — browsers don't support H.264 temporal layers well)
  "1080p144":{ width: 1920, height: 1080, frameRate: 144, maxBitrate: 12_000_000, codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "motion" },
  "1080p60": { width: 1920, height: 1080, frameRate: 60,  maxBitrate: 6_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "motion" },
  "1080p30": { width: 1920, height: 1080, frameRate: 30,  maxBitrate: 4_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  "720p60":  { width: 1280, height: 720,  frameRate: 60,  maxBitrate: 4_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "motion" },
  "720p30":  { width: 1280, height: 720,  frameRate: 30,  maxBitrate: 2_500_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  "480p30":  { width: 854,  height: 480,  frameRate: 30,  maxBitrate: 1_500_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  // Lossless: high-bitrate h264 + maintain-resolution + uncapped framerate
  "Lossless":{ width: 1920, height: 1080, frameRate: 240, maxBitrate: 20_000_000, codec: "h264", scalabilityMode: "L1T1", degradationPreference: "maintain-resolution", contentHint: "detail" },
};

export const DEFAULT_SETTINGS: AudioSettings = {
  audioInputDeviceId: "",
  audioOutputDeviceId: "",
  dtx: false,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  voiceGating: true,
  sensitivity: 0.5,
  adaptiveBitrate: true,
  micVolume: 1.0,
  speakerVolume: 1.0,
};

export interface VoiceState {
  // ── Connection state ──
  room: Room | null;
  screenRoom: Room | null; // Self-hosted LiveKit room for screen share (hybrid mode)
  connectedChannelId: string | null;
  connecting: boolean;
  connectionError: string | null;

  // ── Local user controls ──
  isMuted: boolean;
  isDeafened: boolean;

  // ── Audio settings ──
  audioSettings: AudioSettings;

  // ── Per-user volume ──
  participantVolumes: Record<string, number>;

  // Debounced speaking state — instant on, 200ms hold off (no flicker)
  speakingUserIds: Set<string>;

  // ── Screen share ──
  isScreenSharing: boolean;
  screenSharers: ScreenShareInfo[];
  pinnedScreenShare: string | null;
  theatreMode: boolean;
  screenShareQuality: ScreenShareQuality;
  floatingCorner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  floatingDismissed: boolean; // true when user clicked X on the floating PiP
  floatingSize: { width: number; height: number }; // resizable PiP dimensions

  // ── Participants ──
  participants: VoiceUser[];
  channelParticipants: Record<string, VoiceParticipant[]>;

  // ── Idle detection ──
  lastSpokeAt: number;

  // ── Lobby music (easter egg) ──
  lobbyMusicPlaying: boolean;
  lobbyMusicVolume: number;

  // ── Actions: Core Connection ──
  joinVoiceChannel: (channelId: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setMuted: (muted: boolean, silent?: boolean) => void;
  setParticipantVolume: (participantId: string, volume: number) => void;
  // ── Actions: Audio Settings ──
  updateAudioSetting: (key: keyof AudioSettings, value: boolean | number | string) => void;
  applyBitrate: (bitrate: number) => void;

  // ── Actions: Screen Sharing ──
  toggleScreenShare: (displaySurface?: "monitor" | "window") => Promise<void>;
  pinScreenShare: (participantId: string) => void;
  unpinScreenShare: () => void;
  toggleTheatreMode: () => void;
  setScreenShareQuality: (quality: ScreenShareQuality) => void;
  setFloatingCorner: (corner: VoiceState["floatingCorner"]) => void;
  dismissFloating: () => void;
  setFloatingSize: (size: { width: number; height: number }) => void;

  // ── Actions: Lobby Music ──
  setLobbyMusicVolume: (volume: number) => void;
  stopLobbyMusicAction: () => void;

  // ── Internal ──
  _updateParticipants: () => void;
  _updateScreenSharers: () => void;
  _setChannelParticipants: (channelId: string, participants: VoiceParticipant[]) => void;
}
