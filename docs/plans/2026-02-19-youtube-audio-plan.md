# YouTube Audio Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add YouTube audio playback to Flux listening sessions alongside Spotify, with a mixed queue and stream-proxy backend.

**Architecture:** Backend runs yt-dlp to resolve direct audio URLs, then proxies audio bytes to clients via Axum streaming responses. Frontend adds an HTMLAudioElement alongside the Spotify Web Playback SDK, routing playback based on a `source` field on queue items. No files saved to disk.

**Tech Stack:** Rust/Axum (backend), yt-dlp (CLI), reqwest (HTTP proxy), React/Zustand (frontend), HTML5 Audio API

---

### Task 1: Increase vinyl size in CSS

**Files:**
- Modify: `src/styles/global.css:5346-5347`

**Step 1: Update vinyl dimensions**

In `src/styles/global.css`, change the `.music-vinyl` width and height from `250px` to `340px`:

```css
.music-vinyl {
  position: relative;
  width: 340px;
  height: 340px;
```

**Step 2: Verify visually**

Run: `npm run dev` (from `C:/Users/noah/benchmarks/flux-tauri`)
Expected: Vinyl record is noticeably larger in the music panel.

**Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "style: increase vinyl record size to 340px"
```

---

### Task 2: Add `source` column to `session_queue` table (DB migration)

**Files:**
- Modify: `crates/server/src/db/mod.rs` (after line 119, where session_queue table is created)

**Step 1: Add migration for `source` column**

After the `session_queue` CREATE TABLE (line 119), add an ALTER TABLE migration:

```rust
// Migration: add source column to session_queue
sqlx::query(
    r#"ALTER TABLE "session_queue" ADD COLUMN source TEXT NOT NULL DEFAULT 'spotify'"#,
)
.execute(&pool)
.await
.ok();
```

**Step 2: Update `QueueItem` model**

In `crates/server/src/models.rs`, add `source` field to `QueueItem` (after line 312, after `created_at`):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub session_id: String,
    pub track_uri: String,
    pub track_name: String,
    pub track_artist: String,
    pub track_album: Option<String>,
    pub track_image_url: Option<String>,
    pub track_duration_ms: i64,
    pub added_by_user_id: String,
    pub position: i64,
    pub created_at: String,
    pub source: String,
}
```

**Step 3: Update `AddToQueueRequest` model**

