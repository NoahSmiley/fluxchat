import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useUIStore, type SidebarPosition, type AppBorderStyle } from "@/stores/ui.js";
import { ToggleSwitch } from "@/components/SettingsModal.js";
import { PRESET_THEMES, LIMINAL_THEME, THEME_COLOR_LABELS, type CustomTheme, type ThemeColors, type ActiveTheme } from "@/lib/themes.js";

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

export function AppearanceTab() {
  const { sidebarPosition, setSidebarPosition, appBorderStyle, setAppBorderStyle, highlightOwnMessages, setHighlightOwnMessages } = useUIStore(useShallow((s) => ({
    sidebarPosition: s.sidebarPosition, setSidebarPosition: s.setSidebarPosition,
    appBorderStyle: s.appBorderStyle, setAppBorderStyle: s.setAppBorderStyle,
    highlightOwnMessages: s.highlightOwnMessages, setHighlightOwnMessages: s.setHighlightOwnMessages,
  })));

  return (
    <>
      <ThemePicker />

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
