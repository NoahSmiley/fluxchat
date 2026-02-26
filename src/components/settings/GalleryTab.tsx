import { useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { Search, Trash2, Upload, X, Plus, ImagePlus, ChevronDown, Check, Pencil } from "lucide-react";
import { useGalleryStore, type GalleryImage, type GalleryMediaType, type GalleryMode, type RotationMode } from "@/stores/gallery.js";
import {
  getGallerySets,
  getMyGallerySets,
  subscribeToSet,
  unsubscribeFromSet,
  getGallerySetDetail,
  createGallerySet,
  deleteGallerySet,
  updateGallerySet,
  addImagesToSet,
  removeImageFromSet,
} from "@/lib/api/gallery.js";
import { getFileUrl, uploadFile } from "@/lib/api/messages.js";
import { ART_SETS } from "@/lib/galleryPresets.js";
import { resolveCurrentImage } from "../sidebar/ChannelSidebarHeader.js";
import { GalleryCropModal } from "../modals/GalleryCropModal.js";
import type { GallerySet, GallerySetDetail, GallerySetImage } from "@/types/shared.js";

type SortMode = "popular" | "newest";

const GALLERY_MODES: { value: GalleryMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "single", label: "Single Image" },
  { value: "set", label: "Art Set" },
];

const ROTATION_MODES: { value: RotationMode; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "hourly", label: "Hourly" },
  { value: "random", label: "Random" },
];