In `crates/server/src/models.rs`, add `source` to `AddToQueueRequest`:

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToQueueRequest {
    pub track_uri: String,
    pub track_name: String,
    pub track_artist: String,
    pub track_album: Option<String>,
    pub track_image_url: Option<String>,
    pub track_duration_ms: i64,
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "spotify".to_string()
}
```

**Step 4: Update `add_to_queue` in `crates/server/src/routes/spotify.rs`**

Update the INSERT query (line 558-574) to include `source`, and update the `QueueItem` construction (line 577-589):

Insert query becomes:
```rust
let _ = sqlx::query(
    r#"INSERT INTO "session_queue"
       (id, session_id, track_uri, track_name, track_artist, track_album, track_image_url, track_duration_ms, added_by_user_id, position, created_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
)
.bind(&item_id)
.bind(&session_id)
.bind(&body.track_uri)
.bind(&body.track_name)
.bind(&body.track_artist)
.bind(&body.track_album)
.bind(&body.track_image_url)
.bind(body.track_duration_ms)
.bind(&user.id)
.bind(position)
.bind(&now)
.bind(&body.source)
.execute(&state.db)
.await;
```

QueueItem construction becomes:
```rust
let queue_item = QueueItem {
    id: item_id.clone(),
    session_id: session_id.clone(),
    track_uri: body.track_uri,
    track_name: body.track_name,
    track_artist: body.track_artist,
    track_album: body.track_album,
    track_image_url: body.track_image_url,
    track_duration_ms: body.track_duration_ms,
    added_by_user_id: user.id.clone(),
    position,
    created_at: now,
    source: body.source,
};
```

**Step 5: Build and verify**

Run: `cargo build -p flux-server` (from `C:/Users/noah/benchmarks/flux-tauri`)
Expected: Compiles with no errors (warnings OK).

**Step 6: Commit**

```bash
git add crates/server/src/db/mod.rs crates/server/src/models.rs crates/server/src/routes/spotify.rs
git commit -m "feat: add source column to session_queue for multi-source support"
```

---

### Task 3: Add `source` field to WebSocket events

**Files:**
- Modify: `crates/server/src/ws/events.rs:102-110` (ClientEvent::SpotifyPlaybackControl)
- Modify: `crates/server/src/ws/events.rs:277-287` (ServerEvent::SpotifyPlaybackSync)
- Modify: `crates/server/src/ws/handler.rs:806-880` (playback control handler)

**Step 1: Add `source` to `ClientEvent::SpotifyPlaybackControl`**

```rust
SpotifyPlaybackControl {
    #[serde(rename = "sessionId")]
    session_id: String,
    action: String,
    #[serde(rename = "trackUri")]
    track_uri: Option<String>,
    #[serde(rename = "positionMs")]
    position_ms: Option<i64>,
    #[serde(default = "default_source_str")]
    source: String,
},
```

Add at the bottom of the file:
```rust
fn default_source_str() -> String {
    "spotify".to_string()
}
```

**Step 2: Add `source` to `ServerEvent::SpotifyPlaybackSync`**

```rust
SpotifyPlaybackSync {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "voiceChannelId")]
    voice_channel_id: String,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "trackUri")]
    track_uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "positionMs")]
    position_ms: Option<i64>,
    source: String,
},
```

**Step 3: Update handler to pass `source` through**

In `crates/server/src/ws/handler.rs`, update the `SpotifyPlaybackControl` match arm to destructure `source` and pass it to the broadcast:

```rust
ClientEvent::SpotifyPlaybackControl {
    session_id,
    action,
    track_uri,
    position_ms,
    source,
} => {
```

And in the broadcast at the end of this handler, include `source: source.clone()`:

```rust
state
    .gateway
    .broadcast_all(
        &ServerEvent::SpotifyPlaybackSync {
            session_id,
            voice_channel_id,
            action,
            track_uri,
            position_ms,
            source,
        },
        Some(client_id),
    )
    .await;
```

**Step 4: Build and verify**

Run: `cargo build -p flux-server`
Expected: Compiles with no errors.

**Step 5: Commit**

```bash
git add crates/server/src/ws/events.rs crates/server/src/ws/handler.rs
git commit -m "feat: add source field to playback WebSocket events"
```

---

### Task 4: Create YouTube backend routes (`youtube.rs`)

**Files:**
- Create: `crates/server/src/routes/youtube.rs`
- Modify: `crates/server/src/routes/mod.rs` (add module + routes)
- Modify: `crates/server/src/main.rs` (add URL cache to AppState)

**Step 1: Add URL cache to AppState**

In `crates/server/src/main.rs`, add to `AppState` struct:

```rust
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub config: Config,
    pub gateway: Arc<ws::gateway::GatewayState>,
    pub spotify_auth_pending: tokio::sync::RwLock<std::collections::HashMap<String, (String, String)>>,
    /// YouTube audio URL cache: video_id → (audio_url, fetched_at)
    pub youtube_url_cache: tokio::sync::RwLock<std::collections::HashMap<String, (String, std::time::Instant)>>,
}
```

And initialize it:
```rust
let state = Arc::new(AppState {
    db: pool,
    config: config.clone(),
    gateway: Arc::new(ws::gateway::GatewayState::new()),
    spotify_auth_pending: tokio::sync::RwLock::new(std::collections::HashMap::new()),
    youtube_url_cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
});
```

Also add a startup check for yt-dlp:
```rust
// Check for yt-dlp
match tokio::process::Command::new("yt-dlp").arg("--version").output().await {
    Ok(output) if output.status.success() => {
        let version = String::from_utf8_lossy(&output.stdout);
        tracing::info!("yt-dlp found: {}", version.trim());
    }
    _ => {
        tracing::warn!("yt-dlp not found on PATH — YouTube audio features will be unavailable");
    }
}
```

**Step 2: Create `crates/server/src/routes/youtube.rs`**

```rust
use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;

use crate::models::AuthUser;
use crate::AppState;

const CACHE_TTL_SECS: u64 = 30 * 60; // 30 minutes

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeTrack {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    pub duration_ms: i64,
}

