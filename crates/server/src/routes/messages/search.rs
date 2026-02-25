use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{AuthUser, Message};
use crate::AppState;

use super::{attach_to_messages, fetch_attachment_map};

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
    let fts_query = sanitize_fts_query(&search_query);

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

    let fts_query: Option<String> = if has_q {
        let raw = query.q.as_deref().unwrap().trim();
        let sanitized = sanitize_fts_query(raw);
        if sanitized.is_empty() { None } else { Some(sanitized) }
    } else {
        None
    };

    if fts_query.is_none() && !has_filters {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Provide a search query or at least one filter"})),
        )
            .into_response();
    }

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

    fn is_valid_date(s: &str) -> bool {
        s.len() == 10
            && s.chars().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }
            })
    }

    if let Some(ref d) = query.before {
        if is_valid_date(d) {
            qb.push(" AND m.created_at < ");
            qb.push_bind(d.clone());
        }
    }

    if let Some(ref d) = query.on {
        if is_valid_date(d) {
            qb.push(" AND m.created_at >= ");
            qb.push_bind(d.clone());
            qb.push(" AND m.created_at < date(");
            qb.push_bind(d.clone());
            qb.push(", '+1 day')");
        }
    }

    if let Some(ref d) = query.after {
        if is_valid_date(d) {
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

    let attachment_map = fetch_attachment_map(&state.db, &items).await;
    let items_with_attachments = attach_to_messages(items, attachment_map);

    Json(serde_json::json!({"items": items_with_attachments})).into_response()
}

fn sanitize_fts_query(raw: &str) -> String {
    raw.split_whitespace()
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
        .join(" ")
}
