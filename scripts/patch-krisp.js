/**
 * Patch @livekit/krisp-noise-filter to:
 *
 * 1. Remove the Safari/WKWebView version gate (isSupported).
 *    Tauri's WKWebView doesn't report its Safari version correctly
 *    despite being fully capable (AudioWorklet, SharedArrayBuffer, etc.).
 *
 * 2. Bypass the cloud license check.
 *    The Krisp SDK phones home to the LiveKit Cloud server after track
 *    publish to verify the account has Krisp enabled. If the check fails
 *    the WASM stays suspended and audio passes through unfiltered — while
 *    the SDK also disables browser-native noiseSuppression via
 *    applyConstraints. This leaves the user with ZERO noise filtering.
 *    We patch the license-check function to always return true so the
 *    WASM actually processes audio regardless of the Cloud plan.
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

  // ── Patch 2: Cloud license check ──
  // The SDK defines an async function (between two `new WeakSet()` landmarks)
  // that constructs a URL from the room server, fetches it with a Bearer token,
  // and checks if `{ enabled: true }` is returned. If not, the WASM stays
  // suspended. We replace the function body with `return true`.
  //
  // Structure in the minified code:
  //   new WeakSet(), XX = async function(A) {
  //     ... new URL(...) ... fetch(..., { headers: { authorization: ... } }) ...
  //     ... throw new Error(...);
  //   }, YY = new WeakSet()
  const reLicense =
    /(new\s+WeakSet\(\)\s*,\s*)(\w+)(\s*=\s*async\s+function\s*\([^)]*\)\s*\{)[\s\S]*?authorization[\s\S]*?\}(\s*,\s*)(\w+)(\s*=\s*new\s+WeakSet\(\))/;

  if (reLicense.test(code)) {
    code = code.replace(reLicense, "$1$2$3 return !0; }$4$5$6");
    console.log("[patch-krisp] Patched cloud license check — WASM always enabled");
    patched = true;
  } else {
    console.log("[patch-krisp] License check already patched or pattern changed — skipping");
  }

  if (patched) {
    writeFileSync(file, code);
    console.log("[patch-krisp] Done — wrote patched file");
  }
} catch (e) {
  // Not installed yet or file missing — that's fine
  if (e.code !== "ENOENT") console.warn("[patch-krisp]", e.message);
}
