/**
 * Patch @livekit/krisp-noise-filter to remove the Safari/WKWebView version gate.
 *
 * The Krisp SDK checks navigator.vendor for "Apple" and rejects Safari < 17.4,
 * but Tauri's WKWebView doesn't report its version correctly despite being
 * fully capable (AudioWorklet, SharedArrayBuffer, etc. are all available).
 *
 * This replaces the inner isSupported() check to always return true.
 * Runs as a postinstall script so the patch survives npm install.
 */
import { readFileSync, writeFileSync } from "fs";

const file = "node_modules/@livekit/krisp-noise-filter/dist/index.js";

try {
  let code = readFileSync(file, "utf8");
  const re =
    /static isSupported\(\)\s*\{\s*if\s*\(\(0,\s*o\.isSafari\)\(\)\)[\s\S]*?else\s*return\s*!0;\s*\}/;

  if (re.test(code)) {
    code = code.replace(re, "static isSupported(){return!0}");
    writeFileSync(file, code);
    console.log("[patch-krisp] Patched isSupported() Safari gate");
  } else {
    console.log("[patch-krisp] Already patched or pattern changed — skipping");
  }
} catch (e) {
  // Not installed yet or file missing — that's fine
  if (e.code !== "ENOENT") console.warn("[patch-krisp]", e.message);
}
