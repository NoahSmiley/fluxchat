import type { RingStyle } from "../types/shared.js";

import { API_BASE } from "./serverUrl.js";

export { API_BASE };

export interface AuthResponse {
  user: { id: string; email: string; username: string; image?: string | null; ringStyle: RingStyle; ringSpin: boolean; steamId?: string | null; ringPatternSeed?: number | null; bannerCss?: string | null; bannerPatternSeed?: number | null; status?: string };
  token?: string;
}

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

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
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
