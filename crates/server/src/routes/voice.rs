use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, VoiceTokenRequest};
use crate::AppState;

/// POST /api/voice/token
pub async fn get_token(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<VoiceTokenRequest>,
) -> impl IntoResponse {
    // Verify channel exists and is a voice channel
    let channel = sqlx::query_as::<_, (String, String)>(
        "SELECT server_id, type FROM channels WHERE id = ?",
    )
    .bind(&body.channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (server_id, channel_type) = match channel {
        Some(c) => c,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Channel not found"})),
            )
                .into_response()
        }
    };

    if channel_type != "voice" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Not a voice channel"})),
        )
            .into_response();
    }

    // Verify membership
    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if is_member == 0 {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not a member of this server"})),
        )
            .into_response();
    }

    // Check LiveKit is configured
    if state.config.livekit_api_key.is_empty() || state.config.livekit_api_secret.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": "LiveKit not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET in .env"})),
        )
            .into_response();
    }

    // Generate LiveKit access token
    let is_viewer = body.viewer.unwrap_or(false);
    let identity = if is_viewer {
        format!("{}-viewer", user.id)
    } else {
        user.id.clone()
    };
    let name = if is_viewer {
        format!("{} (viewer)", user.username)
    } else {
        user.username.clone()
    };

    let token = livekit_api::access_token::AccessToken::with_api_key(
        &state.config.livekit_api_key,
        &state.config.livekit_api_secret,
    )
    .with_identity(&identity)
    .with_name(&name)
    .with_grants(livekit_api::access_token::VideoGrants {
        room_join: true,
        room: body.channel_id.clone(),
        can_publish: !is_viewer,
        can_subscribe: true,
        ..Default::default()
    })
    .to_jwt();

    match token {
        Ok(jwt) => Json(serde_json::json!({
            "token": jwt,
            "url": state.config.livekit_url,
        }))
        .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to generate token"})),
        )
            .into_response(),
    }
}
