export interface Server {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  bitrate: number | null;
  parentId: string | null;
  position: number;
  isRoom: boolean;
  isPersistent: boolean;
  creatorId: string | null;
  isLocked: boolean;
  createdAt: string;
}

export type ChannelType = "text" | "voice" | "game" | "category";

export type RingStyle = "default" | "chroma" | "pulse" | "wave" | "ember" | "frost" | "neon" | "galaxy" | "none"
  | "doppler" | "gamma_doppler";

export interface MemberWithUser {
  userId: string;
  serverId: string;
  role: MemberRole;
  joinedAt: string;
  username: string;
  image: string | null;
  ringStyle: RingStyle;
  ringSpin: boolean;
  steamId: string | null;
  ringPatternSeed: number | null;
  bannerCss: string | null;
  bannerPatternSeed: number | null;
}

export type MemberRole = "owner" | "admin" | "member";

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  domain?: string;
}

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  createdAt: string;
  editedAt?: string;
  attachments?: Attachment[];
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface DMMessage {
  id: string;
  dmChannelId: string;
  senderId: string;
  ciphertext: string;
  mlsEpoch: number;
  createdAt: string;
}

export interface VoiceParticipant {
  userId: string;
  username: string;
  drinkCount: number;
}

export interface ActivityInfo {
  name: string;
  activityType: "playing" | "listening";
  artist?: string;
  albumArt?: string;
  durationMs?: number;
  progressMs?: number;
}

// Spotify types
export interface SpotifyAccount {
  linked: boolean;
  displayName?: string;
}

export interface ListeningSession {
  id: string;
  voiceChannelId: string;
  hostUserId: string;
  currentTrackUri?: string;
  currentTrackPositionMs: number;
  isPlaying: number;
  createdAt: string;
  updatedAt: string;
}

export interface QueueItem {
  id: string;
  sessionId: string;
  trackUri: string;
  trackName: string;
  trackArtist: string;
  trackAlbum?: string;
  trackImageUrl?: string;
  trackDurationMs: number;
  addedByUserId: string;
  position: number;
  createdAt: string;
  source: string;
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number; height: number }[] };
  duration_ms: number;
}

export interface YouTubeTrack {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationMs: number;
}

export interface SoundboardSound {
  id: string;
  serverId: string;
  name: string;
  emoji: string | null;
  audioAttachmentId: string;
  audioFilename: string;
  imageAttachmentId: string | null;
  imageFilename: string | null;
  volume: number;
  createdBy: string;
  creatorUsername: string;
  createdAt: string;
  favorited: boolean;
}

export interface CustomEmoji {
  id: string;
  serverId: string;
  name: string;
  attachmentId: string;
  filename: string;
  uploaderId: string;
  uploaderUsername: string;
  uploaderImage: string | null;
  createdAt: string;
}

export interface EmojiFavorites {
  standard: string[];   // Unicode chars
  customIds: string[];  // custom_emoji ids
}

export type WSClientEvent =
  | { type: "send_message"; channelId: string; content: string; attachmentIds?: string[] }
  | { type: "typing_start"; channelId: string }
  | { type: "typing_stop"; channelId: string }
  | { type: "join_channel"; channelId: string }
  | { type: "leave_channel"; channelId: string }
  | { type: "voice_state_update"; channelId: string; action: "join" | "leave" }
  | { type: "add_reaction"; messageId: string; emoji: string }
  | { type: "remove_reaction"; messageId: string; emoji: string }
  | { type: "edit_message"; messageId: string; content: string }
  | { type: "delete_message"; messageId: string }
  | { type: "send_dm"; dmChannelId: string; ciphertext: string; mlsEpoch: number }
  | { type: "join_dm"; dmChannelId: string }
  | { type: "leave_dm"; dmChannelId: string }
  | { type: "update_activity"; activity: ActivityInfo | null }
  | { type: "share_server_key"; serverId: string; userId: string; encryptedKey: string }
  | { type: "request_server_key"; serverId: string }
  | { type: "spotify_playback_control"; sessionId: string; action: string; trackUri?: string; positionMs?: number; source?: string }
  | { type: "voice_drink_update"; channelId: string; drinkCount: number }
  | { type: "update_status"; status: string }
  | { type: "play_sound"; channelId: string; soundId: string }
  | { type: "room_knock"; channelId: string };

