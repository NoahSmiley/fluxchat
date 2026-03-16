import { create } from "zustand";
import * as api from "@/lib/api/index.js";
import type { RingStyle } from "@/types/shared.js";

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
  introSoundUrl?: string | null;
  exitSoundUrl?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  ssoPolling: boolean;
  ssoCode: string | null;
  initialize: () => Promise<void>;
  startSSO: () => Promise<void>;
  cancelSSO: () => void;
  logout: () => Promise<void>;
  updateProfile: (data: { username?: string; image?: string | null; ringStyle?: RingStyle; ringSpin?: boolean; steamId?: string | null; introSoundAttachmentId?: string | null; exitSoundAttachmentId?: string | null }) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  error: null,
  ssoPolling: false,
  ssoCode: null,

  initialize: async () => {
    const session = await api.getSession();
    set({ user: session?.user ?? null, loading: false });
  },

  startSSO: async () => {
    set({ error: null, ssoPolling: true, ssoCode: null });
    try {
      const { code, loginUrl } = await api.ssoInitiate();
      set({ ssoCode: code });

      // Open browser for login
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(loginUrl);
      } catch {
        window.open(loginUrl, "_blank");
      }

      // Poll every 2 seconds, timeout after 10 minutes
      const maxAttempts = 300;
      for (let i = 0; i < maxAttempts; i++) {
        if (!get().ssoPolling) return; // cancelled

        await new Promise((r) => setTimeout(r, 2000));

        if (!get().ssoPolling) return; // cancelled during wait

        try {
          const result = await api.ssoPoll(code);

          if (result.token && result.user) {
            // Success
            const session = await api.getSession();
            set({ user: session?.user ?? null, ssoPolling: false, ssoCode: null });
            return;
          }

          if (result.status === "expired") {
            set({ error: "Login expired. Please try again.", ssoPolling: false, ssoCode: null });
            return;
          }

          // status === "pending" — continue polling
        } catch {
          // Network error — continue polling
        }
      }

      // Timeout
      set({ error: "Login timed out. Please try again.", ssoPolling: false, ssoCode: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start login";
      set({ error: message, ssoPolling: false, ssoCode: null });
    }
  },

  cancelSSO: () => {
    set({ ssoPolling: false, ssoCode: null, error: null });
  },

  logout: async () => {
    try { await api.signOut(); } catch { /* ignore */ }
    set({ user: null });
  },

  updateProfile: async (data) => {
    const result = await api.updateUserProfile(data);
    const current = get().user;
    if (current) {
      set({ user: { ...current, username: result.username, image: result.image, ringStyle: result.ringStyle, ringSpin: result.ringSpin, steamId: result.steamId, ringPatternSeed: result.ringPatternSeed ?? null, bannerCss: result.bannerCss ?? null, bannerPatternSeed: result.bannerPatternSeed ?? null, introSoundUrl: result.introSoundUrl ?? null, exitSoundUrl: result.exitSoundUrl ?? null } });
    }
  },
}));

useAuthStore.getState().initialize();
