use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, Channel, CreateChannelRequest};
use crate::AppState;

/// GET /api/servers/:serverId/channels
pub async fn list_channels(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    let membership = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if membership == 0 {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not a member of this server"})),
        )
            .into_response();
    }

    let channels = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, created_at ASC")
        .bind(&server_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    Json(channels).into_response()
}

/// POST /api/servers/:serverId/channels
pub async fn create_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Json(body): Json<CreateChannelRequest>,
) -> impl IntoResponse {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    // Rooms: any server member can create; regular channels require admin/owner
    if body.is_room {
        if role.is_none() {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not a member of this server"})),
            )
                .into_response();
        }
    } else {
        match role.as_deref() {
            Some("owner") | Some("admin") => {}
            _ => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({"error": "Insufficient permissions"})),
                )
                    .into_response()
            }
        }
    }

    // Rooms are always voice with no parent
    let channel_type = if body.is_room { "voice".to_string() } else { body.channel_type.clone() };
    let parent_id_input = if body.is_room { None } else { body.parent_id.clone() };

    if !["text", "voice", "game", "category"].contains(&channel_type.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Invalid channel type"}))).into_response();
    }

    // Rooms allow free-form names; regular channels use strict validation
    if body.is_room {
        let trimmed = body.name.trim();
        if trimmed.is_empty() || trimmed.len() > 64 {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Room name must be 1-64 characters"}))).into_response();
        }
    } else if let Err(e) = flux_shared::validation::validate_channel_name(&body.name) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
    }

    // Validate parent_id if provided
    let parent_id = if let Some(ref pid) = parent_id_input {
        let parent = sqlx::query_as::<_, Channel>(
            "SELECT * FROM channels WHERE id = ? AND server_id = ?",
        )
        .bind(pid)
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        match parent {
            Some(p) => {
                if p.channel_type != "category" {
                    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Parent must be a category"}))).into_response();
                }
                // Check nesting depth (max 3 levels of categories)
                if body.channel_type == "category" {
                    let mut depth = 1;
                    let mut current_parent = Some(pid.clone());
                    while let Some(ref cpid) = current_parent {
                        depth += 1;
                        if depth > 3 {
                            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Maximum category nesting depth is 3"}))).into_response();
                        }
                        let pp = sqlx::query_scalar::<_, Option<String>>(
                            "SELECT parent_id FROM channels WHERE id = ?",
                        )
                        .bind(cpid)
                        .fetch_optional(&state.db)
                        .await
                        .ok()
                        .flatten()
                        .flatten();
                        current_parent = pp;
                    }
                }
                Some(pid.clone())
            }
            None => {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Parent channel not found"}))).into_response();
            }
        }
    } else {
        None
    };

    let channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let name = body.name.trim().to_string();
    let bitrate = if channel_type == "voice" {
        body.bitrate
    } else {
        None
    };
    let is_room: i64 = if body.is_room { 1 } else { 0 };
    let creator_id: Option<String> = if body.is_room { Some(user.id.clone()) } else { None };

    // Auto-assign position: max sibling position + 1
    let max_pos = if parent_id.is_some() {
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT MAX(position) FROM channels WHERE server_id = ? AND parent_id = ?",
        )
        .bind(&server_id)
        .bind(&parent_id)
        .fetch_one(&state.db)
        .await
        .ok()
        .flatten()
    } else {
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT MAX(position) FROM channels WHERE server_id = ? AND parent_id IS NULL",
        )
        .bind(&server_id)
        .fetch_one(&state.db)
        .await
        .ok()
        .flatten()
    };
    let position = max_pos.unwrap_or(-1) + 1;

    let _ = sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, bitrate, parent_id, position, is_room, creator_id, is_locked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
    )
    .bind(&channel_id)
    .bind(&server_id)
    .bind(&name)
    .bind(&channel_type)
    .bind(bitrate)
    .bind(&parent_id)
    .bind(position)
    .bind(is_room)
    .bind(&creator_id)
    .bind(&now)
    .execute(&state.db)
    .await;

    let channel = Channel {
        id: channel_id,
        server_id: server_id.clone(),
        name,
        channel_type: channel_type.clone(),
        bitrate,
        parent_id,
        position,
        is_room,
        creator_id,
        is_locked: 0,
        created_at: now,
    };

    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::RoomCreated {
                channel: channel.clone(),
            },
            None,
        )
        .await;

    (StatusCode::CREATED, Json(channel)).into_response()
}
