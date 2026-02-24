import type { RingStyle } from "../types/shared.js";

import { API_BASE, request, getStoredToken, setStoredToken } from "./api-base.js";
import type { AuthResponse } from "./api-base.js";

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
