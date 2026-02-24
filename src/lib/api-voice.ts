import { request } from "./api-base.js";

// ── Voice ──

export async function getVoiceToken(channelId: string, viewer?: boolean) {
  return request<{ token: string; url: string }>("/voice/token", {
    method: "POST",
    body: JSON.stringify({ channelId, ...(viewer ? { viewer: true } : {}) }),
  });
}
