import { getEmojiFavorites } from "./api/index.js";
import { dbg } from "./debug.js";

/** Favorites cache — persists between picker opens so re-open is instant. */
export const favCache: { data: { standard: Set<string>; customIds: Set<string> } | null } = { data: null };

/** Call this once after the user logs in to prefetch favorites into cache. */
export function prefetchEmojiFavorites(): void {
  getEmojiFavorites()
    .then((favs) => {
      favCache.data = { standard: new Set(favs.standard), customIds: new Set(favs.customIds) };
    })
    .catch((err) => dbg("emoji", "Failed to prefetch favorites", err));
}
