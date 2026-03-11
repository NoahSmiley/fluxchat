/**
 * Copy @ricky0123/vad-web worklet bundle to public/ so Vite serves it as a static asset.
 * The VAD library expects vad.worklet.bundle.min.js at the base asset path (/).
 */
import { copyFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const src = resolve(root, "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js");
const dest = resolve(root, "public/vad.worklet.bundle.min.js");

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log("[copy-vad-assets] Copied vad.worklet.bundle.min.js to public/");
} else {
  console.warn("[copy-vad-assets] Warning: vad-web worklet not found at", src);
}
