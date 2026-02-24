import type {
  Server,
  Channel,
  Message,
  PaginatedResponse,
  UpdateServerRequest,
  CreateChannelRequest,
  UpdateChannelRequest,
  MemberWithUser,
  Reaction,
  ReorderItem,
  DMMessage,
  Attachment,
  LinkPreview,
  SpotifyAccount,
  SpotifyTrack,
  ListeningSession,
  QueueItem,
  RingStyle,
  SoundboardSound,
  CustomEmoji,
  EmojiFavorites,
  WhitelistEntry,
} from "../types/shared.js";

import { API_BASE } from "./serverUrl.js";

interface AuthResponse {
  user: { id: string; email: string; username: string; image?: string | null; ringStyle: RingStyle; ringSpin: boolean; steamId?: string | null; ringPatternSeed?: number | null; bannerCss?: string | null; bannerPatternSeed?: number | null; status?: string };
  token?: string;
}

interface SpotifySearchResponse {
  tracks: {
    items: SpotifyTrack[];
  };
}

const TOKEN_KEY = "flux-session-token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) {
    headers["Content-Type"] ??= "application/json";
  }
  // Attach stored token as Authorization header for cross-origin support
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });

  if (!res.ok) {
    // TODO: improve error handling — catch returns {} so body.error is undefined (not a crash), but a typed error response would be better
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──

export async function signUp(email: string, password: string, username: string) {
  const data = await request<AuthResponse>("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: username, username }),
  });
  if (data.token) setStoredToken(data.token);
  return data;
}

