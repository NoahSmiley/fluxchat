use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{AuthUser, SpotifyCallbackRequest};
use crate::AppState;

use super::token::{SpotifyProfile, SpotifyTokenResponse, SPOTIFY_TOKEN_URL};

/// POST /api/spotify/init-auth
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

/// GET /api/spotify/callback
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

    let display_name = fetch_display_name(&client, &token_data.access_token).await;
    upsert_spotify_account(&state.db, &user_id, &display_name, &token_data).await;

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

/// POST /api/spotify/callback
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

    let display_name = fetch_display_name(&client, &token_data.access_token).await;
    upsert_spotify_account(&state.db, &user.id, &display_name, &token_data).await;

    Json(serde_json::json!({"success": true, "displayName": display_name})).into_response()
}

async fn fetch_display_name(client: &reqwest::Client, access_token: &str) -> String {
    match client
        .get("https://api.spotify.com/v1/me")
        .bearer_auth(access_token)
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
    }
}

async fn upsert_spotify_account(
    db: &sqlx::SqlitePool,
    user_id: &str,
    display_name: &str,
    token_data: &SpotifyTokenResponse,
) {
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
    .bind(user_id)
    .bind(display_name)
    .bind(&token_data.access_token)
    .bind(&token_data.refresh_token)
    .bind(expires_at.to_rfc3339())
    .bind(&token_data.scope)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await;
}