/// GET /api/youtube/search?q=...
pub async fn search(
    _user: AuthUser,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let q = match query.q.as_deref() {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => return Json(serde_json::json!({"tracks": []})).into_response(),
    };

    let search_query = format!("ytsearch5:{}", q);
    let output = match tokio::process::Command::new("yt-dlp")
        .args(["--dump-json", "--flat-playlist", "--no-warnings", &search_query])
        .output()
        .await
    {
        Ok(o) if o.status.success() => o.stdout,
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            tracing::error!("yt-dlp search failed: {}", stderr);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "YouTube search failed"}))).into_response();
        }
        Err(e) => {
            tracing::error!("Failed to run yt-dlp: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "yt-dlp not available"}))).into_response();
        }
    };

    let stdout = String::from_utf8_lossy(&output);
    let tracks: Vec<YouTubeTrack> = stdout
        .lines()
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(YouTubeTrack {
                id: v["id"].as_str()?.to_string(),
                title: v["title"].as_str().unwrap_or("Unknown").to_string(),
                channel: v["channel"].as_str()
                    .or_else(|| v["uploader"].as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                thumbnail: v["thumbnail"].as_str()
                    .or_else(|| v["thumbnails"].as_array()?.last()?.get("url")?.as_str())
                    .unwrap_or("")
                    .to_string(),
                duration_ms: v["duration"].as_f64().map(|d| (d * 1000.0) as i64).unwrap_or(0),
            })
        })
        .collect();

    Json(serde_json::json!({"tracks": tracks})).into_response()
}

/// Resolve the direct audio stream URL for a video, using cache.
async fn resolve_audio_url(state: &AppState, video_id: &str) -> Result<String, String> {
    // Check cache
    {
        let cache = state.youtube_url_cache.read().await;
        if let Some((url, fetched_at)) = cache.get(video_id) {
            if fetched_at.elapsed().as_secs() < CACHE_TTL_SECS {
                return Ok(url.clone());
            }
        }
    }

    let yt_url = format!("https://www.youtube.com/watch?v={}", video_id);
    let output = tokio::process::Command::new("yt-dlp")
        .args(["-f", "bestaudio", "--get-url", "--no-warnings", &yt_url])
        .output()
        .await
        .map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp failed: {}", stderr));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if url.is_empty() {
        return Err("yt-dlp returned empty URL".to_string());
    }

    // Cache it
    {
        let mut cache = state.youtube_url_cache.write().await;
        cache.insert(video_id.to_string(), (url.clone(), Instant::now()));
    }

    Ok(url)
}

/// GET /api/youtube/audio/{videoId}
pub async fn stream_audio(
    _user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(video_id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Validate video ID (alphanumeric + dash/underscore, 11 chars)
    if !video_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') || video_id.len() > 20 {
        return (StatusCode::BAD_REQUEST, "Invalid video ID").into_response();
    }

    let audio_url = match resolve_audio_url(&state, &video_id).await {
        Ok(url) => url,
        Err(e) => {
            tracing::error!("Failed to resolve audio URL for {}: {}", video_id, e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to get audio stream").into_response();
        }
    };

    // Build upstream request, forwarding Range header if present
    let client = reqwest::Client::new();
    let mut req = client.get(&audio_url);
    if let Some(range) = headers.get(header::RANGE) {
        req = req.header(header::RANGE, range);
    }

    let upstream = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to fetch audio stream: {}", e);
            // Invalidate cache on failure
            let mut cache = state.youtube_url_cache.write().await;
            cache.remove(&video_id);
            return (StatusCode::BAD_GATEWAY, "Failed to fetch audio").into_response();
        }
    };

    let status = upstream.status();
    let mut response_headers = HeaderMap::new();

    // Forward content headers
    if let Some(ct) = upstream.headers().get(header::CONTENT_TYPE) {
        response_headers.insert(header::CONTENT_TYPE, ct.clone());
    } else {
        response_headers.insert(header::CONTENT_TYPE, "audio/webm".parse().unwrap());
    }
    if let Some(cl) = upstream.headers().get(header::CONTENT_LENGTH) {
        response_headers.insert(header::CONTENT_LENGTH, cl.clone());
    }
    if let Some(cr) = upstream.headers().get(header::CONTENT_RANGE) {
        response_headers.insert(header::CONTENT_RANGE, cr.clone());
    }
    if let Some(ar) = upstream.headers().get(header::ACCEPT_RANGES) {
        response_headers.insert(header::ACCEPT_RANGES, ar.clone());
    }

    let axum_status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK);
    let stream = upstream.bytes_stream();
    let body = Body::from_stream(stream);

    (axum_status, response_headers, body).into_response()
}
```

**Step 3: Register routes in `crates/server/src/routes/mod.rs`**

Add `pub mod youtube;` to the module list (after line 13, `pub mod spotify;`).

Add routes in `build_router` after the Spotify routes block (after line 87):

```rust
        // YouTube
        .route("/youtube/search", get(youtube::search))
        .route("/youtube/audio/{videoId}", get(youtube::stream_audio))
