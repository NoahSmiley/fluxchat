import { request } from "./base.js";

// ── Voice ──

export interface VoiceTokenResponse {
  token: string;
  url: string;
  screenToken: string | null;
  screenUrl: string | null;
}

export async function getVoiceToken(channelId: string) {
  return request<VoiceTokenResponse>("/voice/token", {
    method: "POST",
    body: JSON.stringify({ channelId }),
  });
}
