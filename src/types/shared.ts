export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

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
}

export interface SpotifyTrack {
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string; images: { url: string; width: number; height: number }[] };
  duration_ms: number;
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
  | { type: "spotify_playback_control"; sessionId: string; action: string; trackUri?: string; positionMs?: number }
  | { type: "voice_drink_update"; channelId: string; drinkCount: number }
  | { type: "update_status"; status: string }
  | { type: "play_sound"; channelId: string; soundId: string };

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
  | { type: "spotify_playback_sync"; sessionId: string; voiceChannelId: string; action: string; trackUri?: string; positionMs?: number }
  | { type: "spotify_session_ended"; sessionId: string; voiceChannelId: string }
  | { type: "case_opened"; userId: string; username: string; itemName: string; itemRarity: ItemRarity; caseName: string }
  | { type: "trade_offer_received"; tradeId: string; senderId: string; senderUsername: string }
  | { type: "trade_resolved"; tradeId: string; status: string }
  | { type: "coins_earned"; userId: string; amount: number; reason: string; newBalance: number }
  | { type: "soundboard_play"; channelId: string; soundId: string; audioAttachmentId: string; audioFilename: string; imageAttachmentId?: string; imageFilename?: string; volume: number; username: string }
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
}

export interface PaginatedResponse<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}

// ── Economy types ──

export type ItemRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "ultra_rare";
export type ItemType = "ring_style" | "name_color" | "chat_badge" | "profile_banner" | "message_effect" | "trading_card";

export interface CatalogItem {
  id: string;
  name: string;
  rarity: ItemRarity;
  type: ItemType;
  imageUrl: string | null;
}

export interface CaseInfo {
  id: string;
  name: string;
  imageUrl: string | null;
  price: number;
  createdAt: string;
}

export interface CaseDetail extends CaseInfo {
  active: boolean;
  items: CaseItem[];
}

export interface CaseItem {
  id: string;
  catalogItemId: string;
  name: string;
  rarity: ItemRarity;
  type: ItemType;
  imageUrl: string | null;
  weight: number;
  previewCss: string | null;
  cardSeries: string | null;
  cardNumber: string | null;
  isHolographic: boolean;
}

export interface InventoryItem {
  id: string;
  userId: string;
  catalogItemId: string;
  name: string;
  rarity: ItemRarity;
  type: ItemType;
  imageUrl: string | null;
  acquiredVia: string;
  equipped: boolean;
  createdAt: string;
  previewCss: string | null;
  cardSeries: string | null;
  cardNumber: string | null;
  isHolographic: boolean;
  patternSeed: number | null;
}

export interface CaseOpenResult extends InventoryItem {
  newBalance: number;
}

export interface Wallet {
  id: string;
  userId: string;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface CoinHistoryEntry {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface TradeItem {
  inventoryId: string;
  name: string;
  rarity: ItemRarity;
  type: ItemType;
  imageUrl: string | null;
  previewCss: string | null;
  cardSeries: string | null;
  cardNumber: string | null;
  isHolographic: boolean;
  patternSeed: number | null;
}

export interface Trade {
  id: string;
  senderId: string;
  receiverId: string;
  senderCoins: number;
  receiverCoins: number;
  senderItems: TradeItem[];
  receiverItems: TradeItem[];
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceListing {
  id: string;
  sellerId: string;
  sellerUsername: string;
  inventoryId: string;
  price: number;
  status: string;
  name: string;
  rarity: ItemRarity;
  type: ItemType;
  imageUrl: string | null;
  createdAt: string;
  previewCss: string | null;
  cardSeries: string | null;
  cardNumber: string | null;
  isHolographic: boolean;
  patternSeed: number | null;
}

export interface CraftResult extends InventoryItem {
  consumedItems: string[];
}

export const RARITY_ORDER: ItemRarity[] = ["common", "uncommon", "rare", "epic", "legendary", "ultra_rare"];

export const RARITY_COLORS: Record<ItemRarity, string> = {
  common: "#b0c3d9",
  uncommon: "#5e98d9",
  rare: "#4b69ff",
  epic: "#8847ff",
  legendary: "#d32ce6",
  ultra_rare: "#eb4b4b",
};

export const MAX_USERNAME_LENGTH = 32;
export const MIN_USERNAME_LENGTH = 2;
export const MIN_PASSWORD_LENGTH = 8;
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
