// Channel-related types: channels, voice participants, channel CRUD

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  type: ChannelType;
  bitrate: number | null;
  parentId: string | null;
  position: number;
  isRoom: boolean;
  creatorId: string | null;
  isLocked: boolean;
  createdAt: string;
}

export type ChannelType = "text" | "voice" | "category";

export interface VoiceParticipant {
  userId: string;
  username: string;
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

export interface UpdateChannelRequest {
  name?: string;
  bitrate?: number | null;
  isLocked?: boolean;
}
