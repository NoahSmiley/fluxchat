import { useState, useCallback, useEffect, useRef } from "react";

const STABLE_ENDPOINT = "https://github.com/NoahSmiley/fluxchat/releases/latest/download/latest.json";
const BETA_ENDPOINT = "https://github.com/NoahSmiley/fluxchat/releases/download/latest-beta/latest.json";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "up-to-date";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  body: string | null;
  error: string | null;
  progress: number;
}

export function useUpdater(beta = false) {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    version: null,
    body: null,
    error: null,
    progress: 0,
  });

  const endpoint = beta ? BETA_ENDPOINT : STABLE_ENDPOINT;
  const unlistenRef = useRef<(() => void) | null>(null);

  // Clean up event listener on unmount
  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const checkForUpdate = useCallback(async () => {
    setState((s) => ({ ...s, status: "checking", error: null }));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ version: string; body?: string } | null>(
        "check_for_update",
        { endpoint }
      );
      if (result) {
        setState((s) => ({
          ...s,
          status: "available",
          version: result.version,
          body: result.body ?? null,
        }));
      } else {
        setState((s) => ({ ...s, status: "up-to-date" }));
      }
    } catch (e: any) {
      setState((s) => ({
        ...s,
        status: "error",
        error: e?.message || String(e),
      }));
    }
  }, [endpoint]);

  const downloadAndInstall = useCallback(async () => {
    setState((s) => ({ ...s, status: "downloading", progress: 0 }));
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      // Listen for progress events from Rust
      unlistenRef.current?.();
      const unlisten = await listen<{ downloaded: number; total: number | null }>(
        "update-progress",
        (event) => {
          const { downloaded, total } = event.payload;
          const pct = total && total > 0 ? Math.round((downloaded / total) * 100) : 0;
          setState((s) => ({ ...s, progress: pct }));
        }
      );
      unlistenRef.current = unlisten;

      await invoke("download_and_install_update", { endpoint });

      unlistenRef.current?.();
      unlistenRef.current = null;
      setState((s) => ({ ...s, status: "ready", progress: 100 }));
    } catch (e: any) {
      unlistenRef.current?.();
      unlistenRef.current = null;
      setState((s) => ({
        ...s,
        status: "error",
        error: e?.message || String(e),
      }));
    }
  }, [endpoint]);

  const relaunch = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      // If plugin-process isn't available, just tell user to restart
      setState((s) => ({ ...s, error: "Please restart the app manually." }));
    }
  }, []);

  return {
    ...state,
    checkForUpdate,
    downloadAndInstall,
    relaunch,
  };
}
