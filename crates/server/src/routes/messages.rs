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
    pub sender_id: Option<String>,
    pub channel_id: Option<String>,
    pub has: Option<String>,
    pub mentions_username: Option<String>,
    pub before: Option<String>,
    pub on: Option<String>,
    pub after: Option<String>,
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
    let search_query = match query.q.as_deref() {
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

    // Sanitize query for FTS5: strip special chars, append * for prefix matching
    // e.g. "web" → "web*" which matches "web", "webster", "website", etc.
    let fts_query: String = search_query
        .split_whitespace()
        .filter_map(|word| {
            let clean: String = word
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '\'')
                .collect();
            if clean.is_empty() {
                None
            } else {
                Some(format!("{}*", clean))
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    // Server-side full-text search via FTS5
    let items = match sqlx::query_as::<_, Message>(
        "SELECT m.* FROM messages m
         INNER JOIN (
           SELECT message_id, rank FROM messages_fts WHERE messages_fts MATCH ?
         ) fts ON fts.message_id = m.id
         WHERE m.channel_id = ?
         ORDER BY fts.rank
         LIMIT 50",
    )
    .bind(&fts_query)
    .bind(&channel_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("FTS search error: {:?}", e);
            Vec::new()
        }
    };

    Json(serde_json::json!({"items": items})).into_response()
}

/// GET /api/servers/:serverId/messages/search
pub async fn search_server_messages(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> impl IntoResponse {
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
            Json(serde_json::json!({"error": "Not a member"})),
        )
            .into_response();
    }

    let has_q = query.q.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
    let has_filters = query.sender_id.is_some()
        || query.channel_id.is_some()
        || query.has.is_some()
        || query.mentions_username.is_some()
        || query.before.is_some()
        || query.on.is_some()
        || query.after.is_some();

    if !has_q && !has_filters {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Provide a search query or at least one filter"})),
        )
            .into_response();
    }

    // Sanitize FTS query: strip special chars, append * for prefix matching
    let fts_query: Option<String> = if has_q {
        let raw = query.q.as_deref().unwrap().trim();
        let sanitized: String = raw
            .split_whitespace()
            .filter_map(|word| {
                let clean: String = word
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '\'')
                    .collect();
                if clean.is_empty() { None } else { Some(format!("{}*", clean)) }
            })
            .collect::<Vec<_>>()
            .join(" ");
        if sanitized.is_empty() { None } else { Some(sanitized) }
    } else {
        None
    };

    // Need at least one constraint after sanitization
    if fts_query.is_none() && !has_filters {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Provide a search query or at least one filter"})),
        )
            .into_response();
    }

    // Build dynamic SQL with QueryBuilder
    let mut qb: sqlx::QueryBuilder<sqlx::Sqlite> = sqlx::QueryBuilder::new(
        "SELECT m.id, m.channel_id, m.sender_id, m.content, m.created_at, m.edited_at \
         FROM messages m \
         INNER JOIN channels c ON c.id = m.channel_id \
         WHERE c.server_id = ",
    );
    qb.push_bind(&server_id);

    if let Some(ref fts) = fts_query {
        qb.push(" AND m.id IN (SELECT message_id FROM messages_fts WHERE messages_fts MATCH ");
        qb.push_bind(fts.clone());
        qb.push(")");
    }

    if let Some(ref uid) = query.sender_id {
        qb.push(" AND m.sender_id = ");
        qb.push_bind(uid.clone());
    }

    if let Some(ref ch) = query.channel_id {
        qb.push(" AND m.channel_id = ");
        qb.push_bind(ch.clone());
    }

    match query.has.as_deref() {
        Some("image") => { qb.push(" AND EXISTS(SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'image/%')"); }
        Some("video") => { qb.push(" AND EXISTS(SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'video/%')"); }
        Some("sound") => { qb.push(" AND EXISTS(SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'audio/%')"); }
        Some("link")  => { qb.push(" AND (m.content LIKE '%http://%' OR m.content LIKE '%https://%')"); }
        Some("file")  => { qb.push(" AND EXISTS(SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type NOT LIKE 'image/%' AND a.content_type NOT LIKE 'video/%' AND a.content_type NOT LIKE 'audio/%')"); }
        Some("event") => { qb.push(" AND 0=1"); } // placeholder — no events yet
        _ => {}
    }

    if let Some(ref username) = query.mentions_username {
        qb.push(" AND m.content LIKE ");
        qb.push_bind(format!("%@{}%", username));
    }

    // Date filters — validate YYYY-MM-DD format before using
    fn is_valid_date(s: &str) -> bool {
        s.len() == 10
            && s.chars().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }
            })
    }

    if let Some(ref d) = query.before {
        if is_valid_date(d) {
            // messages created before the start of that day
            qb.push(" AND m.created_at < ");
            qb.push_bind(d.clone());
        }
    }

    if let Some(ref d) = query.on {
        if is_valid_date(d) {
            // messages created on that day: >= 'YYYY-MM-DD' AND < 'YYYY-MM-DD+1'
            qb.push(" AND m.created_at >= ");
            qb.push_bind(d.clone());
            qb.push(" AND m.created_at < date(");
            qb.push_bind(d.clone());
            qb.push(", '+1 day')");
        }
    }

    if let Some(ref d) = query.after {
        if is_valid_date(d) {
            // messages created after that day (from the next day onwards)
            qb.push(" AND m.created_at >= date(");
            qb.push_bind(d.clone());
            qb.push(", '+1 day')");
        }
    }

    qb.push(" ORDER BY m.created_at DESC LIMIT 50");

    let items: Vec<Message> = match qb.build_query_as::<Message>().fetch_all(&state.db).await {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Search error: {:?}", e);
            Vec::new()
        }
    };

    // Batch-fetch attachments for search results
    let mut attachment_map: std::collections::HashMap<String, Vec<Attachment>> =
        std::collections::HashMap::new();
    if !items.is_empty() {
        let msg_ids: Vec<&str> = items.iter().map(|m| m.id.as_str()).collect();
        let placeholders: Vec<String> = msg_ids.iter().map(|_| "?".to_string()).collect();
        let in_clause = placeholders.join(",");
        let sql = format!("SELECT * FROM attachments WHERE message_id IN ({})", in_clause);
        let mut att_query = sqlx::query_as::<_, Attachment>(&sql);
        for id in &msg_ids {
            att_query = att_query.bind(id);
        }
        let all_attachments = att_query.fetch_all(&state.db).await.unwrap_or_default();
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
            MessageWithAttachments { message: msg, attachments }
        })
        .collect();

    Json(serde_json::json!({"items": items_with_attachments})).into_response()
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

