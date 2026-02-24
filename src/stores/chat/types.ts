import type { Server, Channel, Message, MemberWithUser, DMMessage, Attachment, ActivityInfo, PresenceStatus, CustomEmoji } from "@/types/shared.js";

// UTF-8-safe base64 decoding (btoa/atob only handle Latin-1)
export function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.codePointAt(0)!);
  return new TextDecoder().decode(bytes);
}

export const EVERYONE_MENTION_RE = /(?<![a-zA-Z0-9_])@everyone(?![a-zA-Z0-9_])/i;
export const HERE_MENTION_RE    = /(?<![a-zA-Z0-9_])@here(?![a-zA-Z0-9_])/i;

export interface ChatState {
  servers: (Server & { role: string })[];
  channels: Channel[];
  messages: Message[];
  members: MemberWithUser[];
  onlineUsers: Set<string>; // derived from userStatuses for backwards compat
  userStatuses: Record<string, PresenceStatus>;
  userActivities: Record<string, ActivityInfo>;
  activeServerId: string | null;
  activeChannelId: string | null;
  hasMoreMessages: boolean;
  messageCursor: string | null;
  loadingServers: boolean;
  loadingMessages: boolean;
  channelsLoaded: boolean;

  // Reactions: messageId -> grouped reactions
  reactions: Record<string, { emoji: string; userIds: string[] }[]>;

  // Search
  searchQuery: string;
  searchFilters: {
    fromUserId?: string;
    fromUsername?: string;
    inChannelId?: string;
    inChannelName?: string;
    has?: string;
    mentionsUserId?: string;
    mentionsUsername?: string;
    before?: string;
    on?: string;
    after?: string;
  };
  searchResults: Message[] | null;

  // File uploads
  pendingAttachments: Attachment[];
  uploadProgress: Record<string, number>;

  // E2EE: decrypted message cache (messageId → plaintext)
  decryptedCache: Record<string, string>;

  // Unread tracking
  unreadChannels: Set<string>;
  mentionCounts: Record<string, number>;  // channelId → unread @mention count
  markChannelRead: (channelId: string) => void;

  // Typing indicators: channelId -> Set of userIds currently typing
  typingUsers: Record<string, Set<string>>;

  // Custom emoji for the active server
  customEmojis: CustomEmoji[];

  // Room knocks and invites
  roomKnocks: { channelId: string; userId: string; username: string; timestamp: number }[];
  roomInvites: { channelId: string; channelName: string; inviterUsername: string; serverId: string; timestamp: number }[];
  dismissKnock: (timestamp: number) => void;
  dismissRoomInvite: (timestamp: number) => void;

  loadServers: () => Promise<void>;
  selectServer: (serverId: string) => Promise<void>;
  selectChannel: (channelId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  sendMessage: (content: string) => void;
  editMessage: (messageId: string, newContent: string) => void;
  deleteMessage: (messageId: string) => void;
  uploadFile: (file: File) => Promise<void>;
  removePendingAttachment: (id: string) => void;
  updateServer: (serverId: string, name: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string) => void;
  removeReaction: (messageId: string, emoji: string) => void;
  searchMessages: (query: string, filters?: { fromUserId?: string; fromUsername?: string; inChannelId?: string; inChannelName?: string; has?: string; mentionsUserId?: string; mentionsUsername?: string; before?: string; on?: string; after?: string }) => Promise<void>;
  searchUserActivity: (userId: string, username: string) => Promise<void>;
  clearSearch: () => void;
  setMyStatus: (status: PresenceStatus) => void;
  fetchCustomEmojis: (serverId: string) => Promise<void>;
}

// Per-channel message cache for instant channel switching
interface ChannelCache {
  messages: Message[];
  reactions: Record<string, { emoji: string; userIds: string[] }[]>;
  hasMore: boolean;
  cursor: string | null;
}
export const channelMessageCache = new Map<string, ChannelCache>();

export function saveChannelCache(channelId: string, state: ChatState) {
  channelMessageCache.set(channelId, {
    messages: state.messages,
    reactions: state.reactions,
    hasMore: state.hasMoreMessages,
    cursor: state.messageCursor,
  });
}

// Server-level cache for instant restore when switching back from DMs
interface ServerCache {
  channels: ChatState["channels"];
  members: ChatState["members"];
  activeChannelId: string | null;
}
export const serverCache = new Map<string, ServerCache>();

export function saveServerCache(state: ChatState) {
  if (state.activeServerId) {
    serverCache.set(state.activeServerId, {
      channels: state.channels,
      members: state.members,
      activeChannelId: state.activeChannelId,
    });
  }
}

// DM message cache for instant switching between DMs
interface DMCache {
  messages: DMMessage[];
  hasMore: boolean;
  cursor: string | null;
}
export const dmMessageCache = new Map<string, DMCache>();

export function saveDMCache(dmChannelId: string, state: { dmMessages: DMMessage[]; dmHasMore: boolean; dmCursor: string | null }) {
  dmMessageCache.set(dmChannelId, {
    messages: state.dmMessages,
    hasMore: state.dmHasMore,
    cursor: state.dmCursor,
  });
}

// Helper to get username map
export function getUsernameMap(members: MemberWithUser[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of members) {
    map[m.userId] = m.username;
  }
  return map;
}

// Helper to get image map
export function getUserImageMap(members: MemberWithUser[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const m of members) {
    map[m.userId] = m.image;
  }
  return map;
}

// Helper to get role map
export function getUserRoleMap(members: MemberWithUser[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of members) {
    map[m.userId] = m.role;
  }
  return map;
}

// Helper to get ring info map
export function getUserRingMap(members: MemberWithUser[]): Record<string, { ringStyle: string; ringSpin: boolean; ringPatternSeed: number | null }> {
  const map: Record<string, { ringStyle: string; ringSpin: boolean; ringPatternSeed: number | null }> = {};
  for (const m of members) {
    map[m.userId] = { ringStyle: m.ringStyle ?? "default", ringSpin: m.ringSpin ?? false, ringPatternSeed: m.ringPatternSeed ?? null };
  }
  return map;
}

