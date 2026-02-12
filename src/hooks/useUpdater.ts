import { useState, useCallback } from "react";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error" | "up-to-date";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
  progress: number;
}

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    version: null,
    error: null,
    progress: 0,
  });

  const checkForUpdate = useCallback(async () => {
    setState((s) => ({ ...s, status: "checking", error: null }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        setState((s) => ({
          ...s,
          status: "available",
          version: update.version,
        }));
        return update;
      } else {
        setState((s) => ({ ...s, status: "up-to-date" }));
        return null;
      }
    } catch (e: any) {
      setState((s) => ({
        ...s,
        status: "error",
        error: e?.message || String(e),
      }));
      return null;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    setState((s) => ({ ...s, status: "downloading", progress: 0 }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        setState((s) => ({ ...s, status: "up-to-date" }));
        return;
      }
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = (event.data as any).contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0;
          setState((s) => ({ ...s, progress: pct }));
        } else if (event.event === "Finished") {
          setState((s) => ({ ...s, status: "ready", progress: 100 }));
        }
      });
      setState((s) => ({ ...s, status: "ready", progress: 100 }));
    } catch (e: any) {
      setState((s) => ({
        ...s,
        status: "error",
        error: e?.message || String(e),
      }));
    }
  }, []);

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
