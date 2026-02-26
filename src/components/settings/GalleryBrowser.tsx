import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useGalleryStore } from "@/stores/gallery.js";
import { getGallerySets, subscribeToSet, unsubscribeFromSet, getGallerySetDetail } from "@/lib/api/gallery.js";
import { getFileUrl } from "@/lib/api/messages.js";
import type { GallerySet } from "@/types/shared.js";

export function GalleryBrowser({ onClose }: { onClose: () => void }) {
  const [sets, setSets] = useState<GallerySet[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const addSubscribedSet = useGalleryStore((s) => s.addSubscribedSet);
  const removeSubscribedSet = useGalleryStore((s) => s.removeSubscribedSet);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const result = await getGallerySets(query || undefined);
        if (!cancelled) setSets(result);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [query]);

  const handleToggleSubscribe = async (set: GallerySet) => {
    const idx = sets.findIndex((s) => s.id === set.id);
    if (set.subscribed) {
      await unsubscribeFromSet(set.id);
      removeSubscribedSet(set.id);
      setSets((prev) => prev.map((s, i) => i === idx ? { ...s, subscribed: false, subscriberCount: s.subscriberCount - 1 } : s));
    } else {
      await subscribeToSet(set.id);
      // Fetch the full detail for the store
      try {
        const detail = await getGallerySetDetail(set.id);
        addSubscribedSet(detail);
      } catch {
        // ignore — UI still updates
      }
      setSets((prev) => prev.map((s, i) => i === idx ? { ...s, subscribed: true, subscriberCount: s.subscriberCount + 1 } : s));
    }
  };

  return (
    <div className="gallery-browser-overlay" onClick={onClose}>
      <div className="gallery-browser-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gallery-browser-header">
          <span className="gallery-browser-title">Browse Gallery Sets</span>
          <button className="gallery-popover-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <input
          className="gallery-browser-search"
          type="text"
          placeholder="Search sets..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className="gallery-browser-grid">
          {loading && sets.length === 0 && (
            <div className="gallery-browser-empty">Loading...</div>
          )}
          {!loading && sets.length === 0 && (
            <div className="gallery-browser-empty">No gallery sets found</div>
          )}
          {sets.map((set) => (
            <div key={set.id} className="gallery-browser-card">
              <div
                className="gallery-browser-cover"
                style={set.coverAttachmentId && set.coverFilename
                  ? { backgroundImage: `url(${getFileUrl(set.coverAttachmentId, set.coverFilename)})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : {}
                }
              />
              <div className="gallery-browser-info">
                <span className="gallery-browser-name">{set.name}</span>
                <span className="gallery-browser-meta">
                  by {set.creatorUsername} · {set.imageCount} images · {set.subscriberCount} subscribers
                </span>
              </div>
              <button
                className={`gallery-browser-subscribe-btn ${set.subscribed ? "subscribed" : ""}`}
                onClick={() => handleToggleSubscribe(set)}
              >
                {set.subscribed ? "Unsubscribe" : "Subscribe"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