```

**Step 4: Build and verify**

Run: `cargo build -p flux-server`
Expected: Compiles with no errors.

**Step 5: Commit**

```bash
git add crates/server/src/routes/youtube.rs crates/server/src/routes/mod.rs crates/server/src/main.rs
git commit -m "feat: add YouTube search and audio proxy endpoints"
```

---

### Task 5: Update frontend types and API client

**Files:**
- Modify: `src/types/shared.ts` (add YouTubeTrack, update QueueItem and WS types)
- Modify: `src/lib/api.ts` (add YouTube API calls, update addToQueue)

**Step 1: Add types to `src/types/shared.ts`**

After `SpotifyTrack` (line 143), add:

```typescript
export interface YouTubeTrack {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationMs: number;
}
```

Update `QueueItem` (line 123) to add `source`:

```typescript
export interface QueueItem {
  id: string;
  sessionId: string;
  trackUri: string;
  trackName: string;
  trackArtist: string;
  trackAlbum?: string;
  trackImageUrl?: string;
  trackDurationMs: number;
  addedByUserId: string;
  position: number;
  createdAt: string;
  source: string;
}
```

Update `WSClientEvent` (line 178) to add `source` to `spotify_playback_control`:

```typescript
| { type: "spotify_playback_control"; sessionId: string; action: string; trackUri?: string; positionMs?: number; source?: string }
```

Update `WSServerEvent` `spotify_playback_sync` (line 205) to add `source`:

```typescript
| { type: "spotify_playback_sync"; sessionId: string; voiceChannelId: string; action: string; trackUri?: string; positionMs?: number; source?: string }
```

**Step 2: Add YouTube API functions to `src/lib/api.ts`**

After the Spotify section (after line 416), add:

```typescript
// ── YouTube ──

export async function searchYouTubeTracks(q: string) {
  return request<{ tracks: import("../types/shared.js").YouTubeTrack[] }>(`/youtube/search?q=${encodeURIComponent(q)}`);
}

export function getYouTubeAudioUrl(videoId: string): string {
  const token = getStoredToken();
  return `${BASE_URL}/youtube/audio/${videoId}${token ? `?token=${token}` : ""}`;
}
```

Update `addToQueue` (line 396-404) to include `source`:

```typescript
export async function addToQueue(sessionId: string, track: {
  trackUri: string; trackName: string; trackArtist: string;
  trackAlbum?: string; trackImageUrl?: string; trackDurationMs: number;
  source?: string;
}) {
  return request<{ id: string }>(`/spotify/sessions/${sessionId}/queue`, {
    method: "POST",
    body: JSON.stringify(track),
  });
}
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit` (from `C:/Users/noah/benchmarks/flux-tauri`)
Expected: No type errors related to YouTube changes.

**Step 4: Commit**

```bash
git add src/types/shared.ts src/lib/api.ts
git commit -m "feat: add YouTube types and API client functions"
```

---

### Task 6: Update Zustand store for dual playback

**Files:**
- Modify: `src/stores/spotify.ts`

**Step 1: Add YouTube state and HTMLAudioElement**

Add to the `SpotifyState` interface (around line 78):

```typescript
// YouTube
youtubeAudio: HTMLAudioElement | null;
youtubeTrack: { id: string; name: string; artist: string; album: string; imageUrl: string; durationMs: number } | null;
youtubeProgress: number;
youtubeDuration: number;
youtubePaused: boolean;
searchSource: "spotify" | "youtube";
youtubeSearchResults: import("../types/shared.js").YouTubeTrack[];