export type WSServerEvent =
  | { type: "message"; message: Message; attachments?: Attachment[] }
  | { type: "typing"; channelId: string; userId: string; active: boolean }
  | { type: "presence"; userId: string; status: PresenceStatus }
  | { type: "member_joined"; serverId: string; userId: string; username: string; image: string | null; role: string; ringStyle: RingStyle; ringSpin: boolean; steamId?: string | null; ringPatternSeed?: number | null; bannerCss?: string | null; bannerPatternSeed?: number | null }
  | { type: "member_left"; serverId: string; userId: string }
  | { type: "server_updated"; serverId: string; name: string }
  | { type: "server_deleted"; serverId: string }
  | { type: "member_role_updated"; serverId: string; userId: string; role: string }
  | { type: "channel_update"; channelId: string; bitrate: number | null }
  | { type: "profile_update"; userId: string; username?: string; image?: string | null; ringStyle?: RingStyle; ringSpin?: boolean; ringPatternSeed?: number | null; bannerCss?: string | null; bannerPatternSeed?: number | null }
  | { type: "voice_state"; channelId: string; participants: VoiceParticipant[] }
  | { type: "reaction_add"; messageId: string; userId: string; emoji: string }
  | { type: "reaction_remove"; messageId: string; userId: string; emoji: string }
  | { type: "message_edit"; messageId: string; content: string; editedAt: string }
  | { type: "message_delete"; messageId: string; channelId: string }
  | { type: "dm_message"; message: DMMessage }
  | { type: "activity_update"; userId: string; activity: ActivityInfo | null }
  | { type: "server_key_shared"; serverId: string; encryptedKey: string; senderId: string }
  | { type: "server_key_requested"; serverId: string; userId: string }
  | { type: "spotify_queue_update"; sessionId: string; voiceChannelId: string; queueItem: QueueItem }
  | { type: "spotify_queue_remove"; sessionId: string; voiceChannelId: string; itemId: string }
  | { type: "spotify_playback_sync"; sessionId: string; voiceChannelId: string; action: string; trackUri?: string; positionMs?: number; source?: string }
  | { type: "spotify_session_ended"; sessionId: string; voiceChannelId: string }
  | { type: "soundboard_play"; channelId: string; soundId: string; audioAttachmentId: string; audioFilename: string; imageAttachmentId?: string; imageFilename?: string; volume: number; username: string }
  | { type: "room_created"; channel: Channel }
  | { type: "room_deleted"; channelId: string; serverId: string }
  | { type: "room_lock_toggled"; channelId: string; serverId: string; isLocked: boolean }
  | { type: "room_knock"; channelId: string; userId: string; username: string }
  | { type: "room_knock_accepted"; channelId: string }
  | { type: "room_invite"; channelId: string; channelName: string; inviterUsername: string; serverId: string }
  | { type: "room_force_move"; targetChannelId: string; targetChannelName: string }
  | { type: "error"; message: string };

export type PresenceStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

export interface WhitelistEntry {
  id: string;
  email: string;
  addedBy: string;
  addedAt: string;
}

export interface CreateChannelRequest {
  name: string;
  type: ChannelType;
  bitrate?: number;
  parentId?: string;
  isRoom?: boolean;
}

export interface ReorderItem {
  id: string;
  parentId: string | null;
  position: number;
}

export interface UpdateServerRequest {
  name?: string;
}

export interface UpdateChannelRequest {
  name?: string;
  bitrate?: number | null;
  isLocked?: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}

const MAX_USERNAME_LENGTH = 32;
const MIN_USERNAME_LENGTH = 2;
const MIN_PASSWORD_LENGTH = 8;

export const WS_HEARTBEAT_INTERVAL = 30_000;
export const WS_RECONNECT_BASE_DELAY = 1_000;
export const WS_RECONNECT_MAX_DELAY = 30_000;

export function validateUsername(username: string): string | null {
  if (username.length < MIN_USERNAME_LENGTH) {
    return `Username must be at least ${MIN_USERNAME_LENGTH} characters`;
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters`;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return "Username can only contain letters, numbers, underscores, and hyphens";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
