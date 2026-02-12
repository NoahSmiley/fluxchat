import type {
  Server,
  Channel,
  Message,
  PaginatedResponse,
  CreateServerRequest,
  UpdateServerRequest,
  CreateChannelRequest,
  UpdateChannelRequest,
  MemberWithUser,
  Reaction,
  DMMessage,
  Attachment,
  LinkPreview,
  SpotifyAccount,
  ListeningSession,
  QueueItem,
} from "../types/shared.js";

import { API_BASE } from "./serverUrl.js";

const BASE_URL = API_BASE;
const TOKEN_KEY = "flux-session-token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
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
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Auth ──

export async function signUp(email: string, password: string, username: string) {
  const data = await request<{ user: any; token?: string }>("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: username, username }),
  });
  if (data.token) setStoredToken(data.token);
  return data;
}

export async function signIn(email: string, password: string) {
  const data = await request<{ user: any; token?: string }>("/auth/sign-in/email", {
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

export async function getSession(): Promise<{ user: { id: string; email: string; username: string; image?: string | null } } | null> {
  const headers: Record<string, string> = {};
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE_URL}/auth/get-session`, {
    credentials: "include",
    headers,
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data ?? null;
}

// ── User Profile ──

export async function updateUserProfile(data: { username?: string; image?: string | null }) {
  return request<{ id: string; username: string; email: string; image: string | null }>("/users/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ── Servers ──

export async function getServers() {
  return request<(Server & { role: string })[]>("/servers");
}

export async function createServer(data: CreateServerRequest) {
  return request<Server>("/servers", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function joinServer(inviteCode: string) {
  return request<Server>("/servers/join", {
    method: "POST",
    body: JSON.stringify({ inviteCode }),
  });
}

export async function updateServer(serverId: string, data: UpdateServerRequest) {
  return request<Server>(`/servers/${serverId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteServer(serverId: string) {
  return request<void>(`/servers/${serverId}`, {
    method: "DELETE",
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

// ── Messages ──

export async function getMessages(channelId: string, cursor?: string) {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<PaginatedResponse<Message>>(`/channels/${channelId}/messages${params}`);
}

// ── Search ──

export async function searchMessages(channelId: string, query: string) {
  return request<{ items: Message[] }>(
    `/channels/${channelId}/messages/search?q=${encodeURIComponent(query)}`
  );
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

export async function searchUsers(query: string) {
  return request<{ id: string; username: string }[]>(`/users/search?q=${encodeURIComponent(query)}`);
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
    xhr.open("POST", `${BASE_URL}/upload`);
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
  return `${BASE_URL}/files/${id}/${encodeURIComponent(filename)}`;
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
  return request<any>(`/spotify/search?q=${encodeURIComponent(q)}`);
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
}) {
  return request<{ id: string }>(`/spotify/sessions/${sessionId}/queue`, {
    method: "POST",
    body: JSON.stringify(track),
  });
}

export async function deleteListeningSession(sessionId: string) {
  return request<{ success: boolean }>(`/spotify/sessions/${sessionId}/end`, {
    method: "DELETE",
  });
}
