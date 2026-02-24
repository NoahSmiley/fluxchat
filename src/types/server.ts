// Server-related types: servers, members, soundboard, emoji

export interface Server {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
}

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

export interface UpdateServerRequest {
  name?: string;
}

export interface WhitelistEntry {
  id: string;
  email: string;
  addedBy: string;
  addedAt: string;
}

export interface SoundboardSound {
  id: string;
  serverId: string;
  name: string;
  emoji: string | null;
  audioAttachmentId: string;
  audioFilename: string;
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
