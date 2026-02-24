import type { SoundboardSound } from "@/types/shared.js";

import { request } from "./base.js";

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
