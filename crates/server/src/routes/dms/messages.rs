use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, DmMessage, PaginatedResponse};
use crate::AppState;

use super::{DmMessageQuery, UserSearchQuery};

/// GET /api/dms/:dmChannelId/messages
pub async fn list_dm_messages(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(dm_channel_id): Path<String>,
    Query(query): Query<DmMessageQuery>,
) -> impl IntoResponse {
    // Verify user is participant
    let channel = sqlx::query_as::<_, (String, String)>(
        "SELECT user1_id, user2_id FROM dm_channels WHERE id = ?",
    )
    .bind(&dm_channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match channel {
        Some((u1, u2)) if u1 == user.id || u2 == user.id => {}
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not a participant"})),
            )
                .into_response()
        }
    }

    let limit: i64 = 50;

    let items = if let Some(cursor) = &query.cursor {
        sqlx::query_as::<_, DmMessage>(
            "SELECT * FROM dm_messages WHERE dm_channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(&dm_channel_id)
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as::<_, DmMessage>(
            "SELECT * FROM dm_messages WHERE dm_channel_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(&dm_channel_id)
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };

    let has_more = items.len() as i64 > limit;
    let mut items = items;
    if has_more {
        items.pop();
    }
    items.reverse();

    let cursor = items.first().map(|m| m.created_at.clone());

    Json(PaginatedResponse {
        items,
        cursor,
        has_more,
    })
    .into_response()
}

/// GET /api/dms/:dmChannelId/messages/search
pub async fn search_dm_messages(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(dm_channel_id): Path<String>,
    Query(query): Query<UserSearchQuery>,
) -> impl IntoResponse {
    match query.q.as_deref() {
        Some(q) if !q.trim().is_empty() => {},
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Missing query"})),
            )
                .into_response()
        }
    };

    // Verify user is participant
    let channel = sqlx::query_as::<_, (String, String)>(
        "SELECT user1_id, user2_id FROM dm_channels WHERE id = ?",
    )
    .bind(&dm_channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match channel {
        Some((u1, u2)) if u1 == user.id || u2 == user.id => {}
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not a participant"})),
            )
                .into_response()
        }
    }

    // Return raw messages for client-side decryption and filtering (E2EE)
    let mut items = sqlx::query_as::<_, DmMessage>(
        "SELECT * FROM dm_messages WHERE dm_channel_id = ? ORDER BY created_at DESC LIMIT 500",
    )
    .bind(&dm_channel_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    items.reverse();

    Json(serde_json::json!({"items": items})).into_response()
}

/// GET /api/users/search
pub async fn search_users(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(query): Query<UserSearchQuery>,
) -> impl IntoResponse {
    let q = match query.q.as_deref() {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => return Json(Vec::<serde_json::Value>::new()).into_response(),
    };

    let pattern = format!("%{}%", q);
    let results = sqlx::query_as::<_, (String, String)>(
        r#"SELECT id, username FROM "user" WHERE username LIKE ? LIMIT 10"#,
    )
    .bind(&pattern)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let items: Vec<serde_json::Value> = results
        .into_iter()
        .map(|(id, username)| serde_json::json!({"id": id, "username": username}))
        .collect();

    Json(items).into_response()
}
