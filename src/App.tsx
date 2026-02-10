import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Minus, Square, Copy, X } from "lucide-react";
import { useAuthStore } from "./stores/auth.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";
import { MainLayout } from "./layouts/MainLayout.js";

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
        <Route path="/*" element={user ? <MainLayout /> : <Navigate to="/login" />} />
      </Routes>
    </>
  );
}
