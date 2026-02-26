import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ART_SETS } from "@/lib/galleryPresets.js";
import type { GallerySetDetail } from "@/types/shared.js";
import { getSubscribedSets, getGallerySetDetail } from "@/lib/api/gallery.js";

export type GalleryMediaType = "image" | "video";

export interface GalleryImage {
  id: string;
  name: string;
  dataUrl?: string;
  css?: string;
  mediaType?: GalleryMediaType; // "image" (default) or "video" (mp4/webm)
  attachmentId?: string;   // server-hosted attachment ID
  filename?: string;       // server-hosted filename
}

export interface ArtSet {
  id: string;
  name: string;
  images: GalleryImage[];
}

export type GalleryMode = "off" | "single" | "set";
export type RotationMode = "none" | "daily" | "hourly" | "random";

export interface FocusPoint {
  x: number; // 0–100 (percentage)
  y: number;
}

interface GalleryState {
  mode: GalleryMode;
  singleImage: GalleryImage | null;
  activeSetId: string | null;
  currentSetIndex: number;
  rotationMode: RotationMode;
  lastRotatedAt: number;
  userImages: GalleryImage[];
  galleryHeight: number;
  focusPoints: Record<string, FocusPoint>; // keyed by image id
  subscribedSets: GallerySetDetail[];
  subscribedSetsLoaded: boolean;

  setMode: (mode: GalleryMode) => void;
  setSingleImage: (img: GalleryImage | null) => void;
  addUserImage: (img: GalleryImage) => void;
  removeUserImage: (id: string) => void;
  setActiveSet: (setId: string | null) => void;
  setRotationMode: (mode: RotationMode) => void;
  setGalleryHeight: (height: number) => void;
  setFocusPoint: (imageId: string, point: FocusPoint) => void;
  rotateIfNeeded: () => void;
  getCurrentImage: () => GalleryImage | null;
  loadSubscribedSets: () => Promise<void>;
  addSubscribedSet: (set: GallerySetDetail) => void;
  removeSubscribedSet: (setId: string) => void;
  refreshSubscribedSet: (setId: string) => Promise<void>;
}

function subscribedSetToArtSet(detail: GallerySetDetail): ArtSet {
  return {
    id: detail.id,
    name: detail.name,
    images: detail.images.map((img) => ({
      id: img.id,
      name: img.name,
      attachmentId: img.attachmentId,
      filename: img.filename,
    })),
  };
}

function getActiveSet(setId: string | null, subscribedSets: GallerySetDetail[] = []): ArtSet | undefined {
  const builtin = ART_SETS.find((s) => s.id === setId);
  if (builtin) return builtin;
  const sub = subscribedSets.find((s) => s.id === setId);
  if (sub) return subscribedSetToArtSet(sub);
  return undefined;
}

export const useGalleryStore = create<GalleryState>()(
  persist(
    (set, get) => ({
      mode: "off",
      singleImage: null,
      activeSetId: null,
      currentSetIndex: 0,
      rotationMode: "none",
      lastRotatedAt: 0,
      userImages: [],
      galleryHeight: 120,
      focusPoints: {},
      subscribedSets: [],
      subscribedSetsLoaded: false,

      setMode: (mode) => set({ mode }),

      setSingleImage: (img) => set({ singleImage: img, mode: img ? "single" : "off" }),

      addUserImage: (img) =>
        set((s) => ({ userImages: [...s.userImages, img] })),

      removeUserImage: (id) => {
        const { singleImage, userImages } = get();
        const next: Partial<GalleryState> = {
          userImages: userImages.filter((i) => i.id !== id),
        };
        if (singleImage?.id === id) {
          next.singleImage = null;
          next.mode = "off";
        }
        set(next);
      },

      setActiveSet: (setId) => {
        if (setId) {
          set({ activeSetId: setId, currentSetIndex: 0, mode: "set", lastRotatedAt: Date.now() });
        } else {
          set({ activeSetId: null, mode: "off" });
        }
      },

      setRotationMode: (rotationMode) =>
        set({ rotationMode, lastRotatedAt: Date.now() }),

      setGalleryHeight: (height) =>
        set({ galleryHeight: Math.max(60, Math.min(300, height)) }),

      setFocusPoint: (imageId, point) =>
        set((s) => ({
          focusPoints: {
            ...s.focusPoints,
            [imageId]: {
              x: Math.max(0, Math.min(100, point.x)),
              y: Math.max(0, Math.min(100, point.y)),
            },
          },
        })),

      loadSubscribedSets: async () => {
        try {
          const sets = await getSubscribedSets();
          set({ subscribedSets: sets, subscribedSetsLoaded: true });
        } catch {
          set({ subscribedSetsLoaded: true });
        }
      },

      addSubscribedSet: (detail) =>
        set((s) => ({ subscribedSets: [...s.subscribedSets, detail] })),

      removeSubscribedSet: (setId) =>
        set((s) => ({
          subscribedSets: s.subscribedSets.filter((ss) => ss.id !== setId),
        })),

      refreshSubscribedSet: async (setId) => {
        try {
          const detail = await getGallerySetDetail(setId);
          set((s) => ({
            subscribedSets: s.subscribedSets.map((ss) =>
              ss.id === setId ? detail : ss,
            ),
          }));
        } catch { /* ignore — set may have been deleted */ }
      },

      rotateIfNeeded: () => {
        const { mode, activeSetId, currentSetIndex, rotationMode, lastRotatedAt, subscribedSets } = get();
        if (mode !== "set" || !activeSetId || rotationMode === "none") return;

        const artSet = getActiveSet(activeSetId, subscribedSets);
        if (!artSet || artSet.images.length <= 1) return;

        const now = Date.now();
        const elapsed = now - lastRotatedAt;
        let shouldRotate = false;

        if (rotationMode === "daily") {
          const lastDay = new Date(lastRotatedAt).toDateString();
          const today = new Date(now).toDateString();
          shouldRotate = lastDay !== today;
        } else if (rotationMode === "hourly") {
          shouldRotate = elapsed >= 60 * 60 * 1000;
        } else if (rotationMode === "random") {
          // Random rotates on every check (app load)
          shouldRotate = true;
        }

        if (shouldRotate) {
          let nextIndex: number;
          if (rotationMode === "random") {
            do {
              nextIndex = Math.floor(Math.random() * artSet.images.length);
            } while (nextIndex === currentSetIndex && artSet.images.length > 1);
          } else {
            nextIndex = (currentSetIndex + 1) % artSet.images.length;
          }
          set({ currentSetIndex: nextIndex, lastRotatedAt: now });
        }
      },

      getCurrentImage: () => {
        const { mode, singleImage, activeSetId, currentSetIndex, subscribedSets } = get();
        if (mode === "single") return singleImage;
        if (mode === "set" && activeSetId) {
          const artSet = getActiveSet(activeSetId, subscribedSets);
          if (artSet && artSet.images.length > 0) {
            return artSet.images[currentSetIndex % artSet.images.length];
          }
        }
        return null;
      },
    }),
    {
      name: "flux-gallery",
      partialize: (state) => ({
        mode: state.mode,
        singleImage: state.singleImage,
        activeSetId: state.activeSetId,
        currentSetIndex: state.currentSetIndex,
        rotationMode: state.rotationMode,
        lastRotatedAt: state.lastRotatedAt,
        userImages: state.userImages,
        galleryHeight: state.galleryHeight,
        focusPoints: state.focusPoints,
      }),
    },
  ),
);
