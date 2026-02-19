import { create } from "zustand";
import * as api from "../lib/api.js";
import type { RingStyle } from "../types/shared.js";

interface AuthUser {
  id: string;
  email: string;
  username: string;
  image?: string | null;
  ringStyle: RingStyle;
  ringSpin: boolean;
  steamId?: string | null;
  ringPatternSeed?: number | null;
  bannerCss?: string | null;
  bannerPatternSeed?: number | null;
  status?: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: { username?: string; image?: string | null; ringStyle?: RingStyle; ringSpin?: boolean; steamId?: string | null }) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  error: null,

  initialize: async () => {
    const session = await api.getSession();
    set({ user: session?.user ?? null, loading: false });
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      await api.signIn(email, password);
      const session = await api.getSession();
      if (!session?.user) throw new Error("Login failed");
      set({ user: session.user });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      set({ error: message });
      throw err;
    }
  },

  register: async (email, password, username) => {
    set({ error: null });
    try {
      await api.signUp(email, password, username);
      const session = await api.getSession();
      if (!session?.user) throw new Error("Registration failed");
      set({ user: session.user });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed";
      set({ error: message });
      throw err;
    }
  },

  logout: async () => {
    try { await api.signOut(); } catch { /* ignore */ }
    set({ user: null });
  },

  updateProfile: async (data) => {
    const result = await api.updateUserProfile(data);
    const current = get().user;
    if (current) {
      set({ user: { ...current, username: result.username, image: result.image, ringStyle: result.ringStyle, ringSpin: result.ringSpin, steamId: result.steamId, ringPatternSeed: result.ringPatternSeed ?? null, bannerCss: result.bannerCss ?? null, bannerPatternSeed: result.bannerPatternSeed ?? null } });
    }
  },
}));

// Initialize on load
useAuthStore.getState().initialize();
