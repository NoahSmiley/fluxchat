use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, Channel, ReorderChannelsRequest, UpdateChannelRequest};
use crate::AppState;

/// PATCH /api/servers/:serverId/channels/:channelId
pub async fn update_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, channel_id)): Path<(String, String)>,
    Json(body): Json<UpdateChannelRequest>,
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

    let channel = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE id = ? AND server_id = ?",
    )
    .bind(&channel_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let channel = match channel {
        Some(c) => c,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Channel not found"})),
            )
                .into_response()
        }
    };

    let is_admin_or_owner = matches!(role.as_deref(), Some("owner") | Some("admin"));
    if channel.is_room == 1 {
        let is_creator = channel.creator_id.as_deref() == Some(&user.id);
        if !is_admin_or_owner && !is_creator {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Insufficient permissions"})),
            )
                .into_response();
        }
    } else if !is_admin_or_owner {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Insufficient permissions"})),
        )
            .into_response();
    }

    if let Some(ref name) = body.name {
        if let Err(e) = flux_shared::validation::validate_channel_name(name) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
        }
    }

    if body.bitrate.is_some() && channel.channel_type != "voice" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Bitrate can only be set on voice channels"})),
        )
            .into_response();
    }

    let new_name = body.name.as_deref().map(|n| n.trim()).unwrap_or(&channel.name);
    let new_bitrate = if body.bitrate.is_some() {
        body.bitrate
    } else {
        channel.bitrate
    };
    let new_is_locked = if let Some(locked) = body.is_locked {
        if locked { 1i64 } else { 0i64 }
    } else {
        channel.is_locked
    };

    let _ = sqlx::query("UPDATE channels SET name = ?, bitrate = ?, is_locked = ? WHERE id = ?")
        .bind(new_name)
        .bind(new_bitrate)
        .bind(new_is_locked)
        .bind(&channel_id)
        .execute(&state.db)
        .await;

    let updated = Channel {
        id: channel.id.clone(),
        server_id: channel.server_id.clone(),
        name: new_name.to_string(),
        channel_type: channel.channel_type,
        bitrate: new_bitrate,
        parent_id: channel.parent_id,
        position: channel.position,
        is_room: channel.is_room,
        creator_id: channel.creator_id,
        is_locked: new_is_locked,
        created_at: channel.created_at,
    };

    let ch_id = channel.id.clone();
    let name_changed = new_name != channel.name;
    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::ChannelUpdate {
                channel_id: ch_id.clone(),
                name: if name_changed { Some(new_name.to_string()) } else { None },
                bitrate: new_bitrate,
            },
            None,
        )
        .await;

    if body.is_locked.is_some() && new_is_locked != channel.is_locked {
        state
            .gateway
            .broadcast_all(
                &crate::ws::events::ServerEvent::RoomLockToggled {
                    channel_id: channel.id.clone(),
                    server_id: channel.server_id.clone(),
                    is_locked: new_is_locked == 1,
                },
                None,
            )
            .await;
    }

    Json(updated).into_response()
}

/// DELETE /api/servers/:serverId/channels/:channelId
pub async fn delete_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, channel_id)): Path<(String, String)>,
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

    let channel = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE id = ? AND server_id = ?",
    )
    .bind(&channel_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let channel = match channel {
        Some(c) => c,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    let is_admin_or_owner = matches!(role.as_deref(), Some("owner") | Some("admin"));

    if channel.is_room == 1 {
        let participants = state.gateway.voice_channel_participants(&channel_id).await;
        if !participants.is_empty() {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Cannot delete a room with active participants"})),
            )
                .into_response();
        }
    }

    if channel.is_room == 1 {
        let is_creator = channel.creator_id.as_deref() == Some(&user.id);
        if !is_admin_or_owner && !is_creator {
            return (StatusCode::FORBIDDEN).into_response();
        }
    } else if !is_admin_or_owner {
        return (StatusCode::FORBIDDEN).into_response();
    }

    let _ = sqlx::query("DELETE FROM channels WHERE id = ? AND server_id = ?")
        .bind(&channel_id)
        .bind(&server_id)
        .execute(&state.db)
        .await;

    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::RoomDeleted {
                channel_id: channel_id.clone(),
                server_id: server_id.clone(),
            },
            None,
        )
        .await;

    StatusCode::NO_CONTENT.into_response()
}

/// PUT /api/servers/:serverId/channels/reorder
pub async fn reorder_channels(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Json(body): Json<ReorderChannelsRequest>,
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

    let all_channels = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE server_id = ?")
        .bind(&server_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let channel_map: std::collections::HashMap<&str, &Channel> =
        all_channels.iter().map(|c| (c.id.as_str(), c)).collect();

    for item in &body.items {
        if !channel_map.contains_key(item.id.as_str()) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("Channel {} not found in server", item.id)}))).into_response();
        }

        if let Some(ref pid) = item.parent_id {
            match channel_map.get(pid.as_str()) {
                Some(parent) => {
                    if parent.channel_type != "category" {
                        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Parent must be a category"}))).into_response();
                    }
                }
                None => {
                    return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("Parent {} not found", pid)}))).into_response();
                }
            }
        }

        let ch = channel_map[item.id.as_str()];
        if ch.channel_type != "category"
            && body.items.iter().any(|other| other.parent_id.as_deref() == Some(item.id.as_str()))
        {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Only categories can have children"}))).into_response();
        }
    }

    for item in &body.items {
        let _ = sqlx::query("UPDATE channels SET parent_id = ?, position = ? WHERE id = ? AND server_id = ?")
            .bind(&item.parent_id)
            .bind(item.position)
            .bind(&item.id)
            .bind(&server_id)
            .execute(&state.db)
            .await;
    }

    StatusCode::NO_CONTENT.into_response()
}
