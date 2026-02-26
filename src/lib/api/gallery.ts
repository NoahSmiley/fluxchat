import type { GallerySet, GallerySetDetail } from "@/types/shared.js";

import { request } from "./base.js";

// ── Gallery ──

export async function getGallerySets(query?: string) {
  const params = query ? `?q=${encodeURIComponent(query)}` : "";
  return request<GallerySet[]>(`/gallery${params}`);
}

export async function getSubscribedSets() {
  return request<GallerySetDetail[]>("/gallery/subscribed");
}

export async function getMyGallerySets() {
  return request<GallerySet[]>("/gallery/mine");
}

export async function getGallerySetDetail(setId: string) {
  return request<GallerySetDetail>(`/gallery/${setId}`);
}

export async function createGallerySet(data: {
  name: string;
  description?: string;
  imageAttachmentIds: string[];
  imageNames: string[];
}) {
  return request<GallerySet>("/gallery", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateGallerySet(setId: string, data: { name?: string; description?: string }) {
  return request<void>(`/gallery/${setId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteGallerySet(setId: string) {
  return request<void>(`/gallery/${setId}`, {
    method: "DELETE",
  });
}

export async function subscribeToSet(setId: string) {
  return request<void>(`/gallery/${setId}/subscribe`, {
    method: "POST",
  });
}

export async function unsubscribeFromSet(setId: string) {
  return request<void>(`/gallery/${setId}/subscribe`, {
    method: "DELETE",
  });
}

export async function addImagesToSet(setId: string, data: { imageAttachmentIds: string[]; imageNames: string[] }) {
  return request<void>(`/gallery/${setId}/images`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function removeImageFromSet(setId: string, imageId: string) {
  return request<void>(`/gallery/${setId}/images/${imageId}`, {
    method: "DELETE",
  });
}
