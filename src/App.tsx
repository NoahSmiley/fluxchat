import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Minus, Square, Copy, X } from "lucide-react";
import { useAuthStore } from "./stores/auth.js";
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

  return (
    <div className="window-controls">
      <button className="window-control-btn" onClick={handleMinimize} title="Minimize">
        <Minus size={16} />
      </button>
      <button className="window-control-btn" onClick={handleMaximize} title={maximized ? "Restore" : "Maximize"}>
        {maximized ? <Copy size={14} /> : <Square size={14} />}
      </button>
      <button className="window-control-btn window-control-close" onClick={handleClose} title="Close">
        <X size={16} />
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

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="titlebar">
        <WindowControls />
      </div>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />
        <Route path="/spotify-callback" element={<SpotifyCallback />} />
        <Route path="/*" element={user ? <MainLayout /> : <Navigate to="/login" />} />
      </Routes>
      <UpdateToast />
    </>
  );
}
