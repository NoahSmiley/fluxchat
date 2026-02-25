import type {
  Message,
  PaginatedResponse,
  Reaction,
  DMMessage,
  Attachment,
  LinkPreview,
} from "@/types/shared.js";

import { API_BASE, request, getStoredToken } from "./base.js";

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
