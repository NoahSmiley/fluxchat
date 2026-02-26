import { useRef, useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Upload, X, Compass } from "lucide-react";
import { useUIStore, type SidebarPosition, type AppBorderStyle } from "@/stores/ui.js";
import { useGalleryStore, type GalleryImage, type GalleryMediaType, type GalleryMode, type RotationMode } from "@/stores/gallery.js";
import { ToggleSwitch } from "@/components/SettingsModal.js";
import { PRESET_THEMES, LIMINAL_THEME, THEME_COLOR_LABELS, type CustomTheme, type ThemeColors, type ActiveTheme } from "@/lib/themes.js";
import { ART_SETS } from "@/lib/galleryPresets.js";
import { getFileUrl, uploadFile } from "@/lib/api/messages.js";
import { GalleryPublishModal } from "./GalleryPublishModal.js";

const SIDEBAR_POSITIONS: { value: SidebarPosition; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "top", label: "Top" },
  { value: "right", label: "Right" },
  { value: "bottom", label: "Bottom" },
];

const APP_BORDER_STYLES: { value: AppBorderStyle; label: string }[] = [
  { value: "none", label: "None" },
  { value: "chroma", label: "Chroma" },
  { value: "pulse", label: "Pulse" },
  { value: "wave", label: "Wave" },
  { value: "ember", label: "Ember" },
  { value: "frost", label: "Frost" },
  { value: "neon", label: "Neon" },
  { value: "galaxy", label: "Galaxy" },
];

// Keys to show in the custom theme editor (skip rgba modifier values)
const EDITABLE_COLOR_KEYS = Object.keys(THEME_COLOR_LABELS).filter(
  (k) => k !== "--bg-modifier-hover" && k !== "--bg-modifier-active",
) as (keyof ThemeColors)[];

const RADIUS_KEYS: (keyof ThemeColors)[] = ["--radius", "--radius-lg"];
const COLOR_KEYS = EDITABLE_COLOR_KEYS.filter((k) => !RADIUS_KEYS.includes(k));

function isThemeActive(active: ActiveTheme, type: string, id: string): boolean {
  return active.type === type && active.id === id;
}

function ThemePicker() {
  const { activeTheme, setActiveTheme, customThemes, addCustomTheme } = useUIStore(
    useShallow((s) => ({
      activeTheme: s.activeTheme,
      setActiveTheme: s.setActiveTheme,
      customThemes: s.customThemes,
      addCustomTheme: s.addCustomTheme,
    })),
  );

  const handleCreate = () => {
    const id = `custom-${Date.now()}`;
    const theme: CustomTheme = {
      type: "custom",
      id,
      name: "Custom",
      colors: { ...LIMINAL_THEME.colors },
    };
    addCustomTheme(theme);
    setActiveTheme({ type: "custom", id });
  };

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">Theme</h3>
      <p className="settings-card-desc">Choose a visual theme or create your own.</p>
      <div className="ring-style-picker">
        {PRESET_THEMES.map((t) => (
          <button
            key={t.id}
            className={`ring-style-option ${isThemeActive(activeTheme, "preset", t.id) ? "active" : ""}`}
            onClick={() => setActiveTheme({ type: "preset", id: t.id })}
          >
            <div
              className="theme-swatch"
              style={{ background: t.colors["--bg-primary"] }}
            >
              <div
                className="theme-swatch-accent"
                style={{ background: t.colors["--accent"] }}
              />
            </div>
            <span className="ring-style-label">{t.name}</span>
          </button>
        ))}
        {customThemes.map((t) => (
          <button
            key={t.id}
            className={`ring-style-option ${isThemeActive(activeTheme, "custom", t.id) ? "active" : ""}`}
            onClick={() => setActiveTheme({ type: "custom", id: t.id })}
          >
            <div
              className="theme-swatch"
              style={{ background: t.colors["--bg-primary"] }}
            >
              <div
                className="theme-swatch-accent"
                style={{ background: t.colors["--accent"] }}
              />
            </div>
            <span className="ring-style-label">{t.name}</span>
          </button>
        ))}
        <button className="ring-style-option" onClick={handleCreate}>
          <div className="theme-swatch theme-swatch-add">+</div>
          <span className="ring-style-label">Create</span>
        </button>
      </div>
      {activeTheme.type === "custom" && <CustomThemeEditor themeId={activeTheme.id} />}
    </div>
  );
}

