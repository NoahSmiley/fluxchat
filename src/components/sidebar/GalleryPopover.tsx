import { useRef } from "react";
import { Upload, Settings, X, ImageOff, Compass } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useGalleryStore, type GalleryImage, type GalleryMediaType, type RotationMode } from "@/stores/gallery.js";
import { useUIStore } from "@/stores/ui.js";
import { ART_SETS } from "@/lib/galleryPresets.js";
import { getFileUrl } from "@/lib/api/messages.js";
import { uploadFile } from "@/lib/api/messages.js";

const ROTATION_OPTIONS: { value: RotationMode; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "daily", label: "Daily" },
  { value: "hourly", label: "Hourly" },
  { value: "random", label: "Random" },
];

const GALLERY_ACCEPT = "image/*,video/mp4,video/webm";

function detectMediaType(file: File): GalleryMediaType {
  return file.type.startsWith("video/") ? "video" : "image";
}

function galleryBg(img: GalleryImage): React.CSSProperties {
  if (img.css) return { background: img.css };
  if (img.attachmentId && img.filename) return { backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})`, backgroundSize: "cover", backgroundPosition: "center" };
  if (img.dataUrl && img.mediaType !== "video") return { backgroundImage: `url(${img.dataUrl})`, backgroundSize: "cover", backgroundPosition: "center" };
  return {};
}

export function GalleryPopover({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const {
    mode, singleImage, activeSetId, rotationMode, userImages,
    subscribedSets,
    setSingleImage, addUserImage, setActiveSet, setRotationMode, setMode,
  } = useGalleryStore(
    useShallow((s) => ({
      mode: s.mode,
      singleImage: s.singleImage,
      activeSetId: s.activeSetId,
      rotationMode: s.rotationMode,
      userImages: s.userImages,
      subscribedSets: s.subscribedSets,
      setSingleImage: s.setSingleImage,
      addUserImage: s.addUserImage,
      setActiveSet: s.setActiveSet,
      setRotationMode: s.setRotationMode,
      setMode: s.setMode,
    })),
  );

  const openSettings = useUIStore((s) => s.openSettings);
  const openSettingsTab = useUIStore((s) => s.openSettingsTab);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !(file.type.startsWith("image/") || file.type.startsWith("video/"))) return;
    const mediaType = detectMediaType(file);
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
      setSingleImage(img);
    } catch {
      // Fallback to dataUrl if upload fails
      const reader = new FileReader();
      reader.onload = () => {
        const img: GalleryImage = {
          id: `user-${Date.now()}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          dataUrl: reader.result as string,
          mediaType,
        };
        addUserImage(img);
        setSingleImage(img);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePickImage = (img: GalleryImage) => {
    setSingleImage(img);
  };

  const handlePickSet = (setId: string) => {
    setActiveSet(setId);
  };

  const handleTurnOff = () => {
    setMode("off");
    onClose();
  };

  const activeSet = ART_SETS.find((s) => s.id === activeSetId) ?? (subscribedSets.find((s) => s.id === activeSetId) ? { id: activeSetId!, name: "", images: [] } : undefined);

  return (
    <div className="gallery-popover" onClick={(e) => e.stopPropagation()}>
      <div className="gallery-popover-header">
        <span className="gallery-popover-title">Gallery</span>
        <button className="gallery-popover-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      {/* User Images */}
      {userImages.length > 0 && (
        <div className="gallery-popover-section">
          <span className="gallery-popover-section-label">Your Images</span>
          <div className="gallery-popover-thumbs">
            {userImages.map((img) => (
              <button
                key={img.id}
                className={`gallery-thumb ${mode === "single" && singleImage?.id === img.id ? "active" : ""}`}
                style={galleryBg(img)}
                onClick={() => handlePickImage(img)}
                title={img.name}
              >
                {img.mediaType === "video" && img.dataUrl && (
                  <video className="gallery-thumb-video" src={img.dataUrl} muted playsInline />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Subscribed Sets */}
      {subscribedSets.length > 0 && (
        <div className="gallery-popover-section">
          <span className="gallery-popover-section-label">Subscribed Sets</span>
          {subscribedSets.map((subSet) => (
            <button
              key={subSet.id}
              className={`gallery-set-row ${mode === "set" && activeSetId === subSet.id ? "active" : ""}`}
              onClick={() => handlePickSet(subSet.id)}
            >
              <div className="gallery-set-preview">
                {subSet.images.slice(0, 3).map((img) => (
                  <div
                    key={img.id}
                    className="gallery-set-swatch"
                    style={{ backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})`, backgroundSize: "cover", backgroundPosition: "center" }}
                  />
                ))}
              </div>
              <span className="gallery-set-name">{subSet.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Art Sets */}
      <div className="gallery-popover-section">
        <span className="gallery-popover-section-label">Art Sets</span>
        {ART_SETS.map((artSet) => (
          <button
            key={artSet.id}
            className={`gallery-set-row ${mode === "set" && activeSetId === artSet.id ? "active" : ""}`}
            onClick={() => handlePickSet(artSet.id)}
          >
            <div className="gallery-set-preview">
              {artSet.images.slice(0, 3).map((img) => (
                <div key={img.id} className="gallery-set-swatch" style={galleryBg(img)} />
              ))}
            </div>
            <span className="gallery-set-name">{artSet.name}</span>
          </button>
        ))}
      </div>

      {/* Rotation (only when set mode active) */}
      {mode === "set" && activeSet && (
        <div className="gallery-popover-section">
          <span className="gallery-popover-section-label">Rotation</span>
          <div className="gallery-rotation-row">
            {ROTATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`gallery-rotation-btn ${rotationMode === opt.value ? "active" : ""}`}
                onClick={() => setRotationMode(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="gallery-popover-actions">
        <button className="gallery-action-btn" onClick={() => fileRef.current?.click()}>
          <Upload size={13} />
          Upload
        </button>
        <button className="gallery-action-btn" onClick={() => { openSettingsTab("gallery"); onClose(); }}>
          <Compass size={13} />
          Browse
        </button>
        <button className="gallery-action-btn" onClick={() => { openSettings(); onClose(); }}>
          <Settings size={13} />
          Settings
        </button>
        {mode !== "off" && (
          <button className="gallery-action-btn gallery-action-off" onClick={handleTurnOff}>
            <ImageOff size={13} />
            Turn Off
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={GALLERY_ACCEPT}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </div>
  );
}
