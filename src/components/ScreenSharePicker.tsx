import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Monitor, AppWindow, Loader2 } from "lucide-react";

interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
  source_type: "screen" | "window";
}

interface ScreenSharePickerProps {
  onSelect: (sourceType: "screen" | "window") => void;
  onCancel: () => void;
}

export function ScreenSharePicker({ onSelect, onCancel }: ScreenSharePickerProps) {
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"screen" | "window">("screen");
  const [selected, setSelected] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);

  useEffect(() => {
    invoke<CaptureSource[]>("get_capture_sources")
      .then((result) => {
        setSources(result);
        // Auto-select first screen
        const firstScreen = result.find((s) => s.source_type === "screen");
        if (firstScreen) setSelected(firstScreen.id);
      })
      .catch((err) => console.error("Failed to get capture sources:", err))
      .finally(() => setLoading(false));
  }, []);

  const screens = sources.filter((s) => s.source_type === "screen");
  const windows = sources.filter((s) => s.source_type === "window");
  const visibleSources = tab === "screen" ? screens : windows;

  function handleShare() {
    if (!selected) return;
    const source = sources.find((s) => s.id === selected);
    if (source) {
      onSelect(source.source_type);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="screenshare-picker" onClick={(e) => e.stopPropagation()}>
        <div className="screenshare-picker-header">
          <h3>Share Your Screen</h3>
        </div>

        <div className="screenshare-picker-tabs">
          <button
            className={`screenshare-tab ${tab === "screen" ? "active" : ""}`}
            onClick={() => {
              setTab("screen");
              setSelected(screens[0]?.id ?? null);
            }}
          >
            <Monitor size={16} />
            Screens
          </button>
          <button
            className={`screenshare-tab ${tab === "window" ? "active" : ""}`}
            onClick={() => {
              setTab("window");
              setSelected(windows[0]?.id ?? null);
            }}
          >
            <AppWindow size={16} />
            Windows
          </button>
        </div>

        <div className="screenshare-picker-grid">
          {loading && (
            <div className="screenshare-picker-loading">
              <Loader2 size={24} className="spinner" />
              <span>Finding sources...</span>
            </div>
          )}

          {!loading && visibleSources.length === 0 && (
            <div className="screenshare-picker-empty">
              No {tab === "screen" ? "screens" : "windows"} found
            </div>
          )}

          {!loading &&
            visibleSources.map((source) => (
              <button
                key={source.id}
                className={`screenshare-source ${selected === source.id ? "selected" : ""}`}
                onClick={() => setSelected(source.id)}
                onDoubleClick={() => {
                  setSelected(source.id);
                  handleShare();
                }}
              >
                <div className="screenshare-source-thumb">
                  {source.thumbnail ? (
                    <img src={source.thumbnail} alt={source.name} draggable={false} />
                  ) : (
                    <div className="screenshare-source-placeholder">
                      {tab === "screen" ? <Monitor size={32} /> : <AppWindow size={32} />}
                    </div>
                  )}
                </div>
                <span className="screenshare-source-name" title={source.name}>
                  {source.name}
                </span>
              </button>
            ))}
        </div>

        <div className="screenshare-picker-footer">
          <label className="screenshare-audio-toggle">
            <input
              type="checkbox"
              checked={audioEnabled}
              onChange={(e) => setAudioEnabled(e.target.checked)}
            />
            Share audio
          </label>
          <div className="screenshare-picker-actions">
            <button className="btn-small" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn-small btn-primary"
              onClick={handleShare}
              disabled={!selected}
            >
              Share
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
