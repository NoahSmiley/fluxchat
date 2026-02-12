use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{
    AddToQueueRequest, AuthUser, ListeningSession, QueueItem, SpotifyAccountInfo,
    SpotifyCallbackRequest,
};
use crate::ws::events::ServerEvent;
use crate::AppState;

const SPOTIFY_TOKEN_URL: &str = "https://accounts.spotify.com/api/token";

// ── OAuth ──

/// GET /api/spotify/auth-info
pub async fn get_auth_info(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let row = sqlx::query_as::<_, (String,)>(
        r#"SELECT COALESCE(scope, '') FROM "account" WHERE userId = ? AND providerId = 'spotify'"#,
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match row {
        Some(_) => {
            let display_name = sqlx::query_scalar::<_, Option<String>>(
                r#"SELECT accountId FROM "account" WHERE userId = ? AND providerId = 'spotify'"#,
            )
            .bind(&user.id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .flatten();

            Json(SpotifyAccountInfo {
                linked: true,
                display_name,
            })
            .into_response()
        }
        None => Json(SpotifyAccountInfo {
            linked: false,
            display_name: None,
        })
        .into_response(),
    }
}

/// POST /api/spotify/init-auth — Store PKCE code_verifier before opening browser
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitAuthRequest {
    pub code_verifier: String,
}

pub async fn init_auth(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<InitAuthRequest>,
) -> impl IntoResponse {
    let nonce = uuid::Uuid::new_v4().to_string();
    let mut pending = state.spotify_auth_pending.write().await;
    // Clean up any old entries for this user
    pending.retain(|_, (uid, _)| uid != &user.id);
    pending.insert(nonce.clone(), (user.id.clone(), body.code_verifier));
    drop(pending);

    let redirect_uri = std::env::var("SPOTIFY_REDIRECT_URI")
        .unwrap_or_else(|_| "http://127.0.0.1:3001/api/spotify/callback".to_string());

    Json(serde_json::json!({
        "state": nonce,
        "redirectUri": redirect_uri,
    }))
    .into_response()
}

/// GET /api/spotify/callback — Browser redirect from Spotify OAuth
#[derive(Deserialize)]
pub struct SpotifyOAuthQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

pub async fn spotify_callback_get(
    Query(query): Query<SpotifyOAuthQuery>,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    if let Some(error) = &query.error {
        return Html(format!(
            r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
            <div style="text-align:center"><h2>Spotify Authorization Failed</h2><p>{}</p><p>You can close this tab.</p></div></body></html>"#,
            error
        ))
        .into_response();
    }

    let code = match &query.code {
        Some(c) => c.clone(),
        None => {
            return Html(
                r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center"><h2>Missing authorization code</h2></div></body></html>"#.to_string(),
            )
            .into_response();
        }
    };

    let nonce = match &query.state {
        Some(s) => s.clone(),
        None => {
            return Html(
                r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center"><h2>Missing state parameter</h2></div></body></html>"#.to_string(),
            )
            .into_response();
        }
    };

    // Look up pending auth by nonce
    let pending_entry = {
        let mut pending = state.spotify_auth_pending.write().await;
        pending.remove(&nonce)
    };

    let (user_id, code_verifier) = match pending_entry {
        Some(entry) => entry,
        None => {
            return Html(
                r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center"><h2>Auth session expired</h2><p>Please try linking again from the app.</p></div></body></html>"#.to_string(),
            )
            .into_response();
        }
    };

    let client_id = std::env::var("SPOTIFY_CLIENT_ID").unwrap_or_default();
    let redirect_uri = std::env::var("SPOTIFY_REDIRECT_URI")
        .unwrap_or_else(|_| "http://127.0.0.1:3001/api/spotify/callback".to_string());

    if client_id.is_empty() {
        return Html(
            r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
            <div style="text-align:center"><h2>Server misconfigured</h2><p>SPOTIFY_CLIENT_ID not set.</p></div></body></html>"#.to_string(),
        )
        .into_response();
    }

    // Exchange code for tokens using PKCE
    let client = reqwest::Client::new();
    let res = client
        .post(SPOTIFY_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", client_id.as_str()),
            ("code_verifier", code_verifier.as_str()),
        ])
        .send()
        .await;

    let token_data: SpotifyTokenResponse = match res {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(t) => t,
            Err(_) => {
                return Html(
                    r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                    <div style="text-align:center"><h2>Failed to parse Spotify response</h2></div></body></html>"#.to_string(),
                )
                .into_response();
            }
        },
        Ok(r) => {
            let body = r.text().await.unwrap_or_default();
            return Html(format!(
                r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center"><h2>Spotify token exchange failed</h2><p style="color:#888">{}</p></div></body></html>"#,
                body
            ))
            .into_response();
        }
        Err(e) => {
            return Html(format!(
                r#"<html><body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
                <div style="text-align:center"><h2>Network error</h2><p>{}</p></div></body></html>"#,
                e
            ))
            .into_response();
        }
    };

    // Fetch Spotify user profile
    let display_name = match client
        .get("https://api.spotify.com/v1/me")
        .bearer_auth(&token_data.access_token)
        .send()
        .await
    {
        Ok(r) => r
            .json::<SpotifyProfile>()
            .await
            .ok()
            .and_then(|p| p.display_name)
            .unwrap_or_default(),
        Err(_) => String::new(),
    };

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(token_data.expires_in);
    let now = chrono::Utc::now().to_rfc3339();
    let account_id = uuid::Uuid::new_v4().to_string();

    // Upsert into account table
    let _ = sqlx::query(
        r#"INSERT INTO "account"
           (id, userId, accountId, providerId, accessToken, refreshToken, accessTokenExpiresAt, scope, createdAt, updatedAt)
           VALUES (?, ?, ?, 'spotify', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(userId, providerId) DO UPDATE SET
             accessToken = excluded.accessToken,
             refreshToken = COALESCE(excluded.refreshToken, "account".refreshToken),
             accessTokenExpiresAt = excluded.accessTokenExpiresAt,
             scope = excluded.scope,
             accountId = excluded.accountId,
             updatedAt = excluded.updatedAt"#,
    )
    .bind(&account_id)
    .bind(&user_id)
    .bind(&display_name)
    .bind(&token_data.access_token)
    .bind(&token_data.refresh_token)
    .bind(expires_at.to_rfc3339())
    .bind(&token_data.scope)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    Html(format!(
        r#"<html>
<head><title>Spotify — Flux</title></head>
<body style="background:#1a1a2e;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
<h2 style="color:#1db954">Spotify Linked Successfully!</h2>
<p>Welcome, {}! You can close this tab and return to Flux.</p>
<script>setTimeout(function(){{ try {{ window.close(); }} catch(e) {{}} }}, 3000);</script>
</div>
</body></html>"#,
        if display_name.is_empty() { "there" } else { &display_name }
    ))
    .into_response()
}

/// POST /api/spotify/callback — Exchange code for tokens (fallback from frontend)
pub async fn spotify_callback_post(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<SpotifyCallbackRequest>,
) -> impl IntoResponse {
    let client_id = std::env::var("SPOTIFY_CLIENT_ID").unwrap_or_default();
    if client_id.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "SPOTIFY_CLIENT_ID not configured"})),
        )
            .into_response();
    }

    let client = reqwest::Client::new();

    let res = client
        .post(SPOTIFY_TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &body.code),
            ("redirect_uri", &body.redirect_uri),
            ("client_id", &client_id),
            ("code_verifier", &body.code_verifier),
        ])
        .send()
        .await;

    let token_data: SpotifyTokenResponse = match res {
        Ok(r) if r.status().is_success() => match r.json().await {
            Ok(t) => t,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Failed to parse token response"})),
                )
                    .into_response()
            }
        },
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Spotify token error ({}): {}", status, body)})),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Network error: {}", e)})),
            )
                .into_response()
        }
    };

    // Fetch Spotify user profile
    let display_name = match client
        .get("https://api.spotify.com/v1/me")
        .bearer_auth(&token_data.access_token)
        .send()
        .await
    {
        Ok(r) => r
            .json::<SpotifyProfile>()
            .await
            .ok()
            .and_then(|p| p.display_name)
            .unwrap_or_default(),
        Err(_) => String::new(),
    };

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(token_data.expires_in);
    let now = chrono::Utc::now().to_rfc3339();
    let account_id = uuid::Uuid::new_v4().to_string();

    let _ = sqlx::query(
        r#"INSERT INTO "account"
           (id, userId, accountId, providerId, accessToken, refreshToken, accessTokenExpiresAt, scope, createdAt, updatedAt)
           VALUES (?, ?, ?, 'spotify', ?, ?, ?, ?, ?, ?)
           ON CONFLICT(userId, providerId) DO UPDATE SET
             accessToken = excluded.accessToken,
             refreshToken = COALESCE(excluded.refreshToken, "account".refreshToken),
             accessTokenExpiresAt = excluded.accessTokenExpiresAt,
             scope = excluded.scope,
             accountId = excluded.accountId,
             updatedAt = excluded.updatedAt"#,
    )
    .bind(&account_id)
    .bind(&user.id)
    .bind(&display_name)
    .bind(&token_data.access_token)
    .bind(&token_data.refresh_token)
    .bind(expires_at.to_rfc3339())
    .bind(&token_data.scope)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    Json(serde_json::json!({"success": true, "displayName": display_name})).into_response()
}

