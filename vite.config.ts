import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "fs";

// Serve .mjs files from public/ as raw JS instead of going through Vite's
// module transform pipeline. ONNX runtime dynamically imports its WASM
// loader (.mjs) and Vite rejects it because public/ files aren't modules.
function servePublicMjs(): Plugin {
  return {
    name: "serve-public-mjs",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && /^\/[^@].*\.mjs(\?.*)?$/.test(req.url)) {
          const filePath = resolve(__dirname, "public", req.url.split("?")[0].slice(1));
          try {
            const content = readFileSync(filePath);
            res.setHeader("Content-Type", "application/javascript");
            res.end(content);
            return;
          } catch { /* fall through to next handler */ }
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [servePublicMjs(), react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  assetsInclude: ["**/*.onnx"],
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: parseInt(process.env.VITE_PORT || "1420"),
    strictPort: true,
    // COEP temporarily removed to test Spotify SDK compatibility
    // SharedArrayBuffer (Krisp WASM) needs COEP — will restore after test
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    proxy: {
      "/api": `http://localhost:${process.env.API_PORT || "3001"}`,
      "/gateway": {
        target: `http://localhost:${process.env.API_PORT || "3001"}`,
        ws: true,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  build: {
    outDir: "dist",
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    // Don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
      output: {
        manualChunks: {
          "livekit": ["livekit-client"],
          "emoji": ["@emoji-mart/data"],
          "dnd": ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
        },
      },
    },
  },
});
