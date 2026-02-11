use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{AuthUser, CreateDmRequest, DmChannelResponse, DmMessage, DmOtherUser, PaginatedResponse};
use crate::AppState;

#[derive(Deserialize)]
pub struct DmMessageQuery {
    pub cursor: Option<String>,
}

#[derive(Deserialize)]
pub struct UserSearchQuery {
    pub q: Option<String>,
}

/// GET /api/dms
pub async fn list_dms(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let channels = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT id, user1_id, user2_id, created_at FROM dm_channels WHERE user1_id = ? OR user2_id = ?",
    )
    .bind(&user.id)
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut result = Vec::new();
    for (id, user1_id, user2_id, created_at) in channels {
        let other_user_id = if user1_id == user.id {
            &user2_id
        } else {
            &user1_id
        };

        let other = sqlx::query_as::<_, (String, String, Option<String>)>(
            r#"SELECT id, username, image FROM "user" WHERE id = ?"#,
        )
        .bind(other_user_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        if let Some((oid, ousername, oimage)) = other {
            result.push(DmChannelResponse {
                id,
                other_user: DmOtherUser {
                    id: oid,
                    username: ousername,
                    image: oimage,
                },
                created_at,
            });
        }
    }

    Json(result).into_response()
}

/// POST /api/dms
pub async fn create_dm(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<CreateDmRequest>,
) -> impl IntoResponse {
    if body.user_id == user.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Cannot DM yourself"})),
        )
            .into_response();
    }

    // Check target exists
    let target = sqlx::query_as::<_, (String, String, Option<String>)>(
        r#"SELECT id, username, image FROM "user" WHERE id = ?"#,
    )
    .bind(&body.user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (target_id, target_username, target_image) = match target {
        Some(t) => t,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "User not found"})),
            )
                .into_response()
        }
    };

    // Sort IDs for consistent storage
    let (id1, id2) = if user.id < body.user_id {
        (&user.id, &body.user_id)
    } else {
        (&body.user_id, &user.id)
    };

    // Check for existing channel
    let existing = sqlx::query_as::<_, (String, String)>(
        "SELECT id, created_at FROM dm_channels WHERE user1_id = ? AND user2_id = ?",
    )
    .bind(id1)
    .bind(id2)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some((channel_id, created_at)) = existing {
        return Json(DmChannelResponse {
            id: channel_id,
            other_user: DmOtherUser {
                id: target_id,
                username: target_username,
                image: target_image,
            },
            created_at,
        })
        .into_response();
    }

    // Create new channel
    let channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query(
        "INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&channel_id)
    .bind(id1)
    .bind(id2)
    .bind(&now)
    .execute(&state.db)
    .await;

    Json(DmChannelResponse {
        id: channel_id,
        other_user: DmOtherUser {
            id: target_id,
            username: target_username,
            image: target_image,
        },
        created_at: now,
    })
    .into_response()
}

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

/// GET /api/users/search
pub async fn search_users(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
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
        .filter(|(id, _)| id != &user.id)
        .map(|(id, username)| serde_json::json!({"id": id, "username": username}))
        .collect();

    Json(items).into_response()
}
