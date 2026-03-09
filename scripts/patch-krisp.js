/**
 * Patch @livekit/krisp-noise-filter to fix issues in Tauri's WKWebView:
 *
 * 1. Remove the Safari/WKWebView version gate (isSupported).
 *    Tauri's WKWebView doesn't report its Safari version correctly
 *    despite being fully capable (AudioWorklet, SharedArrayBuffer, etc.).
 *
 * 2. Replace 'force-cache' with 'no-cache' for model fetches.
 *    Ensures fresh .kef model files are downloaded instead of using
 *    potentially corrupt cached versions.
 *
 * 3. Fix SharedArrayBuffer noise suppression level initialization.
 *    BUG: createSharedBuffers() zero-initializes atomicState, so
 *    atomicState[1] (SET_NOISE_SUPPRESSION_LEVEL) starts at 0.
 *    The Worker reads this on every frame, overriding the constructor
 *    default of 100 with 0. Level 0 = no noise suppression (passthrough).
 *    FIX: Initialize atomicState[1] to 100 after creation.
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

  // ── Patch 2: Replace force-cache with no-cache for model fetches ──
  const forceCacheCount = (code.match(/cache:\s*["']force-cache["']/g) || []).length;
  if (forceCacheCount > 0) {
    code = code.replace(/cache:\s*["']force-cache["']/g, 'cache: "no-cache"');
    console.log(`[patch-krisp] Replaced ${forceCacheCount} 'force-cache' → 'no-cache' for model fetches`);
    patched = true;
  } else {
    console.log("[patch-krisp] No 'force-cache' found — skipping");
  }

  // ── Patch 3: Fix SharedArrayBuffer noise suppression level initialization ──
  // We wrap the `new Int32Array(new SharedArrayBuffer(...))` in an IIFE that sets [1]=100.
  const sabInitPattern = /atomicState:\s*new Int32Array\(new (\w+)\.SharedArrayBuffer\(Object\.keys\((\w+)\.STATE\)\.length\s*\*\s*Int32Array\.BYTES_PER_ELEMENT\)\)/g;
  let sabPatchCount = 0;
  code = code.replace(sabInitPattern, (match, sabVar, stateVar) => {
    sabPatchCount++;
    return `atomicState: (function(){var _s=new Int32Array(new ${sabVar}.SharedArrayBuffer(Object.keys(${stateVar}.STATE).length*Int32Array.BYTES_PER_ELEMENT));_s[1]=100;return _s})()`;
  });
  if (sabPatchCount > 0) {
    console.log(`[patch-krisp] Fixed ${sabPatchCount} SharedArrayBuffer noise suppression level initializations (0→100)`);
    patched = true;
  } else {
    console.log("[patch-krisp] SharedArrayBuffer init pattern not found — skipping");
  }

  if (patched) {
    writeFileSync(file, code);
    console.log("[patch-krisp] Done — wrote patched file");
  }
} catch (e) {
  // Not installed yet or file missing — that's fine
  if (e.code !== "ENOENT") console.warn("[patch-krisp]", e.message);
}