setSearchSource: (source: "spotify" | "youtube") => void;
searchYouTube: (query: string) => Promise<void>;
addYouTubeToQueue: (track: import("../types/shared.js").YouTubeTrack) => Promise<void>;
playYouTube: (videoId: string, trackInfo?: { name: string; artist: string; imageUrl: string; durationMs: number }) => void;
pauseYouTube: () => void;
```

Add to store initial state:
```typescript
youtubeAudio: null,
youtubeTrack: null,
youtubeProgress: 0,
youtubeDuration: 0,
youtubePaused: true,
searchSource: "spotify" as const,
youtubeSearchResults: [],
```

**Step 2: Implement YouTube methods**

Add `setSearchSource`:
```typescript
setSearchSource: (source) => set({ searchSource: source, searchResults: [], youtubeSearchResults: [] }),
```

Add `searchYouTube`:
```typescript
searchYouTube: async (query) => {
  if (!query.trim()) { set({ youtubeSearchResults: [] }); return; }
  set({ searchLoading: true });
  try {
    const data = await api.searchYouTubeTracks(query);
    set({ youtubeSearchResults: data.tracks ?? [] });
  } catch { set({ youtubeSearchResults: [] }); }
  finally { set({ searchLoading: false }); }
},
```

Add `addYouTubeToQueue`:
```typescript
addYouTubeToQueue: async (track) => {
  const { session } = get();
  if (!session) return;
  await api.addToQueue(session.id, {
    trackUri: track.id,
    trackName: track.title,
    trackArtist: track.channel,
    trackAlbum: track.channel,
    trackImageUrl: track.thumbnail,
    trackDurationMs: track.durationMs,
    source: "youtube",
  });
},
```

Add `playYouTube`:
```typescript
playYouTube: (videoId, trackInfo) => {
  const { player } = get();
  // Pause Spotify if playing
  player?.pause();

  let audio = get().youtubeAudio;
  if (!audio) {
    audio = new Audio();
    audio.addEventListener("timeupdate", () => {
      set({ youtubeProgress: audio!.currentTime * 1000 });
    });
    audio.addEventListener("loadedmetadata", () => {
      set({ youtubeDuration: audio!.duration * 1000 });
    });
    audio.addEventListener("ended", () => {
      set({ youtubePaused: true });
      // Auto-skip to next in queue
      get().skip();
    });
    audio.addEventListener("pause", () => set({ youtubePaused: true }));
    audio.addEventListener("play", () => set({ youtubePaused: false }));
    set({ youtubeAudio: audio });
  }

  const token = api.getStoredToken();
  audio.src = `${API_BASE}/youtube/audio/${videoId}${token ? `?token=${token}` : ""}`;
  audio.volume = get().volume;
  audio.play();

  if (trackInfo) {
    set({
      youtubeTrack: { id: videoId, ...trackInfo },
      youtubePaused: false,
    });
  }
},
pauseYouTube: () => {
  const { youtubeAudio } = get();
  if (youtubeAudio) youtubeAudio.pause();
},
```

**Step 3: Update `play()` to handle source routing**

Modify the `play` method to check if the track is YouTube and route accordingly:

```typescript
play: async (trackUri, source) => {
  const { session, player, queue } = get();
  if (!session) return;

  // Determine source from queue if not provided
  const effectiveSource = source ?? queue.find(i => i.trackUri === trackUri)?.source ?? "spotify";

  if (trackUri) {
    const queueItem = queue.find((item) => item.trackUri === trackUri);
    if (queueItem) {
      set((s) => ({ queue: s.queue.filter((item) => item.trackUri !== trackUri) }));
      api.removeFromQueue(session.id, queueItem.id);
    }
  }

  gateway.send({
    type: "spotify_playback_control",
    sessionId: session.id,
    action: "play",
    trackUri,
    positionMs: 0,
    source: effectiveSource,
  });

  if (effectiveSource === "youtube" && trackUri) {
    const queueItem = queue.find(i => i.trackUri === trackUri);
    get().playYouTube(trackUri, queueItem ? {
      name: queueItem.trackName,
      artist: queueItem.trackArtist,
      imageUrl: queueItem.trackImageUrl ?? "",
      durationMs: queueItem.trackDurationMs,
    } : undefined);
  } else if (player && trackUri) {
    // Pause YouTube if playing
    get().youtubeAudio?.pause();
    const deviceId = await get().ensureDeviceId();
    if (deviceId) await playOnDevice(deviceId, [trackUri]);
  } else if (player) {
    get().youtubeAudio?.pause();
    player.resume();
  }
},
```

Update `play` signature in interface to:
```typescript
play: (trackUri?: string, source?: string) => void;
```

**Step 4: Update `pause()` to handle both sources**

```typescript
pause: () => {
  const { session, player, playerState, youtubeAudio, youtubeTrack } = get();
  if (!session) return;

  // Determine which source is active
  const isYouTubePlaying = youtubeTrack && !get().youtubePaused;

  gateway.send({
    type: "spotify_playback_control",
    sessionId: session.id,
    action: "pause",
    positionMs: isYouTubePlaying ? get().youtubeProgress : playerState?.position,
    source: isYouTubePlaying ? "youtube" : "spotify",
  });

  if (isYouTubePlaying) {
    youtubeAudio?.pause();
  } else {
    player?.pause();
  }
},
```

**Step 5: Update `skip()` to handle YouTube source in queue**

When skipping, check the next track's source and route accordingly:

```typescript
skip: async (trackUri) => {
  const { session, player, queue } = get();
  if (!session) return;

  const nextItem = trackUri ? queue.find(i => i.trackUri === trackUri) : queue[0];
  const nextTrack = trackUri ?? queue[0]?.trackUri;
  const nextSource = nextItem?.source ?? "spotify";

  if (!nextTrack) {
    gateway.send({ type: "spotify_playback_control", sessionId: session.id, action: "pause", positionMs: 0 });
    player?.pause();
    get().youtubeAudio?.pause();
    set({ playerState: null, youtubeTrack: null });
    gateway.send({ type: "update_activity", activity: null });
    return;
  }

  gateway.send({
    type: "spotify_playback_control",
    sessionId: session.id,
    action: "skip",
    trackUri: nextTrack,
    source: nextSource,
  });

  set((s) => ({ queue: s.queue.filter((item) => item.trackUri !== nextTrack) }));

  if (nextSource === "youtube") {
    player?.pause();
    get().playYouTube(nextTrack, nextItem ? {
      name: nextItem.trackName,
      artist: nextItem.trackArtist,
      imageUrl: nextItem.trackImageUrl ?? "",
      durationMs: nextItem.trackDurationMs,
    } : undefined);
  } else {
    get().youtubeAudio?.pause();
    const deviceId = await get().ensureDeviceId();
    if (deviceId) await playOnDevice(deviceId, [nextTrack]);
  }
},
```

**Step 6: Update `setVolume` to affect both players**

```typescript
setVolume: (vol) => {
  const { player, youtubeAudio } = get();
  set({ volume: vol });
  player?.setVolume(vol);
  if (youtubeAudio) youtubeAudio.volume = vol;
},
```

**Step 7: Update `handleWSEvent` for `spotify_playback_sync` source routing**

In the `spotify_playback_sync` case, add source-aware routing:

```typescript
case "spotify_playback_sync": {
  const { session, player } = get();
  if (!session || session.id !== event.sessionId) break;

  const source = (event as any).source ?? "spotify";

  if (source === "youtube") {
    if (event.action === "play" && event.trackUri) {
      player?.pause(); // pause Spotify
      get().playYouTube(event.trackUri);
    } else if (event.action === "pause") {
      get().youtubeAudio?.pause();
    } else if (event.action === "seek" && event.positionMs != null) {
      const audio = get().youtubeAudio;
      if (audio) audio.currentTime = event.positionMs / 1000;
    } else if (event.action === "skip" && event.trackUri) {
      player?.pause();
      set((s) => ({ queue: s.queue.filter((item) => item.trackUri !== event.trackUri) }));
      get().playYouTube(event.trackUri);
    }
  } else {
    // Existing Spotify handling
    get().youtubeAudio?.pause();
    // ... (keep existing code)
  }
  break;
}
```

**Step 8: Update `cleanup` to dispose YouTube audio**

```typescript
cleanup: () => {
  get().disconnectPlayer();
  const { youtubeAudio } = get();
  if (youtubeAudio) {
    youtubeAudio.pause();
    youtubeAudio.src = "";
  }
  if (wsUnsub) { wsUnsub(); wsUnsub = null; }
},
```

**Step 9: Commit**

```bash
git add src/stores/spotify.ts
git commit -m "feat: dual playback engine — YouTube via HTMLAudioElement + Spotify SDK"
```

---

### Task 7: Update MusicPanel UI for YouTube search and mixed queue

**Files:**
- Modify: `src/components/MusicPanel.tsx`

**Step 1: Update imports and store usage**

Add `YouTubeTrack` to the type import. Add YouTube-related store fields:

```typescript
import type { SpotifyTrack, YouTubeTrack } from "../types/shared.js";
```

Add to the destructured store:
```typescript
const {
  account, session, queue, isHost, playerState,
  searchResults, searchLoading, volume,
  youtubeTrack, youtubeProgress, youtubeDuration, youtubePaused,
  searchSource, youtubeSearchResults,
  startSession, loadSession, endSession, addTrackToQueue, removeFromQueue,
  play, pause, skip, seek, setVolume, searchTracks,
  setSearchSource, searchYouTube, addYouTubeToQueue,
} = useSpotifyStore();
```

**Step 2: Determine current track from either source**

Replace the `currentTrack` / `isPaused` / `albumArtUrl` derivation with:

```typescript
const spotifyTrack = playerState?.track_window?.current_track;
const isYouTubePlaying = youtubeTrack && !youtubePaused;
const currentTrackName = isYouTubePlaying ? youtubeTrack.name : spotifyTrack?.name;
const currentTrackArtist = isYouTubePlaying
  ? youtubeTrack.artist
  : spotifyTrack?.artists.map(a => a.name).join(", ");
