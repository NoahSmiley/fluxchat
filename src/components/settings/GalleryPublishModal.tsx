import { useState } from "react";
import { X } from "lucide-react";
import { useGalleryStore, type GalleryImage } from "@/stores/gallery.js";
import { createGallerySet } from "@/lib/api/gallery.js";
import { getFileUrl } from "@/lib/api/messages.js";

export function GalleryPublishModal({ onClose }: { onClose: () => void }) {
  const userImages = useGalleryStore((s) => s.userImages);
  const serverImages = userImages.filter((img) => img.attachmentId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleImage = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePublish = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    if (selectedIds.size === 0) { setError("Select at least one image"); return; }

    const selected = serverImages.filter((img) => selectedIds.has(img.id));
    setPublishing(true);
    setError(null);

    try {
      await createGallerySet({
        name: name.trim(),
        description: description.trim() || undefined,
        imageAttachmentIds: selected.map((img) => img.attachmentId!),
        imageNames: selected.map((img) => img.name),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  function thumbStyle(img: GalleryImage): React.CSSProperties {
    if (img.attachmentId && img.filename) {
      return { backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})`, backgroundSize: "cover", backgroundPosition: "center" };
    }
    if (img.dataUrl) {
      return { backgroundImage: `url(${img.dataUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
    }
    return {};
  }

  return (
    <div className="gallery-browser-overlay" onClick={onClose}>
      <div className="gallery-browser-modal gallery-publish-modal" onClick={(e) => e.stopPropagation()}>
        <div className="gallery-browser-header">
          <span className="gallery-browser-title">Publish Gallery Set</span>
          <button className="gallery-popover-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "0 0 4px" }}>
          <input
            className="gallery-browser-search"
            type="text"
            placeholder="Set name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            className="gallery-browser-search"
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <span className="gallery-popover-section-label" style={{ display: "block", marginBottom: 6 }}>
          Select images ({selectedIds.size} selected)
        </span>
        <div className="gallery-image-grid" style={{ maxHeight: 200, overflowY: "auto" }}>
          {serverImages.map((img) => (
            <div
              key={img.id}
              className={`gallery-image-thumb ${selectedIds.has(img.id) ? "active" : ""}`}
              style={thumbStyle(img)}
              onClick={() => toggleImage(img.id)}
            />
          ))}
          {serverImages.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              No server-uploaded images available. Upload images first.
            </div>
          )}
        </div>

        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>{error}</div>}

        <button
          className="gallery-settings-btn"
          style={{ marginTop: 12, width: "100%" }}
          onClick={handlePublish}
          disabled={publishing}
        >
          {publishing ? "Publishing..." : "Publish"}
        </button>
      </div>
    </div>
  );
}
