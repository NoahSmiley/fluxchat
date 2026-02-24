mod favorites;

pub use favorites::*;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

// ── Request / response types ──────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct AttachmentCheck {
    id: String,
    filename: String,
    content_type: String,
    size: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomEmojiRow {
    pub id: String,
    pub server_id: String,
    pub name: String,
    pub attachment_id: String,
    pub filename: String,
    pub uploader_id: String,
    pub uploader_username: String,
    pub uploader_image: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEmojiRequest {
    pub name: String,
    pub attachment_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteStandardRequest {
    pub emoji: String,
}

// ── Per-server admin check ────────────────────────────────────────────────

async fn require_server_admin(
    state: &AppState,
    user_id: &str,
    server_id: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match role.as_deref() {
        Some("owner") | Some("admin") => Ok(()),
        _ => Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Insufficient permissions"})),
        )),
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────

/// GET /api/servers/:serverId/emojis
/// Any server member can list custom emojis.
pub async fn list_emojis(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
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

    let emojis = sqlx::query_as::<_, CustomEmojiRow>(
        r#"SELECT
            ce.id,
            ce.server_id,
            ce.name,
            ce.attachment_id,
            ce.filename,
            ce.uploader_id,
            COALESCE(u.username, 'Unknown') AS uploader_username,
            u.image AS uploader_image,
            ce.created_at
           FROM custom_emojis ce
           JOIN "user" u ON u.id = ce.uploader_id
           WHERE ce.server_id = ?
           ORDER BY ce.created_at ASC"#,
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(emojis).into_response()
}

/// POST /api/servers/:serverId/emojis
/// Owner or admin only.
pub async fn create_emoji(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Json(body): Json<CreateEmojiRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_server_admin(&state, &user.id, &server_id).await {
        return resp.into_response();
    }

    // Validate name: alphanumeric + underscore, 1-32 chars
    let name = body.name.trim().to_string();
    if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_') || name.len() > 32 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Name must be 1-32 alphanumeric/underscore characters"})),
        )
            .into_response();
    }

    // Verify attachment belongs to uploader, is an image, and is within size limit (256KB)
    let attachment = sqlx::query_as::<_, AttachmentCheck>(
        "SELECT id, filename, content_type, size FROM attachments WHERE id = ? AND uploader_id = ?",
    )
    .bind(&body.attachment_id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let attachment = match attachment {
        Some(a) => a,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid attachment"})),
            )
                .into_response();
        }
    };

    if !attachment.content_type.starts_with("image/") {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Attachment must be an image"})),
        )
            .into_response();
    }

    if attachment.size > 262144 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Image must be 256KB or smaller"})),
        )
            .into_response();
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let result = sqlx::query(
        "INSERT INTO custom_emojis (id, server_id, name, attachment_id, filename, uploader_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&server_id)
    .bind(&name)
    .bind(&attachment.id)
    .bind(&attachment.filename)
    .bind(&user.id)
    .bind(&now)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to create custom emoji: {:?}", e);
        let msg = if e.to_string().contains("UNIQUE") {
            "An emoji with that name already exists in this server"
        } else {
            "Failed to create emoji"
        };
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": msg})),
        )
            .into_response();
    }

    // Re-fetch with JOINs
    let emoji = sqlx::query_as::<_, CustomEmojiRow>(
        r#"SELECT
            ce.id,
            ce.server_id,
            ce.name,
            ce.attachment_id,
            ce.filename,
            ce.uploader_id,
            COALESCE(u.username, 'Unknown') AS uploader_username,
            u.image AS uploader_image,
            ce.created_at
           FROM custom_emojis ce
           JOIN "user" u ON u.id = ce.uploader_id
           WHERE ce.id = ?"#,
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match emoji {
        Some(e) => (StatusCode::CREATED, Json(e)).into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// DELETE /api/servers/:serverId/emojis/:emojiId
/// Owner or admin only.
pub async fn delete_emoji(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, emoji_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(resp) = require_server_admin(&state, &user.id, &server_id).await {
        return resp.into_response();
    }

    sqlx::query(
        "DELETE FROM custom_emojis WHERE id = ? AND server_id = ?",
    )
    .bind(&emoji_id)
    .bind(&server_id)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}
