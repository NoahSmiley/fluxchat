mod oauth;
mod sessions;
mod token;

pub use oauth::*;
pub use sessions::*;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{AuthUser, SpotifyAccountInfo};
use crate::AppState;

pub(crate) use token::get_valid_token;

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

/// GET /api/spotify/token
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
