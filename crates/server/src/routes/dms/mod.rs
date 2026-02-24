mod messages;

pub use messages::*;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{AuthUser, CreateDmRequest, DmChannelResponse, DmOtherUser};
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