function CustomThemeEditor({ themeId }: { themeId: string }) {
  const { customThemes, updateCustomTheme, deleteCustomTheme } = useUIStore(
    useShallow((s) => ({
      customThemes: s.customThemes,
      updateCustomTheme: s.updateCustomTheme,
      deleteCustomTheme: s.deleteCustomTheme,
    })),
  );

  const theme = customThemes.find((t) => t.id === themeId);
  if (!theme) return null;

  const setColor = (key: keyof ThemeColors, value: string) => {
    updateCustomTheme(themeId, { colors: { ...theme.colors, [key]: value } });
  };

  return (
    <div className="custom-theme-editor">
      <div className="custom-theme-name-row">
        <input
          type="text"
          className="custom-theme-name-input"
          value={theme.name}
          onChange={(e) => updateCustomTheme(themeId, { name: e.target.value })}
          placeholder="Theme name"
        />
      </div>
      <div className="custom-theme-colors-grid">
        {COLOR_KEYS.map((key) => (
          <label key={key} className="custom-theme-color-row">
            <span className="custom-theme-color-label">
              {THEME_COLOR_LABELS[key]}
            </span>
            <input
              type="color"
              className="custom-theme-color-input"
              value={theme.colors[key]}
              onChange={(e) => setColor(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="custom-theme-radius-row">
        {RADIUS_KEYS.map((key) => (
          <label key={key} className="custom-theme-color-row">
            <span className="custom-theme-color-label">
              {THEME_COLOR_LABELS[key]}
            </span>
            <input
              type="text"
              className="custom-theme-radius-input"
              value={theme.colors[key]}
              onChange={(e) => setColor(key, e.target.value)}
              placeholder="12px"
            />
          </label>
        ))}
      </div>
      <button
        className="custom-theme-delete"
        onClick={() => deleteCustomTheme(themeId)}
      >
        Delete Theme
      </button>
    </div>
  );
}

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

function GallerySettings() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showPublish, setShowPublish] = useState(false);
  const openSettingsTab = useUIStore((s) => s.openSettingsTab);
  const {
    mode, singleImage, activeSetId, rotationMode, userImages, subscribedSets,
    setMode, setSingleImage, addUserImage, removeUserImage, setActiveSet, setRotationMode,
    loadSubscribedSets, subscribedSetsLoaded,
  } = useGalleryStore(
    useShallow((s) => ({
      mode: s.mode,
      singleImage: s.singleImage,
      activeSetId: s.activeSetId,
      rotationMode: s.rotationMode,
      userImages: s.userImages,
      subscribedSets: s.subscribedSets,
      subscribedSetsLoaded: s.subscribedSetsLoaded,
      setMode: s.setMode,
      setSingleImage: s.setSingleImage,
      addUserImage: s.addUserImage,
      removeUserImage: s.removeUserImage,
      setActiveSet: s.setActiveSet,
      setRotationMode: s.setRotationMode,
      loadSubscribedSets: s.loadSubscribedSets,
    })),
  );

  useEffect(() => {
    if (!subscribedSetsLoaded) loadSubscribedSets();
  }, [subscribedSetsLoaded, loadSubscribedSets]);

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
      if (mode === "single" || mode === "off") {
        setSingleImage(img);
      }
    } catch {
      // Fallback to dataUrl
      const reader = new FileReader();
      reader.onload = () => {
        const img: GalleryImage = {
          id: `user-${Date.now()}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          dataUrl: reader.result as string,
          mediaType,
        };
        addUserImage(img);
        if (mode === "single" || mode === "off") {
          setSingleImage(img);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const currentImage = mode === "single" ? singleImage : null;

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">Gallery</h3>
      <p className="settings-card-desc">Display artwork in the channel sidebar header.</p>

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

      {/* Single image mode */}
      {mode === "single" && (
        <>
          <div className="gallery-settings-preview" style={currentImage ? galleryBg(currentImage) : {}}>
            {!currentImage && <div className="gallery-settings-preview-empty">No image selected</div>}
          </div>
          <div className="gallery-settings-actions">
            <button className="gallery-settings-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
              Upload
            </button>
            {currentImage && (
              <button
                className="gallery-settings-btn gallery-settings-btn-danger"
                onClick={() => setSingleImage(null)}
              >
                Remove
              </button>
            )}
          </div>
        </>
      )}

      {/* Art set mode */}
      {mode === "set" && (
        <>
          {subscribedSets.length > 0 && (
            <>
              <span className="gallery-popover-section-label" style={{ display: "block", marginBottom: 6 }}>Subscribed Sets</span>
              <div className="gallery-set-browser" style={{ marginBottom: 12 }}>
                {subscribedSets.map((subSet) => (
                  <button
                    key={subSet.id}
                    className={`gallery-set-browser-row ${activeSetId === subSet.id ? "active" : ""}`}
                    onClick={() => setActiveSet(subSet.id)}
                  >
                    <div className="gallery-set-browser-strip">
                      {subSet.images.slice(0, 4).map((img) => (
                        <div
                          key={img.id}
                          className="gallery-set-browser-swatch"
                          style={{ backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})`, backgroundSize: "cover", backgroundPosition: "center" }}
                        />
                      ))}
                    </div>
                    <div className="gallery-set-browser-info">
                      <span className="gallery-set-browser-name">{subSet.name}</span>
                      <span className="gallery-set-browser-count">{subSet.imageCount} images · by {subSet.creatorUsername}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          <span className="gallery-popover-section-label" style={{ display: "block", marginBottom: 6 }}>Built-in Sets</span>
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
              <span className="gallery-popover-section-label" style={{ marginTop: 12, display: "block" }}>Rotation</span>
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
        </>
      )}

      {/* User image library */}
      {userImages.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span className="gallery-popover-section-label" style={{ display: "block", marginBottom: 8 }}>Your Images</span>
          <div className="gallery-image-grid">
            {userImages.map((img) => (
              <div
                key={img.id}
                className={`gallery-image-thumb ${mode === "single" && singleImage?.id === img.id ? "active" : ""}`}
                style={galleryBg(img)}
                onClick={() => { if (mode !== "set") setSingleImage(img); }}
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
        </div>
      )}

      {/* Browse + Publish + Upload buttons */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="gallery-settings-btn" onClick={() => openSettingsTab("gallery")}>
          <Compass size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          Browse Sets
        </button>
        {userImages.filter((i) => i.attachmentId).length > 0 && (
          <button className="gallery-settings-btn" onClick={() => setShowPublish(true)}>
            Publish as Set
          </button>
        )}
        {mode !== "off" && (
          <button className="gallery-settings-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
            Upload Image
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/mp4,video/webm"
        style={{ display: "none" }}
        onChange={handleUpload}
      />

      {showPublish && <GalleryPublishModal onClose={() => setShowPublish(false)} />}
    </div>
  );
}

export function AppearanceTab() {
  const { sidebarPosition, setSidebarPosition, appBorderStyle, setAppBorderStyle, highlightOwnMessages, setHighlightOwnMessages } = useUIStore(useShallow((s) => ({
    sidebarPosition: s.sidebarPosition, setSidebarPosition: s.setSidebarPosition,
    appBorderStyle: s.appBorderStyle, setAppBorderStyle: s.setAppBorderStyle,
    highlightOwnMessages: s.highlightOwnMessages, setHighlightOwnMessages: s.setHighlightOwnMessages,
  })));

  return (
    <>
      <ThemePicker />

      <GallerySettings />

      <div className="settings-card">
        <h3 className="settings-card-title">Sidebar Position</h3>
        <p className="settings-card-desc">Move the avatar sidebar to any edge of the window.</p>
        <div className="ring-style-picker">
          {SIDEBAR_POSITIONS.map((sp) => (
            <button
              key={sp.value}
              className={`ring-style-option ${sidebarPosition === sp.value ? "active" : ""}`}
              onClick={() => setSidebarPosition(sp.value)}
            >
              <div className={`sidebar-pos-swatch sidebar-pos-${sp.value}`}>
                <div className="sidebar-pos-bar" />
              </div>
              <span className="ring-style-label">{sp.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Messages</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Highlight your messages</span>
            <span className="settings-row-desc">Show a subtle background on messages you sent.</span>
          </div>
          <ToggleSwitch checked={highlightOwnMessages} onChange={setHighlightOwnMessages} />
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">App Border</h3>
        <p className="settings-card-desc">Add an animated ring border around the app window.</p>
        <div className="ring-style-picker">
          {APP_BORDER_STYLES.map((bs) => (
            <button
              key={bs.value}
              className={`ring-style-option ${appBorderStyle === bs.value ? "active" : ""}`}
              onClick={() => setAppBorderStyle(bs.value)}
            >
              <div className={`app-border-swatch ${bs.value !== "none" ? `app-border-swatch-${bs.value}` : ""}`} />
              <span className="ring-style-label">{bs.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
