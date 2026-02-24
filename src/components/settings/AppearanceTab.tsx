import { useShallow } from "zustand/react/shallow";
import { useUIStore, type SidebarPosition, type AppBorderStyle } from "../../stores/ui.js";
import { ToggleSwitch } from "../SettingsModal.js";

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

export function AppearanceTab() {
  const { sidebarPosition, setSidebarPosition, appBorderStyle, setAppBorderStyle, highlightOwnMessages, setHighlightOwnMessages } = useUIStore(useShallow((s) => ({
    sidebarPosition: s.sidebarPosition, setSidebarPosition: s.setSidebarPosition,
    appBorderStyle: s.appBorderStyle, setAppBorderStyle: s.setAppBorderStyle,
    highlightOwnMessages: s.highlightOwnMessages, setHighlightOwnMessages: s.setHighlightOwnMessages,
  })));

  return (
    <>
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