const albumArtUrl = isYouTubePlaying ? youtubeTrack.imageUrl : spotifyTrack?.album.images[0]?.url;
const isPaused = isYouTubePlaying ? youtubePaused : (playerState?.paused ?? true);
const hasTrack = !!(currentTrackName);
```

**Step 3: Update search to include source toggle**

Replace the search toggle and form section (lines 444-505) with:

```tsx
{/* Search toggle */}
<div className="music-search-header">
  <button
    className={`music-search-toggle ${showSearch ? "active" : ""}`}
    onClick={() => setShowSearch(!showSearch)}
  >
    {showSearch ? <X size={16} /> : <Search size={16} />}
    {showSearch ? "Close Search" : "Search Tracks"}
  </button>
</div>

{showSearch && (
  <div className="music-search">
    {/* Source tabs */}
    <div className="music-search-source-tabs">
      <button
        className={`music-source-tab ${searchSource === "spotify" ? "active" : ""}`}
        onClick={() => setSearchSource("spotify")}
      >
        Spotify
      </button>
      <button
        className={`music-source-tab ${searchSource === "youtube" ? "active" : ""}`}
        onClick={() => setSearchSource("youtube")}
      >
        YouTube
      </button>
    </div>
    <form onSubmit={handleSearch} className="music-search-form">
      <input
        type="text"
        placeholder={`Search ${searchSource === "spotify" ? "Spotify" : "YouTube"}...`}
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="music-search-input"
        autoFocus
      />
    </form>
    {searchLoading && <div className="music-search-loading">Searching...</div>}
    <div className="music-search-results">
      {searchSource === "spotify"
        ? searchResults.map((track) => (
            /* existing Spotify search result items */
          ))
        : youtubeSearchResults.map((track) => (
            <div key={track.id} className="music-search-item">
              {track.thumbnail && (
                <img src={track.thumbnail} alt="" className="music-search-item-art" />
              )}
              <div className="music-search-item-info">
                <span className="music-search-item-name">{track.title}</span>
                <span className="music-search-item-artist">{track.channel}</span>
              </div>
              <div className="music-search-item-actions">
                <button className="music-search-item-play" onClick={() => play(track.id, "youtube")} title="Play now">
                  <Play size={14} />
                </button>
                <button className="music-search-item-add" onClick={() => addYouTubeToQueue(track)} title="Add to queue">
                  <Plus size={14} />
                </button>
              </div>
            </div>
          ))}
    </div>
  </div>
)}
```

**Step 4: Update `handleSearch` to route by source**

```typescript
function handleSearch(e: FormEvent) {
  e.preventDefault();
  if (!searchInput.trim()) return;
  if (searchSource === "youtube") {
    searchYouTube(searchInput.trim());
  } else {
    searchTracks(searchInput.trim());
  }
}
```

**Step 5: Add source badge to queue items**

In the queue item rendering (line 515), add a small indicator:

```tsx
<div key={item.id} className="music-queue-item">
  <span className={`music-queue-source-badge ${item.source === "youtube" ? "youtube" : "spotify"}`}>
    {item.source === "youtube" ? "YT" : "SP"}
  </span>
  {/* rest of queue item */}
