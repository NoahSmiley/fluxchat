import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Minus, Square, Copy, X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { useAuthStore } from "./stores/auth.js";
import { useUIStore } from "./stores/ui.js";
import { useUpdater } from "./hooks/useUpdater.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { MainLayout } from "./layouts/MainLayout.js";
import { SpotifyCallback } from "./pages/SpotifyCallback.js";

function WindowControls() {
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

  const [zoom, setZoomState] = useState(1);

  async function applyZoom(factor: number) {
    try {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      await getCurrentWebviewWindow().setZoom(factor);
      setZoomState(factor);
    } catch {}
  }

  function handleZoomOut() {
    applyZoom(Math.max(0.5, Math.round((zoom - 0.1) * 100) / 100));
  }

  function handleZoomReset() {
    applyZoom(1);
  }

  function handleZoomIn() {
    applyZoom(Math.min(2, Math.round((zoom + 0.1) * 100) / 100));
  }

  return (
    <div className="window-controls">
      <div className="zoom-controls">
        <button className="window-control-btn zoom-btn" onClick={handleZoomOut} title="Zoom Out">
          <ZoomOut size={12} />
        </button>
        <button className="window-control-btn zoom-btn" onClick={handleZoomReset} title={`Reset Zoom (${Math.round(zoom * 100)}%)`}>
          <RotateCcw size={10} />
        </button>
        <button className="window-control-btn zoom-btn" onClick={handleZoomIn} title="Zoom In">
          <ZoomIn size={12} />
        </button>
      </div>
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

function UpdateToast() {
  const { status, version, progress, checkForUpdate, downloadAndInstall, relaunch } = useUpdater();
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

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className={`app-shell ${appBorderStyle !== "none" ? `app-border-${appBorderStyle}` : ""}`}>
      <div className="titlebar">
        <WindowControls />
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