function galleryBg(img: GalleryImage): React.CSSProperties {
  if (img.css) return { background: img.css };
  if (img.attachmentId && img.filename) return { backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})`, backgroundSize: "cover", backgroundPosition: "center" };
  if (img.dataUrl) return { backgroundImage: `url(${img.dataUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  return {};
}

function coverStyle(set: GallerySet): React.CSSProperties {
  if (set.coverAttachmentId && set.coverFilename) {
    return { backgroundImage: `url(${getFileUrl(set.coverAttachmentId, set.coverFilename)})` };
  }
  return {};
}

// Pending publish image (uploaded inline, not added to user library)
interface PendingImage {
  id: string;
  name: string;
  attachmentId: string;
  filename: string;
  url: string;
}

// ── Gallery Tab ──

export function GalleryTab() {
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    mode, singleImage, activeSetId, currentSetIndex, rotationMode, userImages,
    subscribedSets, subscribedSetsLoaded,
    setMode, setSingleImage, addUserImage, removeUserImage, setActiveSet,
    setRotationMode, loadSubscribedSets,
    addSubscribedSet, removeSubscribedSet,
  } = useGalleryStore(
    useShallow((s) => ({
      mode: s.mode, singleImage: s.singleImage, activeSetId: s.activeSetId,
      currentSetIndex: s.currentSetIndex, rotationMode: s.rotationMode,
      userImages: s.userImages,
      subscribedSets: s.subscribedSets,
      subscribedSetsLoaded: s.subscribedSetsLoaded,
      setMode: s.setMode, setSingleImage: s.setSingleImage,
      addUserImage: s.addUserImage, removeUserImage: s.removeUserImage,
      setActiveSet: s.setActiveSet, setRotationMode: s.setRotationMode,
      loadSubscribedSets: s.loadSubscribedSets,
      addSubscribedSet: s.addSubscribedSet, removeSubscribedSet: s.removeSubscribedSet,
    })),
  );

  const setFocusPoint = useGalleryStore((s) => s.setFocusPoint);

  // Crop modal
  const [cropImage, setCropImage] = useState<{ url: string; id: string } | null>(null);

  // Browse state
  const [sets, setSets] = useState<GallerySet[]>([]);
  const [mySets, setMySets] = useState<GallerySet[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("popular");
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(true);

  // Edit state
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [editDetail, setEditDetail] = useState<GallerySetDetail | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editAddingImages, setEditAddingImages] = useState(false);

  // Publish state
  const [publishName, setPublishName] = useState("");
  const [publishDesc, setPublishDesc] = useState("");
  const [publishImages, setPublishImages] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // Load subscribed sets
  useEffect(() => {
    if (!subscribedSetsLoaded) loadSubscribedSets();
  }, [subscribedSetsLoaded, loadSubscribedSets]);

  // Fetch all gallery sets
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const result = await getGallerySets(query || undefined);
        if (!cancelled) setSets(result);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    }, query ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [query]);

  // Fetch user's own sets
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await getMyGallerySets();
        if (!cancelled) setMySets(result);
      } catch { /* ignore */ }
      finally { if (!cancelled) setMyLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [publishSuccess]);

  const sortedSets = [...sets].sort((a, b) => {
    if (sort === "popular") return b.subscriberCount - a.subscriberCount;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const currentImage = resolveCurrentImage(mode, singleImage, activeSetId, currentSetIndex);
  const canReposition = currentImage && !currentImage.css;

  // ── Handlers ──

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !(file.type.startsWith("image/") || file.type.startsWith("video/"))) return;
    const mediaType: GalleryMediaType = file.type.startsWith("video/") ? "video" : "image";
    e.target.value = "";
    try {
      const attachment = await uploadFile(file);
      const img: GalleryImage = {
        id: `user-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ""),
        attachmentId: attachment.id,
        filename: attachment.filename,
        mediaType,
      };
      addUserImage(img);
      if (mode === "single" || mode === "off") setSingleImage(img);
      if (mediaType === "image" && attachment.id && attachment.filename) {
        setCropImage({ url: getFileUrl(attachment.id, attachment.filename), id: img.id });
      }
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        const img: GalleryImage = {
          id: `user-${Date.now()}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          dataUrl: reader.result as string,
          mediaType,
        };
        addUserImage(img);
        if (mode === "single" || mode === "off") setSingleImage(img);
        if (mediaType === "image" && img.dataUrl) {
          setCropImage({ url: img.dataUrl, id: img.id });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Bulk upload for publish — uploads multiple files and adds to publishImages
  const handlePublishUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    // Snapshot the files before resetting the input
    const files = Array.from(fileList);
    e.target.value = "";
    setUploading(true);
    setPublishError(null);

    const newImages: PendingImage[] = [];
    let failCount = 0;
    for (const file of files) {
      // Accept any image file (some environments report empty type for valid images)
      if (file.type && !file.type.startsWith("image/")) continue;
      try {
        const attachment = await uploadFile(file);
        newImages.push({
          id: `pub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          attachmentId: attachment.id,
          filename: attachment.filename,
          url: getFileUrl(attachment.id, attachment.filename),
        });
      } catch (err) {
        console.error("Publish upload failed:", err);
        failCount++;
      }
    }
    if (newImages.length > 0) {
      setPublishImages((prev) => [...prev, ...newImages]);
    }
    if (failCount > 0 && newImages.length === 0) {
      setPublishError(`Failed to upload ${failCount} image${failCount > 1 ? "s" : ""}`);
    } else if (failCount > 0) {
      setPublishError(`${failCount} image${failCount > 1 ? "s" : ""} failed to upload`);
    }
    if (files.length > 0 && newImages.length === 0 && failCount === 0) {
      setPublishError("No valid image files selected");
    }
    setUploading(false);
  };

  const removePublishImage = (id: string) => {
    setPublishImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleToggleSubscribe = async (set: GallerySet) => {
    if (set.subscribed) {
      await unsubscribeFromSet(set.id);
      removeSubscribedSet(set.id);
      setSets((prev) => prev.map((s) => s.id === set.id ? { ...s, subscribed: false, subscriberCount: s.subscriberCount - 1 } : s));
    } else {
      await subscribeToSet(set.id);
      try {
        const detail = await getGallerySetDetail(set.id);
        addSubscribedSet(detail);
      } catch { /* UI still updates */ }
      setSets((prev) => prev.map((s) => s.id === set.id ? { ...s, subscribed: true, subscriberCount: s.subscriberCount + 1 } : s));
    }
  };

  const handleExpandSet = async (setId: string) => {
    if (editingSetId === setId) {
      setEditingSetId(null);
      setEditDetail(null);
      return;
    }
    setEditingSetId(setId);
    setEditDetail(null);
    try {
      const detail = await getGallerySetDetail(setId);
      setEditDetail(detail);
      setEditName(detail.name);
      setEditDesc(detail.description || "");
    } catch { /* ignore */ }
  };

  const handleSaveEdit = async () => {
    if (!editDetail) return;
    setEditSaving(true);
    try {
      const updates: { name?: string; description?: string } = {};
      if (editName.trim() && editName.trim() !== editDetail.name) updates.name = editName.trim();
      if (editDesc.trim() !== (editDetail.description || "")) updates.description = editDesc.trim();
      if (Object.keys(updates).length > 0) {
        await updateGallerySet(editDetail.id, updates);
        setMySets((prev) => prev.map((s) => s.id === editDetail.id ? { ...s, ...updates } : s));
        setSets((prev) => prev.map((s) => s.id === editDetail.id ? { ...s, ...updates } : s));
        setEditDetail((prev) => prev ? { ...prev, ...updates } : prev);
      }
    } catch { /* ignore */ }
    setEditSaving(false);
  };

  const handleEditAddImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !editDetail) return;
    const files = Array.from(fileList);
    e.target.value = "";
    setEditAddingImages(true);
    const ids: string[] = [];
    const names: string[] = [];
    for (const file of files) {
      if (file.type && !file.type.startsWith("image/")) continue;
      try {
        const attachment = await uploadFile(file);
        ids.push(attachment.id);
        names.push(file.name.replace(/\.[^.]+$/, ""));
      } catch { /* skip */ }
    }
    if (ids.length > 0) {
      try {
        await addImagesToSet(editDetail.id, { imageAttachmentIds: ids, imageNames: names });
        // Refresh the detail
        const updated = await getGallerySetDetail(editDetail.id);
        setEditDetail(updated);
        setMySets((prev) => prev.map((s) => s.id === editDetail.id ? { ...s, imageCount: updated.imageCount } : s));
      } catch { /* ignore */ }
    }
    setEditAddingImages(false);
  };

  const handleEditRemoveImage = async (image: GallerySetImage) => {
    if (!editDetail) return;
    try {
      await removeImageFromSet(editDetail.id, image.id);
      setEditDetail((prev) => {
        if (!prev) return prev;
        const images = prev.images.filter((img) => img.id !== image.id);
        return { ...prev, images, imageCount: images.length };
      });
      setMySets((prev) => prev.map((s) => s.id === editDetail.id ? { ...s, imageCount: s.imageCount - 1 } : s));
    } catch { /* ignore */ }
  };

  const handleDeleteMySet = async (setId: string) => {
    try {
      await deleteGallerySet(setId);
      setMySets((prev) => prev.filter((s) => s.id !== setId));
      setSets((prev) => prev.filter((s) => s.id !== setId));
      removeSubscribedSet(setId);
    } catch { /* ignore */ }
  };

  const handlePublish = async () => {
    if (!publishName.trim()) { setPublishError("Name is required"); return; }
    if (publishImages.length === 0) { setPublishError("Add at least one image"); return; }
    setPublishing(true);
    setPublishError(null);
    try {
      await createGallerySet({
        name: publishName.trim(),
        description: publishDesc.trim() || undefined,
        imageAttachmentIds: publishImages.map((img) => img.attachmentId),
        imageNames: publishImages.map((img) => img.name),
      });
      setPublishName("");
      setPublishDesc("");
      setPublishImages([]);
      setPublishSuccess((v) => !v);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      {/* ── Display Settings ── */}
      <div className="settings-card">
        <h3 className="settings-card-title">Display</h3>

        <div className="gallery-mode-picker">
          {GALLERY_MODES.map((m) => (
            <button
              key={m.value}
              className={`gallery-mode-btn ${mode === m.value ? "active" : ""}`}
              onClick={() => setMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Preview */}
        {mode !== "off" && currentImage && (
          <div className="gallery-settings-preview" style={galleryBg(currentImage)} />
        )}
        {mode === "single" && !currentImage && (
          <div className="gallery-settings-preview">
            <div className="gallery-settings-preview-empty">No image selected</div>
          </div>
        )}

        {/* Single mode: image library + upload */}
        {mode === "single" && (
          <>
            {userImages.length > 0 && (
              <div className="gallery-image-grid" style={{ marginBottom: 12 }}>
                {userImages.map((img) => (
                  <div
                    key={img.id}
                    className={`gallery-image-thumb ${singleImage?.id === img.id ? "active" : ""}`}
                    style={galleryBg(img)}
                    onClick={() => setSingleImage(img)}
                  >
                    <button
                      className="gallery-image-thumb-delete"
                      onClick={(e) => { e.stopPropagation(); removeUserImage(img.id); }}
                      title="Remove"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="gallery-settings-actions">
              <button className="gallery-settings-btn" onClick={() => fileRef.current?.click()}>
                <Upload size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                Upload Image
              </button>
              {canReposition && (
                <button
                  className="gallery-settings-btn"
                  onClick={() => {
                    const url = currentImage.attachmentId && currentImage.filename
                      ? getFileUrl(currentImage.attachmentId, currentImage.filename)
                      : currentImage.dataUrl;
                    if (url) setCropImage({ url, id: currentImage.id });
                  }}
                >
                  Reposition
                </button>
              )}
              {currentImage && (
                <button className="gallery-settings-btn gallery-settings-btn-danger" onClick={() => setSingleImage(null)}>
                  Remove
                </button>
              )}
            </div>
          </>
        )}

        {/* Set mode: pick a set + rotation */}
        {mode === "set" && (
          <>
            {subscribedSets.length > 0 && (
              <>
                <span className="gallery-tab-section-label">Subscribed Sets</span>
                <div className="gallery-set-browser" style={{ marginBottom: 12 }}>
                  {subscribedSets.map((subSet) => (
                    <button
                      key={subSet.id}
                      className={`gallery-set-browser-row ${activeSetId === subSet.id ? "active" : ""}`}
                      onClick={() => setActiveSet(subSet.id)}
                    >
                      <div className="gallery-set-browser-strip">
                        {subSet.images.slice(0, 4).map((img) => (
                          <div key={img.id} className="gallery-set-browser-swatch" style={{ backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                        ))}
                      </div>
                      <div className="gallery-set-browser-info">
                        <span className="gallery-set-browser-name">{subSet.name}</span>
                        <span className="gallery-set-browser-count">{subSet.imageCount} images</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <span className="gallery-tab-section-label">Built-in Sets</span>
            <div className="gallery-set-browser">
              {ART_SETS.map((artSet) => (
                <button
                  key={artSet.id}
                  className={`gallery-set-browser-row ${activeSetId === artSet.id ? "active" : ""}`}
                  onClick={() => setActiveSet(artSet.id)}
                >
                  <div className="gallery-set-browser-strip">
                    {artSet.images.slice(0, 4).map((img) => (
                      <div key={img.id} className="gallery-set-browser-swatch" style={galleryBg(img)} />
                    ))}
                  </div>
                  <div className="gallery-set-browser-info">
                    <span className="gallery-set-browser-name">{artSet.name}</span>
                    <span className="gallery-set-browser-count">{artSet.images.length} images</span>
                  </div>
                </button>
              ))}
            </div>

            {activeSetId && (
              <>
                <span className="gallery-tab-section-label" style={{ marginTop: 12 }}>Rotation</span>
                <div className="gallery-rotation-picker">
                  {ROTATION_MODES.map((rm) => (
                    <button
                      key={rm.value}
                      className={`gallery-rotation-picker-btn ${rotationMode === rm.value ? "active" : ""}`}
                      onClick={() => setRotationMode(rm.value)}
                    >
                      {rm.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {canReposition && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="gallery-settings-btn"
                  onClick={() => {
                    const url = currentImage.attachmentId && currentImage.filename
                      ? getFileUrl(currentImage.attachmentId, currentImage.filename)
                      : currentImage.dataUrl;
                    if (url) setCropImage({ url, id: currentImage.id });
                  }}
                >
                  Reposition
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Discover Sets ── */}
      <div className="settings-card">
        <h3 className="settings-card-title">Discover Sets</h3>

        <div className="gallery-discover-header">
          <div className="gallery-discover-search-wrap">
            <Search size={14} className="gallery-discover-search-icon" />
            <input
              className="gallery-discover-search"
              type="text"
              placeholder="Search gallery sets..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="gallery-sort-bar">
            <button
              className={`gallery-sort-btn ${sort === "popular" ? "active" : ""}`}
              onClick={() => setSort("popular")}
            >Popular</button>
            <button
              className={`gallery-sort-btn ${sort === "newest" ? "active" : ""}`}
              onClick={() => setSort("newest")}
            >Newest</button>
          </div>
        </div>

        {loading && sets.length === 0 ? (
          <div className="gallery-browser-empty">Loading...</div>
        ) : sortedSets.length === 0 ? (
          <div className="gallery-browser-empty">No gallery sets found</div>
        ) : (
          <div className="gallery-discover-grid">
            {sortedSets.map((set) => (
              <div key={set.id} className="gallery-discover-card">
                <div className="gallery-discover-cover" style={coverStyle(set)} />
                <div className="gallery-discover-body">
                  <span className="gallery-discover-name">{set.name}</span>
                  <span className="gallery-discover-creator">by {set.creatorUsername}</span>
                  <span className="gallery-discover-stats">
                    <span>{set.imageCount} images</span>
                    <span>{set.subscriberCount} subscribers</span>
                  </span>
                  {set.description && (
                    <span className="gallery-discover-desc">{set.description}</span>
                  )}
                  <button
                    className={`gallery-discover-sub-btn ${set.subscribed ? "subscribed" : ""}`}
                    onClick={() => handleToggleSubscribe(set)}
                  >
                    {set.subscribed ? "Unsubscribe" : "Subscribe"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Publish a Set ── */}
      <div className="settings-card">
        <h3 className="settings-card-title">Publish a Set</h3>
        <p className="settings-card-desc">Upload images and share them as a gallery set for others.</p>

        <div className="gallery-publish-form">
          <input
            className="gallery-tab-input"
            type="text"
            placeholder="Set name"
            value={publishName}
            onChange={(e) => setPublishName(e.target.value)}
          />
          <input
            className="gallery-tab-input"
            type="text"
            placeholder="Description (optional)"
            value={publishDesc}
            onChange={(e) => setPublishDesc(e.target.value)}
          />
        </div>

        <span className="gallery-tab-section-label" style={{ margin: "14px 0 8px" }}>
          Images ({publishImages.length})
        </span>

        <div className="gallery-publish-images">
          {publishImages.map((img) => (
            <div key={img.id} className="gallery-publish-thumb" style={{ backgroundImage: `url(${img.url})` }}>
              <button
                className="gallery-image-thumb-delete"
                onClick={() => removePublishImage(img.id)}
                title="Remove"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <label
            className={`gallery-publish-add ${uploading ? "disabled" : ""}`}
            title="Add images"
          >
            {uploading ? (
              <div className="gallery-publish-spinner" />
            ) : (
              <Plus size={20} />
            )}
            <input
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={handlePublishUpload}
              disabled={uploading}
            />
          </label>
        </div>

        {publishError && (
          <div className="gallery-publish-error">{publishError}</div>
        )}

        <button
          className="gallery-publish-btn"
          onClick={handlePublish}
          disabled={publishing || publishImages.length === 0 || !publishName.trim()}
        >
          <ImagePlus size={14} />
          {publishing ? "Publishing..." : "Publish Set"}
        </button>
      </div>

      {/* ── My Published Sets ── */}
      {!myLoading && mySets.length > 0 && (
        <div className="settings-card">
          <h3 className="settings-card-title">My Published Sets</h3>
          <div className="gallery-my-sets-list">
            {mySets.map((set) => (
              <div key={set.id} className="gallery-my-set-item">
                <div
                  className={`gallery-my-set-row ${editingSetId === set.id ? "expanded" : ""}`}
                  onClick={() => handleExpandSet(set.id)}
                >
                  <div className="gallery-my-set-cover" style={coverStyle(set)} />
                  <div className="gallery-my-set-info">
                    <span className="gallery-discover-name">{set.name}</span>
                    <span className="gallery-discover-stats">
                      <span>{set.imageCount} images</span>
                      <span>{set.subscriberCount} subscribers</span>
                    </span>
                  </div>
                  <ChevronDown size={14} className={`gallery-my-set-chevron ${editingSetId === set.id ? "open" : ""}`} />
                  <button
                    className="gallery-my-set-delete"
                    onClick={(e) => { e.stopPropagation(); handleDeleteMySet(set.id); }}
                    title="Delete set"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {editingSetId === set.id && (
                  <div className="gallery-edit-panel">
                    {!editDetail ? (
                      <div className="gallery-browser-empty">Loading...</div>
                    ) : (
                      <>
                        <div className="gallery-edit-fields">
                          <input
                            className="gallery-tab-input"
                            type="text"
                            placeholder="Set name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <input
                            className="gallery-tab-input"
                            type="text"
                            placeholder="Description"
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                          />
                          <button
                            className="gallery-edit-save-btn"
                            onClick={handleSaveEdit}
                            disabled={editSaving}
                          >
                            <Check size={12} />
                            {editSaving ? "Saving..." : "Save"}
                          </button>
                        </div>

                        <span className="gallery-tab-section-label" style={{ margin: "12px 0 8px" }}>
                          Images ({editDetail.images.length})
                        </span>
                        <div className="gallery-publish-images">
                          {editDetail.images.map((img) => (
                            <div
                              key={img.id}
                              className="gallery-publish-thumb"
                              style={{ backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})` }}
                            >
                              <button
                                className="gallery-image-thumb-delete"
                                onClick={() => handleEditRemoveImage(img)}
                                title="Remove image"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          ))}
                          <label
                            className={`gallery-publish-add ${editAddingImages ? "disabled" : ""}`}
                            title="Add images"
                          >
                            {editAddingImages ? (
                              <div className="gallery-publish-spinner" />
                            ) : (
                              <Plus size={20} />
                            )}
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              style={{ display: "none" }}
                              onChange={handleEditAddImages}
                              disabled={editAddingImages}
                            />
                          </label>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/mp4,video/webm"
        style={{ display: "none" }}
        onChange={handleUpload}
      />
      {/* Crop / Position Modal */}
      {cropImage && (
        <GalleryCropModal
          imageUrl={cropImage.url}
          imageId={cropImage.id}
          onConfirm={(fx, fy) => {
            setFocusPoint(cropImage.id, { x: fx, y: fy });
            setCropImage(null);
          }}
          onCancel={() => setCropImage(null)}
        />
      )}
    </>
  );
}