/// POST /api/spotify/unlink
pub async fn unlink_spotify(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let _ = sqlx::query(r#"DELETE FROM "account" WHERE userId = ? AND providerId = 'spotify'"#)
        .bind(&user.id)
        .execute(&state.db)
        .await;

    Json(serde_json::json!({"success": true})).into_response()
}

/// GET /api/spotify/token — Return a valid access token (auto-refresh if needed)
pub async fn get_token(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    match get_valid_token(&state.db, &user.id).await {
        Ok(token) => Json(serde_json::json!({"accessToken": token})).into_response(),
        Err(e) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": e})),
        )
            .into_response(),
    }
}

// ── Search ──

#[derive(Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
}

/// GET /api/spotify/search?q=...
pub async fn search_tracks(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let q = match query.q.as_deref() {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => return Json(serde_json::json!({"tracks": {"items": []}})).into_response(),
    };

    let token = match get_valid_token(&state.db, &user.id).await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Spotify token error for search: {}", e);
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": format!("Spotify token error: {}", e)})),
            )
                .into_response()
        }
    };

    let client = reqwest::Client::new();

    match client
        .get("https://api.spotify.com/v1/search")
        .bearer_auth(&token)
        .query(&[("q", q.as_str()), ("type", "track")])
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => {
            let data: serde_json::Value = r.json().await.unwrap_or_default();
            Json(data).into_response()
        }
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::error!("Spotify search failed ({}): {}", status, body);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": format!("Spotify API error ({})", status)})),
            )
                .into_response()
        }
        Err(e) => {
            tracing::error!("Spotify search network error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Search failed"})),
            )
                .into_response()
        }
    }
}

