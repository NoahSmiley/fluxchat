import { request } from "./base.js";

// ── Voice ──

export async function getVoiceToken(channelId: string) {
  return request<{ token: string; url: string }>("/voice/token", {
    method: "POST",
    body: JSON.stringify({ channelId }),
  });
}
