# YouTube Audio Integration Design

## Overview

Add YouTube audio playback to Flux's listening sessions alongside Spotify. Tracks from both sources coexist in a single mixed queue.

## Architecture: yt-dlp Stream Proxy (Approach B)

Server uses `yt-dlp` to resolve direct audio stream URLs from YouTube, then proxies the audio bytes to clients in real-time. No files saved to disk.

## Backend — `crates/server/src/routes/youtube.rs`

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/youtube/search?q=...` | GET | Search YouTube via `yt-dlp --dump-json "ytsearch5:{query}"`. Returns title, video ID, thumbnail, duration, channel name. |
| `/api/youtube/audio/{videoId}` | GET | Resolve audio URL via `yt-dlp -f bestaudio --get-url`, then proxy the upstream audio stream to the client. Supports `Range` headers for seeking. `Content-Type: audio/webm`. |

### In-Memory URL Cache

`HashMap<String, (String, Instant)>` mapping video_id to (stream_url, fetched_at). URLs reused within a 30-minute window. YouTube URLs expire after ~6 hours, so this is safe. No file I/O.

### yt-dlp Dependency

Expects `yt-dlp` on PATH. Server logs a warning at startup if not found.

## Database Changes — `session_queue` table

- **New column**: `source TEXT NOT NULL DEFAULT 'spotify'` — values: `'spotify'` or `'youtube'`
- `track_uri` repurposed: Spotify keeps `spotify:track:xxx`, YouTube uses the video ID
- `track_album` stores channel name for YouTube tracks
- All other columns (`track_name`, `track_artist`, `track_image_url`, `track_duration_ms`) work for both sources

No new tables needed.

## WebSocket Event Changes

- `SpotifyPlaybackControl` — add `source` field
- `SpotifyPlaybackSync` — add `source` field so clients route to correct player
- `SpotifyQueueUpdate` — queue items carry source in their metadata

## Frontend — Dual Playback Engine

### Playback (`src/stores/spotify.ts`)

- YouTube tracks play via `HTMLAudioElement` with `src = /api/youtube/audio/{videoId}`
- Spotify tracks play via existing Web Playback SDK
- Unified `play()`, `pause()`, `skip()`, `seek()` route to correct player based on `source`
- Switching sources pauses the inactive player
- YouTube progress via `timeupdate`/`duration` events on the audio element
- Group sync: WebSocket `PlaybackSync` events include `source` to route correctly

### UI (`src/components/MusicPanel.tsx`)

- **Search toggle**: Pill/tab above search input — "Spotify" | "YouTube"
- **Queue items**: Small source badge/icon (Spotify green / YouTube red) per entry
- **Now playing**: Vinyl, track info, and controls work identically for both sources. Album art from YouTube thumbnails or Spotify images.