// ── Listening Sessions ──

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub voice_channel_id: String,
}

/// POST /api/spotify/sessions
pub async fn create_session(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateSessionRequest>,
) -> impl IntoResponse {
    let existing = sqlx::query_scalar::<_, String>(
        r#"SELECT id FROM "listening_sessions" WHERE voice_channel_id = ?"#,
    )
    .bind(&body.voice_channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some(id) = existing {
        return Json(serde_json::json!({"sessionId": id, "existing": true})).into_response();
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query(
        r#"INSERT INTO "listening_sessions" (id, voice_channel_id, host_user_id, current_track_position_ms, is_playing, created_at, updated_at)
           VALUES (?, ?, ?, 0, 0, ?, ?)"#,
    )
    .bind(&id)
    .bind(&body.voice_channel_id)
    .bind(&user.id)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    Json(serde_json::json!({"sessionId": id})).into_response()
}

/// GET /api/spotify/sessions/:voiceChannelId
pub async fn get_session(
    _user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(voice_channel_id): Path<String>,
) -> impl IntoResponse {
    let session = sqlx::query_as::<_, ListeningSession>(
        r#"SELECT * FROM "listening_sessions" WHERE voice_channel_id = ?"#,
    )
    .bind(&voice_channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match session {
        Some(s) => {
            let queue = sqlx::query_as::<_, QueueItem>(
                r#"SELECT * FROM "session_queue" WHERE session_id = ? ORDER BY position ASC"#,
            )
            .bind(&s.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            Json(serde_json::json!({"session": s, "queue": queue})).into_response()
        }
        None => Json(serde_json::json!({"session": null, "queue": []})).into_response(),
    }
}

/// POST /api/spotify/sessions/:sessionId/queue
pub async fn add_to_queue(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(body): Json<AddToQueueRequest>,
) -> impl IntoResponse {
    let max_pos = sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(MAX(position), -1) FROM "session_queue" WHERE session_id = ?"#,
    )
    .bind(&session_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(-1);

    let item_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let position = max_pos + 1;

    let _ = sqlx::query(
        r#"INSERT INTO "session_queue"
           (id, session_id, track_uri, track_name, track_artist, track_album, track_image_url, track_duration_ms, added_by_user_id, position, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
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
    .execute(&state.db)
    .await;

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
    };

    let voice_channel_id = sqlx::query_scalar::<_, String>(
        r#"SELECT voice_channel_id FROM "listening_sessions" WHERE id = ?"#,
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();

    state
        .gateway
        .broadcast_all(
            &ServerEvent::SpotifyQueueUpdate {
                session_id,
                voice_channel_id,
                queue_item,
            },
            None,
        )
        .await;

    Json(serde_json::json!({"id": item_id})).into_response()
}

/// DELETE /api/spotify/sessions/:sessionId
pub async fn delete_session(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let session = sqlx::query_as::<_, ListeningSession>(
        r#"SELECT * FROM "listening_sessions" WHERE id = ?"#,
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let session = match session {
        Some(s) if s.host_user_id == user.id => s,
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not the host"})),
            )
                .into_response()
        }
    };

    let _ = sqlx::query(r#"DELETE FROM "listening_sessions" WHERE id = ?"#)
        .bind(&session_id)
        .execute(&state.db)
        .await;

    state
        .gateway
        .broadcast_all(
            &ServerEvent::SpotifySessionEnded {
                session_id,
                voice_channel_id: session.voice_channel_id,
            },
            None,
        )
        .await;

    Json(serde_json::json!({"success": true})).into_response()
}

// ── Token Helpers ──

#[derive(Deserialize)]
struct SpotifyTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    #[serde(default)]
    scope: String,
}

#[derive(Deserialize)]
struct SpotifyProfile {
    display_name: Option<String>,
}

async fn get_valid_token(db: &sqlx::SqlitePool, user_id: &str) -> Result<String, String> {
    let row = sqlx::query_as::<_, (String, String)>(
        r#"SELECT accessToken, COALESCE(accessTokenExpiresAt, '') FROM "account"
           WHERE userId = ? AND providerId = 'spotify'"#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|_| "Database error".to_string())?
    .ok_or_else(|| "Spotify not linked".to_string())?;

    let (token, expires_at) = row;

    let now = chrono::Utc::now();
    let is_expired = if expires_at.is_empty() {
        true
    } else {
        chrono::DateTime::parse_from_rfc3339(&expires_at)
            .map(|e| now > e - chrono::Duration::minutes(5))
            .unwrap_or(true)
    };

    if is_expired {
        refresh_user_token(db, user_id).await?;
        let new_token = sqlx::query_scalar::<_, String>(
            r#"SELECT accessToken FROM "account" WHERE userId = ? AND providerId = 'spotify'"#,
        )
        .bind(user_id)
        .fetch_one(db)
        .await
        .map_err(|_| "Failed to fetch refreshed token".to_string())?;
        Ok(new_token)
    } else {
        Ok(token)
    }
}

async fn refresh_user_token(db: &sqlx::SqlitePool, user_id: &str) -> Result<(), String> {
    let refresh_token = sqlx::query_scalar::<_, String>(
        r#"SELECT refreshToken FROM "account" WHERE userId = ? AND providerId = 'spotify'"#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|_| "Database error".to_string())?
    .ok_or_else(|| "No refresh token".to_string())?;

    let client_id =
        std::env::var("SPOTIFY_CLIENT_ID").map_err(|_| "No SPOTIFY_CLIENT_ID".to_string())?;

    let client = reqwest::Client::new();
    let res = client
        .post(SPOTIFY_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        tracing::error!("Spotify token refresh failed ({}): {}", status, body);
        return Err(format!("Token refresh failed ({})", status));
    }

    let token_data: SpotifyTokenResponse =
        res.json().await.map_err(|_| "Parse error".to_string())?;

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(token_data.expires_in);
    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query(
        r#"UPDATE "account" SET
           accessToken = ?,
           refreshToken = COALESCE(?, refreshToken),
           accessTokenExpiresAt = ?,
           updatedAt = ?
           WHERE userId = ? AND providerId = 'spotify'"#,
    )
    .bind(&token_data.access_token)
    .bind(&token_data.refresh_token)
    .bind(expires_at.to_rfc3339())
    .bind(&now)
    .bind(user_id)
    .execute(db)
    .await;

    Ok(())
}
