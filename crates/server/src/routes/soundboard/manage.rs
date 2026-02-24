use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

use super::{require_server_admin, SoundboardSoundRow, UpdateSoundRequest};

/// PATCH /api/servers/:serverId/soundboard/:soundId
/// Owner or admin only. Updates name, emoji, image, and volume.
pub async fn update_sound(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, sound_id)): Path<(String, String)>,
    Json(body): Json<UpdateSoundRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_server_admin(&state, &user.id, &server_id).await {
        return resp.into_response();
    }

    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Name is required"})),
        )
            .into_response();
    }

    let volume = body.volume.clamp(0.0, 1.0);

    let result = sqlx::query(
        "UPDATE soundboard_sounds SET name = ?, emoji = ?, volume = ? WHERE id = ? AND server_id = ?",
    )
    .bind(&name)
    .bind(&body.emoji)
    .bind(volume)
    .bind(&sound_id)
    .bind(&server_id)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to update soundboard sound: {:?}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to update sound"})),
        )
            .into_response();
    }

    let sound = sqlx::query_as::<_, SoundboardSoundRow>(
        r#"SELECT
            s.id,
            s.server_id,
            s.name,
            s.emoji,
            s.audio_attachment_id,
            a_audio.filename AS audio_filename,
            s.volume,
            s.created_by,
            COALESCE(u.username, 'Unknown') AS creator_username,
            s.created_at,
            FALSE AS favorited
           FROM soundboard_sounds s
           JOIN attachments a_audio ON a_audio.id = s.audio_attachment_id
           LEFT JOIN "user" u ON u.id = s.created_by
           WHERE s.id = ?"#,
    )
    .bind(&sound_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match sound {
        Some(s) => Json(s).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// POST /api/servers/:serverId/soundboard/:soundId/favorite
/// Any server member can favorite a sound.
pub async fn favorite_sound(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, sound_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;

    if !is_member {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not a member of this server"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO soundboard_favorites (user_id, sound_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(&user.id)
    .bind(&sound_id)
    .bind(&now)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/servers/:serverId/soundboard/:soundId/favorite
/// Any server member can unfavorite a sound.
pub async fn unfavorite_sound(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((_server_id, sound_id)): Path<(String, String)>,
) -> impl IntoResponse {
    sqlx::query(
        "DELETE FROM soundboard_favorites WHERE user_id = ? AND sound_id = ?",
    )
    .bind(&user.id)
    .bind(&sound_id)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/servers/:serverId/soundboard/:soundId
/// Owner or admin only.
pub async fn delete_sound(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, sound_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(resp) = require_server_admin(&state, &user.id, &server_id).await {
        return resp.into_response();
    }

    sqlx::query(
        "DELETE FROM soundboard_sounds WHERE id = ? AND server_id = ?",
    )
    .bind(&sound_id)
    .bind(&server_id)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}