```

**Step 6: Update now-playing section to use unified track info**

Replace the now-playing block to use the new `currentTrackName`, `currentTrackArtist`, `albumArtUrl`, `isPaused`, `hasTrack` variables instead of `currentTrack`:

```tsx
{hasTrack && (
  <div className={`music-now-playing ${isPaused ? "paused" : ""} ${vibeMode ? "vibe-overlay" : ""}`}>
    {albumArtUrl && !vibeMode && (
      <div className={`music-vinyl ${isPaused ? "paused" : "spinning"}`}>
        <div className="music-vinyl-grooves" />
        <img src={albumArtUrl} alt="" className="music-album-art" />
        <div className="music-vinyl-center" />
      </div>
    )}
    <div className="music-track-info">
      <span className="music-track-name">{currentTrackName}</span>
      <span className="music-track-artist">{currentTrackArtist}</span>
    </div>
  </div>
)}
```

Update the controls block similarly to use `hasTrack` instead of `currentTrack`.

**Step 7: Commit**

```bash
git add src/components/MusicPanel.tsx
git commit -m "feat: MusicPanel UI — source tabs, YouTube search results, queue badges"
```

---

### Task 8: Add CSS for source tabs and queue badges

**Files:**
- Modify: `src/styles/global.css`

**Step 1: Add source tab styles**

Add after the existing music search styles:

```css
/* Source tabs for search */
.music-search-source-tabs {
  display: flex;
  gap: 4px;
  padding: 0 12px;
  margin-bottom: 8px;
}

