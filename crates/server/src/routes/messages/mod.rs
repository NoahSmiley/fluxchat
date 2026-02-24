mod search;

pub use search::*;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::models::{Attachment, AuthUser, Message, Reaction};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MessageWithAttachments {
    #[serde(flatten)]
    message: Message,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<Attachment>,
}

#[derive(Deserialize)]
pub struct MessageQuery {
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Deserialize)]
pub struct ReactionQuery {
    pub ids: Option<String>,
}

/// Batch-fetch attachments for a list of messages and combine them.
pub(super) fn attach_to_messages(
    mut items: Vec<Message>,
    mut attachment_map: std::collections::HashMap<String, Vec<Attachment>>,
) -> Vec<MessageWithAttachments> {
    items
        .drain(..)
        .map(|msg| {
            let attachments = attachment_map.remove(&msg.id).unwrap_or_default();
            MessageWithAttachments {
                message: msg,
                attachments,
            }
        })
        .collect()
}

/// Build an attachment map from a list of messages.
pub(super) async fn fetch_attachment_map(
    db: &sqlx::SqlitePool,
    items: &[Message],
) -> std::collections::HashMap<String, Vec<Attachment>> {
    let mut attachment_map: std::collections::HashMap<String, Vec<Attachment>> =
        std::collections::HashMap::new();
    if !items.is_empty() {
        let msg_ids: Vec<&str> = items.iter().map(|m| m.id.as_str()).collect();
        let placeholders: Vec<String> = msg_ids.iter().map(|_| "?".to_string()).collect();
        let in_clause = placeholders.join(",");
        let sql = format!(
            "SELECT * FROM attachments WHERE message_id IN ({})",
            in_clause
        );
        let mut query = sqlx::query_as::<_, Attachment>(&sql);
        for id in &msg_ids {
            query = query.bind(id);
        }
        let all_attachments = query.fetch_all(db).await.unwrap_or_default();
        for att in all_attachments {
            if let Some(ref mid) = att.message_id {
                attachment_map.entry(mid.clone()).or_default().push(att);
            }
        }
    }
    attachment_map
}

/// GET /api/channels/:channelId/messages
pub async fn list_messages(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(channel_id): Path<String>,
    Query(query): Query<MessageQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50).min(100);

    // Verify access: channel exists and user is a member of its server
    let server_id = sqlx::query_scalar::<_, String>(
        "SELECT server_id FROM channels WHERE id = ?",
    )
    .bind(&channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let server_id = match server_id {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Channel not found"})),
            )
                .into_response()
        }
    };

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

    let items = if let Some(cursor) = &query.cursor {
        sqlx::query_as::<_, Message>(
            "SELECT * FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(&channel_id)
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as::<_, Message>(
            "SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .bind(&channel_id)
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
    items.reverse(); // chronological order

    let cursor = items.first().map(|m| m.created_at.clone());

    let attachment_map = fetch_attachment_map(&state.db, &items).await;
    let items_with_attachments = attach_to_messages(items, attachment_map);

    Json(serde_json::json!({
        "items": items_with_attachments,
        "cursor": cursor,
        "hasMore": has_more,
    }))
    .into_response()
}

/// GET /api/messages/reactions
pub async fn get_reactions(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(query): Query<ReactionQuery>,
) -> impl IntoResponse {
    let ids: Vec<String> = query
        .ids
        .as_deref()
        .unwrap_or("")
        .split(',')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();

    if ids.is_empty() {
        return Json(Vec::<Reaction>::new()).into_response();
    }

    let placeholders: Vec<String> = ids.iter().map(|_| "?".to_string()).collect();
    let in_clause = placeholders.join(",");
    let sql = format!(
        "SELECT * FROM reactions WHERE message_id IN ({})",
        in_clause
    );

    let mut query_builder = sqlx::query_as::<_, Reaction>(&sql);
    for id in &ids {
        query_builder = query_builder.bind(id);
    }

    let items = query_builder.fetch_all(&state.db).await.unwrap_or_default();

    Json(items).into_response()
}
