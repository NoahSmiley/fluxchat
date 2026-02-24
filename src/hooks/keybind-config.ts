import { useKeybindsStore } from "@/stores/keybinds.js";

// ── Environment Detection ────────────────────────────────────────────────────

export const isTauri = !!(window as any).__TAURI_INTERNALS__;

// ── Input Detection ──────────────────────────────────────────────────────────

export function isTextInput(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

// ── Key Label Formatting ─────────────────────────────────────────────────────

export function formatKeyLabel(e: KeyboardEvent): string {
  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  if (e.code === "Space") return "Space";
  return e.code;
}

// ── Mouse Button Config ──────────────────────────────────────────────────────

export const MOUSE_LABELS: Record<number, string> = {
  0: "Mouse 1",
  1: "Mouse 3", // middle click is conventionally "mouse 3"
  2: "Mouse 2", // right click is conventionally "mouse 2"
  3: "Mouse 4",
  4: "Mouse 5",
};

export function mouseCode(button: number): string {
  return `Mouse${button}`;
}

export function mouseLabel(button: number): string {
  return MOUSE_LABELS[button] ?? `Mouse ${button + 1}`;
}

// ── Hold-Keybind Lookup ──────────────────────────────────────────────────────

/** Find the PTT or PTM keybind that has a key assigned. */
export function getHoldKeybind() {
  const { keybinds } = useKeybindsStore.getState();
  return keybinds.find(
    (kb) =>
      (kb.action === "push-to-talk" || kb.action === "push-to-mute") &&
      kb.key !== null
  );
}

// ── Global Key Hook Management (Tauri / Windows) ─────────────────────────────

let globalHookActive = false;

export function isGlobalHookActive(): boolean {
  return globalHookActive;
}

export async function startGlobalHook(keyCode: string) {
  if (!isTauri) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("start_global_key_listen", { keyCode });
    globalHookActive = true;
  } catch {
    globalHookActive = false;
  }
}

export async function stopGlobalHook() {
  if (!isTauri || !globalHookActive) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("stop_global_key_listen");
  } catch {
    // ignore
  }
  globalHookActive = false;
}
