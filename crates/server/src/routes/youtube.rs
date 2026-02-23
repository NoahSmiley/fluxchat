use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::models::AuthUser;
use crate::AppState;

const CACHE_TTL_SECS: u64 = 30 * 60; // 30 minutes

/// Resolve the yt-dlp binary path. Checks next to the server executable first,
/// then falls back to bare "yt-dlp" (relies on PATH).
fn yt_dlp_path() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Walk up from e.g. target/debug/ to project root
            for ancestor in [dir, dir.parent().unwrap_or(dir), dir.parent().and_then(|p| p.parent()).unwrap_or(dir)] {
                let candidate = ancestor.join("yt-dlp.exe");
                if candidate.exists() {
                    return candidate;
                }
                let candidate = ancestor.join("yt-dlp");
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }
    std::path::PathBuf::from("yt-dlp")
}

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
    tracing::info!("YouTube search: q=\"{}\"", q);
    let output = match tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new(yt_dlp_path())
            .args(["--dump-json", "--flat-playlist", "--no-warnings", &search_query])
            .output(),
    )
    .await
    {
        Ok(Ok(o)) if o.status.success() => o.stdout,
        Ok(Ok(o)) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            tracing::error!("yt-dlp search failed (exit {}): {}", o.status, stderr);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("YouTube search failed: {}", stderr.chars().take(200).collect::<String>())}))).into_response();
        }
        Ok(Err(e)) => {
            tracing::error!("Failed to run yt-dlp: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("yt-dlp not available: {}", e)}))).into_response();
        }
        Err(_) => {
            tracing::error!("yt-dlp search timed out after 15s for q=\"{}\"", q);
            return (StatusCode::GATEWAY_TIMEOUT, Json(serde_json::json!({"error": "YouTube search timed out"}))).into_response();
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

    tracing::info!("YouTube search: q=\"{}\" results={}", q, tracks.len());
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
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new(yt_dlp_path())
            .args(["-f", "bestaudio", "--get-url", "--no-warnings", &yt_url])
            .output(),
    )
    .await
    .map_err(|_| "yt-dlp timed out after 15s".to_string())?
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

#[derive(Deserialize)]
pub struct AudioQuery {
    pub token: Option<String>,
}

/// GET /api/youtube/audio/{videoId}
/// Supports auth via Authorization header OR ?token= query param (needed for HTML audio elements)
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

    // Validate video ID (alphanumeric + dash/underscore, max 20 chars)
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
