# Krisp Noise Suppression

Flux uses [Krisp](https://krisp.ai/) via LiveKit's official `@livekit/krisp-noise-filter` SDK for real-time AI noise cancellation. Krisp removes keyboard clicks, background noise, and other non-voice audio from microphone input.

## How It Works

### Integration Pattern

Krisp hooks into LiveKit's `TrackProcessor` API:

1. **Listen** for `LocalTrackPublished` (microphone) on the Room
2. **Create** a `KrispNoiseFilter()` instance
3. **Attach** to the mic track via `track.setProcessor(processor)`
4. **Enable** filtering with `processor.setEnabled(true)`

### Three-Thread Architecture

The Krisp SDK runs across three threads:

```
Main Thread                    Web Worker (blob URL)           AudioWorklet (blob URL)
+---------------------+       +----------------------+        +---------------------+
| KrispSDK            |       | WasmProcessor        |        | AudioProcessor      |
| - init()            |       | - WASM NC engine     |        | - real-time audio   |
| - createNoiseFilter |       | - model loading      |        | - SAB ring buffers  |
|                     |       | - _fetchFile (XHR)   |        |                     |
| AudioFilterNode     |       |                      |        |                     |
| - creates Worker    |  msg  | processUsingSAB():   |  SAB   | process():          |
| - creates Worklet   |------>|   read input SAB     |<------>|   write input SAB   |
|                     |       |   WASM NC process    |        |   read output SAB   |
|                     |       |   write output SAB   |        |   output to speaker |
+---------------------+       +----------------------+        +---------------------+
```

When `SharedArrayBuffer` is available (required in Tauri via COOP/COEP headers), audio flows through shared memory ring buffers. The Worker blocks on `Atomics.wait()` until the AudioWorklet notifies it of new audio frames.

### Model Loading

1. `KrispSDK.init()` fetches model metadata from LiveKit's CDN
2. `KrispSDK.preload()` uses `fetch()` to prime the browser cache
3. Worker's `_fetchFile()` uses XHR to download `.kef` model files into WASM memory
4. WASM NC session is created with the loaded model

## File Map

| File | Purpose |
|------|---------|
| `src/lib/noiseProcessor.ts` | `attachNoiseFilter()` / `detachNoiseFilter()` — create and manage Krisp processor |
| `src/stores/voice/connection.ts` | `activeKrispProcessor` state, `destroyAllProcessors()` cleanup |
| `src/stores/voice/room-events.ts` | `LocalTrackPublished` handler — attaches Krisp on voice join |
| `src/stores/voice/store.ts` | Live toggle — detach/reattach when user changes setting mid-call |
| `src/stores/voice/types.ts` | `AudioSettings.noiseSuppression: boolean` |
| `src/components/SettingsModal.tsx` | UI toggle with KrispLogo branding |
| `scripts/patch-krisp.js` | Postinstall patches for SDK bugs (see below) |

## Postinstall Patches (`scripts/patch-krisp.js`)

The Krisp SDK (`@livekit/krisp-noise-filter@0.4.1`) has bugs that prevent it from working in Tauri. We patch the bundled `dist/index.js` via a `postinstall` script. All patches are idempotent and include skip-logging if the pattern isn't found (e.g. if a future SDK version fixes the issue).

### Patch 1: Safari/WKWebView Version Gate

**Problem:** `isSupported()` checks `isSafari()` and rejects Safari versions below a threshold. Tauri's WKWebView doesn't report its Safari version string correctly, so it fails this check despite being fully capable (AudioWorklet, SharedArrayBuffer, WASM all work).

**Fix:** Replace `isSupported()` with `return true`.

### Patch 2: Model Fetch Cache Policy

**Problem:** Model `.kef` file fetches use `cache: "force-cache"`, which can serve corrupt or stale cached files.

**Fix:** Replace with `cache: "no-cache"` to ensure fresh downloads.

### Patch 3: SharedArrayBuffer Noise Level Initialization (Critical)

**Problem:** This is the root cause of Krisp reporting "ACTIVE" but not actually filtering audio.

`createSharedBuffers()` allocates a zero-initialized `Int32Array` backed by `SharedArrayBuffer` for `atomicState`. Index `[1]` maps to `SET_NOISE_SUPPRESSION_LEVEL`. The Worker reads this value on every audio frame via `updateNoiseSuppressionLevelFromSharedArrayBufferState()`, overriding the constructor default of 100 with 0.

**Level 0 = no noise suppression (passthrough).**

There's a secondary routing bug: when `setNoiseSuppressionLevel` is called via message, it's sent to `this.port` (the AudioWorklet) instead of `this.worker`. The Worker is also in a blocking `Atomics.wait()` loop and can't process `self.onmessage` events. So level updates never reach the Worker either.

**Fix:** Wrap the `new Int32Array(new SharedArrayBuffer(...))` in an IIFE that immediately sets `[1] = 100`:

```javascript
atomicState: (function(){
  var _s = new Int32Array(new SharedArrayBuffer(...));
  _s[1] = 100;  // SET_NOISE_SUPPRESSION_LEVEL = full suppression
  return _s;
})()
```

The regex matches all 3 copies of `createSharedBuffers()` in the bundle (Worker blob, AudioWorklet blob, main thread).

## COOP/COEP Headers

SharedArrayBuffer requires Cross-Origin Isolation. Headers are set in two places:

- **Vite dev server:** `vite.config.ts` → `server.headers`
- **Tauri production:** `src-tauri/tauri.conf.json` → `app.security.headers`

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these, the browser falls back to a message-passing path that doesn't have the zero-init bug — but SharedArrayBuffer mode is preferred for lower latency.

## Verifying Krisp Is Working

When `debugLogs: true` is passed to `KrispNoiseFilter()`, the SDK logs WASM initialization, model loading, and per-frame processing stats. To verify suppression is active:

1. Enable noise suppression in Settings > Voice & Audio
2. Join a voice channel
3. Open DevTools console — look for:
   - `[krisp-worker] WASM_PROCESSOR_INITIALIZED` — model loaded
   - Processing rate logs (should show ~375 packages/sec)
4. Background noise (keyboard, fan) should be noticeably reduced

If Krisp reports active but audio sounds unchanged, the SAB patch may not have applied — run `node scripts/patch-krisp.js` manually and check for the "Fixed N SharedArrayBuffer" log line.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Krisp: not supported on this browser" | Safari gate not patched | Run `node scripts/patch-krisp.js`, check Patch 1 log |
| Krisp ACTIVE but no filtering | SAB level = 0 | Run `node scripts/patch-krisp.js`, check Patch 3 log |
| Model download fails | Stale cache or network | Check COOP/COEP headers, try clearing browser cache |
| `SharedArrayBuffer is not defined` | Missing COOP/COEP | Check vite.config.ts and tauri.conf.json headers |
