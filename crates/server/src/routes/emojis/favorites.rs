use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

use super::FavoriteStandardRequest;

/// GET /api/me/emoji-favorites
pub async fn list_emoji_favorites(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let standard: Vec<String> = sqlx::query_scalar(
        "SELECT emoji FROM standard_emoji_favorites WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let custom_ids: Vec<String> = sqlx::query_scalar(
        "SELECT emoji_id FROM custom_emoji_favorites WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(serde_json::json!({
        "standard": standard,
        "customIds": custom_ids,
    }))
    .into_response()
}

/// POST /api/me/emoji-favorites/standard
pub async fn add_standard_favorite(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<FavoriteStandardRequest>,
) -> impl IntoResponse {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO standard_emoji_favorites (user_id, emoji, created_at) VALUES (?, ?, ?)",
    )
    .bind(&user.id)
    .bind(&body.emoji)
    .bind(&now)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/me/emoji-favorites/standard
pub async fn remove_standard_favorite(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<FavoriteStandardRequest>,
) -> impl IntoResponse {
    sqlx::query(
        "DELETE FROM standard_emoji_favorites WHERE user_id = ? AND emoji = ?",
    )
    .bind(&user.id)
    .bind(&body.emoji)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}

/// POST /api/me/emoji-favorites/custom/:emojiId
pub async fn add_custom_favorite(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(emoji_id): Path<String>,
) -> impl IntoResponse {
    // Verify emoji exists (any server)
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM custom_emojis WHERE id = ?",
    )
    .bind(&emoji_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;

    if !exists {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Emoji not found"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO custom_emoji_favorites (user_id, emoji_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(&user.id)
    .bind(&emoji_id)
    .bind(&now)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/me/emoji-favorites/custom/:emojiId
pub async fn remove_custom_favorite(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(emoji_id): Path<String>,
) -> impl IntoResponse {
    sqlx::query(
        "DELETE FROM custom_emoji_favorites WHERE user_id = ? AND emoji_id = ?",
    )
    .bind(&user.id)
    .bind(&emoji_id)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}
