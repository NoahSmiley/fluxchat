import { useState, useEffect, useRef, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Minus, Square, Copy, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useAuthStore } from "./stores/auth.js";
import { useUIStore } from "./stores/ui.js";
import { useUpdater } from "./hooks/useUpdater.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { MainLayout } from "./layouts/MainLayout.js";
import { SpotifyCallback } from "./pages/SpotifyCallback.js";
import { prefetchEmojiFavorites } from "./lib/emojiCache.js";

const isMac = navigator.platform.toUpperCase().includes("MAC");

function MacWindowControls() {
  const [hovered, setHovered] = useState(false);

  async function handleClose() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {}
  }

  async function handleMinimize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {}
  }

  async function handleMaximize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch {}
  }

  return (
    <div
      className="mac-window-controls"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button className="mac-dot mac-close" onClick={handleClose} title="Close">
        {hovered && (
          <svg width="6" height="6" viewBox="0 0 6 6">
            <path d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5" stroke="rgba(0,0,0,0.65)" strokeWidth="1.2" />
          </svg>
        )}
      </button>
      <button className="mac-dot mac-minimize" onClick={handleMinimize} title="Minimize">
        {hovered && (
          <svg width="6" height="2" viewBox="0 0 6 2">
            <path d="M0.5 1H5.5" stroke="rgba(0,0,0,0.65)" strokeWidth="1.2" />
          </svg>
        )}
      </button>
      <button className="mac-dot mac-maximize" onClick={handleMaximize} title="Maximize">
        {hovered && (
          <svg width="6" height="6" viewBox="0 0 6 6">
            <path d="M0.5 2L3 0.5L5.5 2V5.5H0.5V2Z" fill="rgba(0,0,0,0.65)" />
          </svg>
        )}
      </button>
    </div>
  );
}

function WindowsWindowControls() {
  const [maximized, setMaximized] = useState(false);

  const checkMaximized = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      setMaximized(await getCurrentWindow().isMaximized());
    } catch {}
  }, []);

  useEffect(() => {
    checkMaximized();
    window.addEventListener("resize", checkMaximized);
    return () => window.removeEventListener("resize", checkMaximized);
  }, [checkMaximized]);

  async function handleMinimize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch {}
  }

  async function handleMaximize() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
      setMaximized(await getCurrentWindow().isMaximized());
    } catch {}
  }

  async function handleClose() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {}
  }

  return (
    <div className="window-controls">
      <button className="window-control-btn" onClick={handleMinimize} title="Minimize">
        <Minus size={12} />
      </button>
      <button className="window-control-btn" onClick={handleMaximize} title={maximized ? "Restore" : "Maximize"}>
        {maximized ? <Copy size={10} /> : <Square size={10} />}
      </button>
      <button className="window-control-btn window-control-close" onClick={handleClose} title="Close">
        <X size={12} />
      </button>
    </div>
  );
}

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.5;

function ZoomControls() {
  const [zoom, setZoomState] = useState(() => {
    const stored = localStorage.getItem("app-zoom");
    return stored ? parseFloat(stored) : 1;
  });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  async function applyZoom(factor: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(factor * 100) / 100));
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      await getCurrentWebviewWindow().setZoom(clamped);
      setZoomState(clamped);
      localStorage.setItem("app-zoom", String(clamped));
    } catch {}
  }

  // Apply stored zoom on mount
  useEffect(() => {
    import("@tauri-apps/api/webviewWindow").then(({ getCurrentWebviewWindow }) => {
      getCurrentWebviewWindow().setZoom(zoomRef.current).catch(() => {});
    }).catch(() => {});
  }, []);

  // Intercept Ctrl+scroll and Ctrl+/-/0 to keep state in sync with native shortcuts
  useEffect(() => {
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom(zoomRef.current + (e.deltaY < 0 ? 0.1 : -0.1));
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        applyZoom(zoomRef.current + 0.1);
      } else if (e.key === "-") {
        e.preventDefault();
        applyZoom(zoomRef.current - 0.1);
      } else if (e.key === "0") {
        e.preventDefault();
        applyZoom(1);
      }
    }
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="zoom-controls">
      <button className="window-control-btn zoom-btn" onClick={() => applyZoom(zoom - 0.1)} title="Zoom Out" disabled={zoom <= MIN_ZOOM}>
        <ZoomOut size={12} />
      </button>
      <button className="window-control-btn zoom-btn" onClick={() => applyZoom(1)} title={`Reset Zoom (${Math.round(zoom * 100)}%)`}>
        <RotateCcw size={10} />
      </button>
      <button className="window-control-btn zoom-btn" onClick={() => applyZoom(zoom + 0.1)} title="Zoom In" disabled={zoom >= MAX_ZOOM}>
        <ZoomIn size={12} />
      </button>
    </div>
  );
}

function UpdateToast() {
  const betaUpdates = useUIStore((s) => s.betaUpdates);
  const { status, version, progress, checkForUpdate, downloadAndInstall, relaunch } = useUpdater(betaUpdates);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  if (dismissed || status === "idle" || status === "checking" || status === "up-to-date") {
    return null;
  }

  return (
    <div className="update-toast">
      <div className="update-toast-info">
        <span className="update-toast-title">
          {status === "available" && `Update v${version} available`}
          {status === "downloading" && `Downloading update... ${progress}%`}
          {status === "ready" && "Update ready"}
          {status === "error" && "Update failed"}
        </span>
        <span className="update-toast-desc">
          {status === "available" && "A new version of Flux is ready to install."}
          {status === "ready" && "Restart to apply the update."}
        </span>
      </div>
      <div className="update-toast-actions">
        {status === "available" && (
          <button className="update-toast-btn primary" onClick={downloadAndInstall}>
            Update
          </button>
        )}
        {status === "ready" && (
          <button className="update-toast-btn primary" onClick={relaunch}>
            Restart
          </button>
        )}
      </div>
      {(status === "available" || status === "error") && (
        <button className="update-toast-dismiss" onClick={() => setDismissed(true)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function App() {
  const { user, loading } = useAuthStore();
  const appBorderStyle = useUIStore((s) => s.appBorderStyle);

  // Suppress the browser/OS native context menu everywhere
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  useEffect(() => {
    if (user) prefetchEmojiFavorites();
  }, [user?.id]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className={`app-shell ${appBorderStyle !== "none" ? `app-border-${appBorderStyle}` : ""}`}>
      <div className={`titlebar ${isMac ? "titlebar-mac" : ""}`} data-tauri-drag-region>
        {isMac && <MacWindowControls />}
        <ZoomControls />
        {!isMac && <WindowsWindowControls />}
      </div>
      <div className="app-body">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
          <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />
          <Route path="/spotify-callback" element={<SpotifyCallback />} />
          <Route path="/*" element={user ? <MainLayout /> : <Navigate to="/login" />} />
        </Routes>
        <UpdateToast />
      </div>
    </div>
  );
}
