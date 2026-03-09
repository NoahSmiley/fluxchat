/**
 * Patch @livekit/krisp-noise-filter to:
 *
 * 1. Remove the Safari/WKWebView version gate (isSupported).
 *    Tauri's WKWebView doesn't report its Safari version correctly
 *    despite being fully capable (AudioWorklet, SharedArrayBuffer, etc.).
 *
 * Runs as a postinstall script so patches survive npm install.
 */
import { readFileSync, writeFileSync } from "fs";

const file = "node_modules/@livekit/krisp-noise-filter/dist/index.js";

try {
  let code = readFileSync(file, "utf8");
  let patched = false;

  // ── Patch 1: isSupported() Safari gate ──
  const reSupported =
    /static isSupported\(\)\s*\{\s*if\s*\(\(0,\s*o\.isSafari\)\(\)\)[\s\S]*?else\s*return\s*!0;\s*\}/;

  if (reSupported.test(code)) {
    code = code.replace(reSupported, "static isSupported(){return!0}");
    console.log("[patch-krisp] Patched isSupported() Safari gate");
    patched = true;
  } else {
    console.log("[patch-krisp] isSupported() already patched or pattern changed — skipping");
  }

  if (patched) {
    writeFileSync(file, code);
    console.log("[patch-krisp] Done — wrote patched file");
  }
} catch (e) {
  // Not installed yet or file missing — that's fine
  if (e.code !== "ENOENT") console.warn("[patch-krisp]", e.message);
}
