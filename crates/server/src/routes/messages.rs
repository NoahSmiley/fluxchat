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
struct MessageWithAttachments {
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
pub struct SearchQuery {
    pub q: Option<String>,
}

#[derive(Deserialize)]
pub struct ReactionQuery {
    pub ids: Option<String>,
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

    // Batch-fetch attachments for all messages
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
        let all_attachments = query.fetch_all(&state.db).await.unwrap_or_default();
        for att in all_attachments {
            if let Some(ref mid) = att.message_id {
                attachment_map.entry(mid.clone()).or_default().push(att);
            }
        }
    }

    let items_with_attachments: Vec<MessageWithAttachments> = items
        .into_iter()
        .map(|msg| {
            let attachments = attachment_map.remove(&msg.id).unwrap_or_default();
            MessageWithAttachments {
                message: msg,
                attachments,
            }
        })
        .collect();

    Json(serde_json::json!({
        "items": items_with_attachments,
        "cursor": cursor,
        "hasMore": has_more,
    }))
    .into_response()
}

/// GET /api/channels/:channelId/messages/search
pub async fn search_messages(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(channel_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
    let q = match query.q.as_deref() {
        Some(q) if !q.trim().is_empty() => q.trim().to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Missing query"})),
            )
                .into_response()
        }
    };

    // Verify access
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
            Json(serde_json::json!({"error": "Not a member"})),
        )
            .into_response();
    }

    // Try FTS5 search
    let safe_query = q.replace(['\'', '"'], "");
    let fts_ids: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT message_id FROM messages_fts WHERE plaintext MATCH ? LIMIT 50",
    )
    .bind(&safe_query)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if !fts_ids.is_empty() {
        // Build IN clause
        let placeholders: Vec<String> = fts_ids.iter().map(|_| "?".to_string()).collect();
        let in_clause = placeholders.join(",");
        let sql = format!(
            "SELECT * FROM messages WHERE channel_id = ? AND id IN ({}) ORDER BY created_at DESC LIMIT 50",
            in_clause
        );

        let mut query_builder = sqlx::query_as::<_, Message>(&sql).bind(&channel_id);
        for id in &fts_ids {
            query_builder = query_builder.bind(id);
        }

        let items = query_builder.fetch_all(&state.db).await.unwrap_or_default();

        return Json(serde_json::json!({"items": items})).into_response();
    }

    // Fallback: load recent messages and filter in-memory by decoding base64
    let all_msgs = sqlx::query_as::<_, Message>(
        "SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 500",
    )
    .bind(&channel_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let lower_query = q.to_lowercase();
    let mut items: Vec<Message> = all_msgs
        .into_iter()
        .filter(|msg| {
            if let Ok(decoded) = base64_decode(&msg.ciphertext) {
                decoded.to_lowercase().contains(&lower_query)
            } else {
                false
            }
        })
        .take(50)
        .collect();

    items.reverse();

    Json(serde_json::json!({"items": items})).into_response()
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

fn base64_decode(input: &str) -> Result<String, ()> {
    let bytes = base64_decode_bytes(input)?;
    std::str::from_utf8(&bytes)
        .map(|s| s.to_string())
        .map_err(|_| ())
}

fn base64_decode_bytes(input: &str) -> Result<Vec<u8>, ()> {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let input = input.trim_end_matches('=');
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for &byte in input.as_bytes() {
        let val = TABLE.iter().position(|&c| c == byte).ok_or(())? as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }

    Ok(output)
}
