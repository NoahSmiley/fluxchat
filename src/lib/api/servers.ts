import type {
  Server,
  Channel,
  UpdateServerRequest,
  CreateChannelRequest,
  UpdateChannelRequest,
  MemberWithUser,
  ReorderItem,
  WhitelistEntry,
  CustomEmoji,
  EmojiFavorites,
} from "../../types/shared.js";

import { request } from "./base.js";

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
