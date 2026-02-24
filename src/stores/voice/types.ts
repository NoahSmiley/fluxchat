import type { ScalabilityMode } from "livekit-client";
import type { Room } from "livekit-client";
import type { VoiceParticipant } from "@/types/shared.js";
import type { AudioSettings } from "@/lib/audio/voice-pipeline.js";
import type { WebRTCQualityStats } from "@/lib/webrtcStats.js";

// ═══════════════════════════════════════════════════════════════════
// Types & Constants
// ═══════════════════════════════════════════════════════════════════

export type NoiseSuppressionModel = "off" | "speex" | "rnnoise" | "dtln" | "deepfilter" | "nsnet2";

export interface VoiceUser {
  userId: string;
  username: string;
  speaking: boolean;
  isMuted: boolean;
  isDeafened: boolean;
}

export interface ScreenShareInfo {
  participantId: string;
  username: string;
}

export type ScreenShareQuality = "1080p60" | "1080p30" | "720p60" | "720p30" | "480p30" | "Lossless";

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
  // Discord-like defaults: H.264 (hardware-accelerated), balanced degradation
  // H.264 uses L1T1 (no SVC layering) — browsers don't support H.264 temporal layers well
  "1080p60": { width: 1920, height: 1080, frameRate: 60, maxBitrate: 6_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "motion" },
  "1080p30": { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  "720p60":  { width: 1280, height: 720,  frameRate: 60, maxBitrate: 4_000_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "motion" },
  "720p30":  { width: 1280, height: 720,  frameRate: 30, maxBitrate: 2_500_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  "480p30":  { width: 854,  height: 480,  frameRate: 30, maxBitrate: 1_500_000,  codec: "h264", scalabilityMode: "L1T1", degradationPreference: "balanced", contentHint: "detail" },
  // Lossless: VP9 + maintain-resolution for maximum quality (CPU-heavy)
  "Lossless":{ width: 1920, height: 1080, frameRate: 60, maxBitrate: 20_000_000, codec: "vp9",  scalabilityMode: "L1T3", degradationPreference: "maintain-resolution", contentHint: "detail" },
};

export const DEFAULT_SETTINGS: AudioSettings = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  dtx: false,
  highPassFrequency: 0,
  lowPassFrequency: 0,
  inputSensitivity: 40,
  inputSensitivityEnabled: true,
  noiseSuppressionModel: "dtln",
  suppressionStrength: 100,
  vadThreshold: 85,
  micInputGain: 100,
  noiseGateHoldTime: 200,
  compressorEnabled: false,
  compressorThreshold: -24,
  compressorRatio: 12,
  compressorAttack: 0.003,
  compressorRelease: 0.25,
  deEsserEnabled: false,
  deEsserStrength: 50,
};

export interface VoiceState {
  // ── Connection state ──
  room: Room | null;
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
  participantTrackMap: Record<string, string>;

  // ── Audio levels (0-1 per participant, updated at 20fps) ──
  audioLevels: Record<string, number>;
  // Debounced speaking state — instant on, 200ms hold off (no flicker)
  speakingUserIds: Set<string>;

  // ── Screen share ──
  isScreenSharing: boolean;
  screenSharers: ScreenShareInfo[];
  pinnedScreenShare: string | null;
  theatreMode: boolean;
  screenShareQuality: ScreenShareQuality;

  // ── Participants ──
  participants: VoiceUser[];
  channelParticipants: Record<string, VoiceParticipant[]>;

  // ── Idle detection ──
  lastSpokeAt: number;

  // ── WebRTC stats overlay ──
  webrtcStats: WebRTCQualityStats | null;
  showStatsOverlay: boolean;

  // ── Lobby music (easter egg) ──
  lobbyMusicPlaying: boolean;
  lobbyMusicVolume: number;

  // ── Actions: Core Connection ──
  joinVoiceChannel: (channelId: string) => Promise<void>;
  leaveVoiceChannel: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  setMuted: (muted: boolean) => void;
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

  // ── Actions: Lobby Music ──
  setLobbyMusicVolume: (volume: number) => void;
  stopLobbyMusicAction: () => void;

  // ── Actions: Stats ──
  toggleStatsOverlay: () => void;

  // ── Internal ──
  _updateParticipants: () => void;
  _updateScreenSharers: () => void;
  _setChannelParticipants: (channelId: string, participants: VoiceParticipant[]) => void;
}