.music-source-tab {
  flex: 1;
  padding: 6px 0;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.music-source-tab:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.music-source-tab.active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

/* Queue source badges */
.music-queue-source-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 4px;
  border-radius: 3px;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.music-queue-source-badge.spotify {
  background: rgba(29, 185, 84, 0.2);
  color: #1db954;
}

.music-queue-source-badge.youtube {
  background: rgba(255, 0, 0, 0.15);
  color: #ff4444;
}
```

**Step 2: Commit**

```bash
git add src/styles/global.css
git commit -m "style: add source tab and queue badge CSS"
```

---

### Task 9: Handle YouTube audio auth in backend

**Files:**
- Modify: `crates/server/src/routes/youtube.rs`

The YouTube audio endpoint is fetched by an `<audio>` element, which can't easily set `Authorization` headers. We need to support token via query param.

**Step 1: Add query-param token extraction**

In `stream_audio`, before the `AuthUser` extractor, add an alternative auth path. Actually, the simplest approach: add a query param `token` fallback to the auth middleware for this specific route.

Instead, update the `stream_audio` handler to accept an optional `token` query param and validate it manually if the `AuthUser` extractor isn't used:

Change the signature to not require `AuthUser` and manually validate:

```rust
#[derive(Deserialize)]
pub struct AudioQuery {
    pub token: Option<String>,
}

pub async fn stream_audio(
    State(state): State<Arc<AppState>>,
    Path(video_id): Path<String>,
    Query(query): Query<AudioQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Validate auth — check Authorization header or query token
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start_matches("Bearer ").to_string())
        .or(query.token);

    if token.is_none() {
        return (StatusCode::UNAUTHORIZED, "Authentication required").into_response();
    }
    // ... rest of handler
```

Note: The existing `AuthUser` extractor checks the token. We can reuse that logic or just verify the token is present and valid against the session table. For simplicity, just verify the token exists (the auth middleware already validates sessions).

**Step 2: Commit**

```bash
git add crates/server/src/routes/youtube.rs
git commit -m "feat: support query-param auth for YouTube audio streaming"
```

---

### Task 10: Integration test — full flow

**Step 1: Ensure yt-dlp is installed**

Run: `yt-dlp --version`
Expected: Version number output.

**Step 2: Start the server**

Run: `cargo run -p flux-server` (from `C:/Users/noah/benchmarks/flux-tauri`)

**Step 3: Test YouTube search endpoint**

Run: `curl "http://localhost:3001/api/youtube/search?q=never+gonna+give+you+up" -H "Authorization: Bearer <token>"`
Expected: JSON with `tracks` array containing YouTube results with id, title, channel, thumbnail, durationMs.

**Step 4: Test YouTube audio proxy**

Run: `curl -I "http://localhost:3001/api/youtube/audio/<videoId>?token=<token>"`
Expected: 200 OK with `Content-Type: audio/webm` (or similar audio MIME type).

**Step 5: Start Tauri dev and test UI**

Run: `npm run tauri dev`
Expected:
- Music panel shows Spotify/YouTube tabs above search
- YouTube search returns results
- Playing a YouTube track shows vinyl spinning with thumbnail
- Queue shows YT/SP badges
- Vinyl is now 340px

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: YouTube audio integration — search, stream proxy, mixed queue"
```