export async function signIn(email: string, password: string) {
  const data = await request<AuthResponse>("/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (data.token) setStoredToken(data.token);
  return data;
}

export async function signOut() {
  const result = await request("/auth/sign-out", { method: "POST" });
  setStoredToken(null);
  return result;
}

export async function getSession(): Promise<{ user: { id: string; email: string; username: string; image?: string | null; ringStyle: RingStyle; ringSpin: boolean; steamId?: string | null; ringPatternSeed?: number | null; bannerCss?: string | null; bannerPatternSeed?: number | null; status?: string } } | null> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}/auth/get-session`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data ?? null;
}

// ── User Profile ──

export async function updateUserProfile(data: { username?: string; image?: string | null; ringStyle?: RingStyle; ringSpin?: boolean; steamId?: string | null }) {
  return request<{ id: string; username: string; email: string; image: string | null; ringStyle: RingStyle; ringSpin: boolean; steamId: string | null; ringPatternSeed: number | null; bannerCss: string | null; bannerPatternSeed: number | null }>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ── Servers ──

export async function getServers() {
  return request<(Server & { role: string })[]>("/servers");
}

export async function updateServer(serverId: string, data: UpdateServerRequest) {
  return request<Server>(`/servers/${serverId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function leaveServer(serverId: string) {
  return request<void>(`/servers/${serverId}/members/me`, {
    method: "DELETE",
  });
}

export async function getServerMembers(serverId: string) {
  return request<MemberWithUser[]>(`/servers/${serverId}/members`);
}

export async function updateMemberRole(userId: string, role: string) {
  return request<void>(`/members/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

// ── Whitelist ──

export async function getWhitelist() {
  return request<WhitelistEntry[]>("/whitelist");
}

export async function addToWhitelist(emails: string[]) {
  return request<WhitelistEntry[]>("/whitelist", {
    method: "POST",
    body: JSON.stringify({ emails }),
  });
}

export async function removeFromWhitelist(id: string) {
  return request<void>(`/whitelist/${id}`, { method: "DELETE" });
}

// ── Channels ──

export async function getChannels(serverId: string) {
  return request<Channel[]>(`/servers/${serverId}/channels`);
}

export async function createChannel(serverId: string, data: CreateChannelRequest) {
  return request<Channel>(`/servers/${serverId}/channels`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateChannel(serverId: string, channelId: string, data: UpdateChannelRequest) {
  return request<Channel>(`/servers/${serverId}/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteChannel(serverId: string, channelId: string) {
  return request<void>(`/servers/${serverId}/channels/${channelId}`, {
    method: "DELETE",
  });
}

export async function createRoom(serverId: string, name: string) {
  return createChannel(serverId, { name, type: "voice", isRoom: true });
}

export async function acceptKnock(serverId: string, channelId: string, userId: string) {
  return request<void>(`/servers/${serverId}/rooms/${channelId}/accept-knock`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function inviteToRoom(serverId: string, channelId: string, userId: string) {
  return request<void>(`/servers/${serverId}/rooms/${channelId}/invite`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function moveUserToRoom(serverId: string, channelId: string, userId: string, targetChannelId: string) {
  return request<void>(`/servers/${serverId}/rooms/${channelId}/move`, {
    method: "POST",
    body: JSON.stringify({ userId, targetChannelId }),
  });
}

export async function reorderChannels(serverId: string, items: ReorderItem[]) {
  return request<void>(`/servers/${serverId}/channels/reorder`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

// ── Messages ──

export async function getMessages(channelId: string, cursor?: string) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<PaginatedResponse<Message>>(`/channels/${channelId}/messages${params}`);
}

// ── Search ──

interface ServerSearchOptions {
  q?: string;
  senderId?: string;
  channelId?: string;
  has?: string;
  mentionsUsername?: string;
  before?: string;
  on?: string;
  after?: string;
}

export async function searchServerMessages(serverId: string, opts: ServerSearchOptions) {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.senderId) params.set("sender_id", opts.senderId);
  if (opts.channelId) params.set("channel_id", opts.channelId);
  if (opts.has) params.set("has", opts.has);
  if (opts.mentionsUsername) params.set("mentions_username", opts.mentionsUsername);
  if (opts.before) params.set("before", opts.before);
  if (opts.on) params.set("on", opts.on);
  if (opts.after) params.set("after", opts.after);
  return request<{ items: Message[] }>(`/servers/${serverId}/messages/search?${params}`);
}

// ── Reactions ──

export async function getReactions(messageIds: string[]) {
  return request<Reaction[]>(`/messages/reactions?ids=${messageIds.join(",")}`);
}

// ── Direct Messages ──

export async function getDMChannels() {
  return request<{ id: string; otherUser: { id: string; username: string; image: string | null }; createdAt: string }[]>("/dms");
}

export async function createDM(userId: string) {
  return request<{ id: string; otherUser: { id: string; username: string; image: string | null }; createdAt: string }>("/dms", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function getDMMessages(dmChannelId: string, cursor?: string) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<PaginatedResponse<DMMessage>>(`/dms/${dmChannelId}/messages${params}`);
}

export async function searchDMMessages(dmChannelId: string, query: string) {
  return request<{ items: DMMessage[] }>(
    `/dms/${dmChannelId}/messages/search?q=${encodeURIComponent(query)}`
  );
}

// ── E2EE Keys ──

export async function setPublicKey(publicKey: string) {
  return request<void>("/users/me/public-key", {
    method: "PUT",
    body: JSON.stringify({ publicKey }),
  });
}

export async function getPublicKey(userId: string) {
  return request<{ publicKey: string | null }>(`/users/${userId}/public-key`);
}

export async function storeServerKey(serverId: string, encryptedKey: string, senderId: string) {
  return request<void>(`/servers/${serverId}/keys`, {
    method: "POST",
    body: JSON.stringify({ encryptedKey, senderId }),
  });
}

export async function getMyServerKey(serverId: string) {
  return request<{ encryptedKey: string; senderId: string } | null>(`/servers/${serverId}/keys/me`);
}

export async function shareServerKeyWith(serverId: string, userId: string, encryptedKey: string, senderId: string) {
  return request<void>(`/servers/${serverId}/keys/${userId}`, {
    method: "POST",
    body: JSON.stringify({ encryptedKey, senderId }),
  });
}

// ── Voice ──

export async function getVoiceToken(channelId: string, viewer?: boolean) {
  return request<{ token: string; url: string }>("/voice/token", {
    method: "POST",
    body: JSON.stringify({ channelId, ...(viewer ? { viewer: true } : {}) }),
  });
}

// ── Files ──

export function uploadFile(file: File, onProgress?: (pct: number) => void): Promise<Attachment> {
  const formData = new FormData();
  formData.append("file", file);
  const token = getStoredToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/upload`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(formData);
  });
}

export function getFileUrl(id: string, filename: string): string {
  return `${API_BASE}/files/${id}/${encodeURIComponent(filename)}`;
}

export async function getLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    return await request<LinkPreview>(`/link-preview?url=${encodeURIComponent(url)}`);
  } catch {
    return null;
  }
}

// ── Spotify ──

export async function getSpotifyAuthInfo() {
  return request<SpotifyAccount>("/spotify/auth-info");
}

export async function initSpotifyAuth(codeVerifier: string) {
  return request<{ state: string; redirectUri: string }>("/spotify/init-auth", {
    method: "POST",
    body: JSON.stringify({ codeVerifier }),
  });
}

export async function getSpotifyToken() {
  return request<{ accessToken: string }>("/spotify/token");
}

export async function unlinkSpotify() {
  return request<{ success: boolean }>("/spotify/unlink", { method: "POST" });
}

export async function searchSpotifyTracks(q: string) {
  return request<SpotifySearchResponse>(`/spotify/search?q=${encodeURIComponent(q)}`);
}

export async function createListeningSession(voiceChannelId: string) {
  return request<{ sessionId: string; existing?: boolean }>("/spotify/sessions", {
    method: "POST",
    body: JSON.stringify({ voiceChannelId }),
  });
}

export async function getListeningSession(voiceChannelId: string) {
  return request<{ session: ListeningSession | null; queue: QueueItem[] }>(
    `/spotify/sessions/channel/${voiceChannelId}`
  );
}

export async function addToQueue(sessionId: string, track: {
  trackUri: string; trackName: string; trackArtist: string;
  trackAlbum?: string; trackImageUrl?: string; trackDurationMs: number;
  source?: string;
}) {
  return request<{ id: string }>(`/spotify/sessions/${sessionId}/queue`, {
    method: "POST",
    body: JSON.stringify(track),
  });
}

export async function removeFromQueue(sessionId: string, itemId: string) {
  return request<{ success: boolean }>(`/spotify/sessions/${sessionId}/queue/${itemId}`, {
    method: "DELETE",
  });
}

export async function deleteListeningSession(sessionId: string) {
  return request<{ success: boolean }>(`/spotify/sessions/${sessionId}/end`, {
    method: "DELETE",
  });
}

// ── YouTube ──

export async function searchYouTubeTracks(q: string) {
  return request<{ tracks: import("../types/shared.js").YouTubeTrack[] }>(`/youtube/search?q=${encodeURIComponent(q)}`);
}

export function getYouTubeAudioUrl(videoId: string): string {
  const token = getStoredToken();
  return `${API_BASE}/youtube/audio/${videoId}${token ? `?token=${token}` : ""}`;
}

// ── Soundboard ──

export async function getSoundboardSounds(serverId: string) {
  return request<SoundboardSound[]>(`/servers/${serverId}/soundboard`);
}

export async function createSoundboardSound(serverId: string, data: {
  name: string;
  emoji?: string;
  audioAttachmentId: string;
  volume: number;
}) {
  return request<SoundboardSound>(`/servers/${serverId}/soundboard`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateSoundboardSound(
  serverId: string,
  soundId: string,
  data: { name: string; emoji?: string; volume: number },
) {
  return request<SoundboardSound>(`/servers/${serverId}/soundboard/${soundId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSoundboardSound(serverId: string, soundId: string) {
  return request<void>(`/servers/${serverId}/soundboard/${soundId}`, {
    method: "DELETE",
  });
}

export async function favoriteSoundboardSound(serverId: string, soundId: string) {
  return request<void>(`/servers/${serverId}/soundboard/${soundId}/favorite`, {
    method: "POST",
  });
}

export async function unfavoriteSoundboardSound(serverId: string, soundId: string) {
  return request<void>(`/servers/${serverId}/soundboard/${soundId}/favorite`, {
    method: "DELETE",
  });
}

// ── Custom Emoji ──

export async function getCustomEmojis(serverId: string) {
  return request<CustomEmoji[]>(`/servers/${serverId}/emojis`);
}

export async function createCustomEmoji(
  serverId: string,
  data: { name: string; attachmentId: string },
) {
  return request<CustomEmoji>(`/servers/${serverId}/emojis`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteCustomEmoji(serverId: string, emojiId: string) {
  return request<void>(`/servers/${serverId}/emojis/${emojiId}`, {
    method: "DELETE",
  });
}

export async function getEmojiFavorites() {
  return request<EmojiFavorites>("/me/emoji-favorites");
}

export async function addStandardFavorite(emoji: string) {
  return request<void>("/me/emoji-favorites/standard", {
    method: "POST",
    body: JSON.stringify({ emoji }),
  });
}

export async function removeStandardFavorite(emoji: string) {
  return request<void>("/me/emoji-favorites/standard", {
    method: "DELETE",
    body: JSON.stringify({ emoji }),
  });
}

export async function addCustomFavorite(emojiId: string) {
  return request<void>(`/me/emoji-favorites/custom/${emojiId}`, {
    method: "POST",
  });
}

export async function removeCustomFavorite(emojiId: string) {
  return request<void>(`/me/emoji-favorites/custom/${emojiId}`, {
    method: "DELETE",
  });
}
