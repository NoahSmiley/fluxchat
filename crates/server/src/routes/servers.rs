use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{
    AuthUser, Channel, CreateChannelRequest,
    MemberWithUser, Server, ServerWithRole, UpdateChannelRequest, UpdateServerRequest,
    UpdateMemberRoleRequest, ReorderChannelsRequest,
    AcceptKnockRequest, InviteToRoomRequest, MoveUserRequest,
};
use crate::AppState;

/// GET /api/servers
pub async fn list_servers(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let servers = sqlx::query_as::<_, ServerWithRole>(
        r#"SELECT s.id, s.name, s.owner_id, s.invite_code, s.created_at, m.role
           FROM memberships m
           INNER JOIN servers s ON s.id = m.server_id
           WHERE m.user_id = ?"#,
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(servers).into_response()
}

/// GET /api/servers/:serverId
pub async fn get_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    // Check membership
    let membership = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let role = match membership {
        Some(r) => r,
        None => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not a member of this server"})),
            )
                .into_response()
        }
    };

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    match server {
        Some(s) => Json(ServerWithRole {
            id: s.id,
            name: s.name,
            owner_id: s.owner_id,
            invite_code: s.invite_code,
            created_at: s.created_at,
            role,
        })
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Server not found"})),
        )
            .into_response(),
    }
}

/// GET /api/servers/:serverId/channels
pub async fn list_channels(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    // Check membership
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
    // Check membership role
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

    // Validate channel type
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
                // Check nesting depth (max 3 levels of categories — 4th level is channels only)
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

    // Non-category channels cannot have children (enforced: they are always leaves)
    // This is validated on the parent side above

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
        "INSERT INTO channels (id, server_id, name, type, bitrate, parent_id, position, is_room, is_persistent, creator_id, is_locked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)",
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
        is_persistent: 0,
        creator_id,
        is_locked: 0,
        created_at: now,
    };

    // Broadcast channel creation to all connected clients
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

/// PATCH /api/servers/:serverId/channels/:channelId
pub async fn update_channel(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, channel_id)): Path<(String, String)>,
    Json(body): Json<UpdateChannelRequest>,
) -> impl IntoResponse {
    // Check membership role
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    // Find channel first so we can check room permissions
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

    // Permission check: rooms allow creator or admin/owner to rename
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

    // Build update
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
        is_persistent: channel.is_persistent,
        creator_id: channel.creator_id,
        is_locked: new_is_locked,
        created_at: channel.created_at,
    };

    // Broadcast channel update to all connected clients so name/bitrate changes apply
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

    // If lock state changed, broadcast to all
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
    // Check membership role
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    // Look up channel for room checks
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

    // Rooms can only be deleted when empty (no voice participants)
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
        // Room creator OR admin/owner can delete
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

    // Broadcast channel deletion to all connected clients
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

/// PATCH /api/servers/:serverId
pub async fn update_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Json(body): Json<UpdateServerRequest>,
) -> impl IntoResponse {
    // Check membership role — owner or admin
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
                .into_response();
        }
    }

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    let server = match server {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Server not found"})),
            )
                .into_response()
        }
    };

    let new_name = if let Some(ref name) = body.name {
        if let Err(e) = flux_shared::validation::validate_server_name(name) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
        }
        name.trim().to_string()
    } else {
        server.name.clone()
    };

    let _ = sqlx::query("UPDATE servers SET name = ? WHERE id = ?")
        .bind(&new_name)
        .bind(&server_id)
        .execute(&state.db)
        .await;

    // Broadcast update to all connected clients
    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::ServerUpdated {
                server_id: server_id.clone(),
                name: new_name.clone(),
            },
            None,
        )
        .await;

    let updated = Server {
        id: server.id,
        name: new_name,
        owner_id: server.owner_id,
        invite_code: server.invite_code,
        created_at: server.created_at,
    };

    Json(updated).into_response()
}

/// DELETE /api/servers/:serverId/members/me
pub async fn leave_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    // Check membership
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
        None => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not a member of this server"})),
            )
                .into_response()
        }
        Some("owner") => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Server owner cannot leave. Delete the server instead."})),
            )
                .into_response()
        }
        _ => {}
    }

    let _ = sqlx::query("DELETE FROM memberships WHERE user_id = ? AND server_id = ?")
        .bind(&user.id)
        .bind(&server_id)
        .execute(&state.db)
        .await;

    // Broadcast member left
    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::MemberLeft {
                server_id: server_id.clone(),
                user_id: user.id.clone(),
            },
            None,
        )
        .await;

    StatusCode::NO_CONTENT.into_response()
}

/// GET /api/servers/:serverId/members
pub async fn list_members(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    // Check membership
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

    let members = sqlx::query_as::<_, MemberWithUser>(
        r#"SELECT m.user_id, m.server_id, m.role, m.joined_at, u.username, u.image, u.ring_style, u.ring_spin, u.steam_id, u.ring_pattern_seed, u.banner_css, u.banner_pattern_seed
           FROM memberships m
           INNER JOIN "user" u ON u.id = m.user_id
           WHERE m.server_id = ?"#,
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(members).into_response()
}

/// PATCH /api/members/:userId/role
pub async fn update_member_role(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(target_user_id): Path<String>,
    Json(body): Json<UpdateMemberRoleRequest>,
) -> impl IntoResponse {
    // Find the default server
    let server = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM servers ORDER BY created_at ASC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let server_id = match server {
        Some((id,)) => id,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "No server found"})),
            )
                .into_response()
        }
    };

    // Verify caller is owner or admin
    let caller_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match caller_role.as_deref() {
        Some("owner") | Some("admin") => {}
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Insufficient permissions"})),
            )
                .into_response()
        }
    }

    // Get target's current role and promotion timestamp
    let target_info = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT role, role_updated_at FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&target_user_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (target_role, role_updated_at) = match target_info {
        Some(info) => info,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Member not found"})),
            )
                .into_response()
        }
    };

    // Cannot change the owner's role
    if target_role == "owner" {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Cannot change owner role"})),
        )
            .into_response();
    }

    // Validate new role
    if body.role != "admin" && body.role != "member" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Role must be 'admin' or 'member'"})),
        )
            .into_response();
    }

    // Demotion rules: admins can only demote other admins within 72 hours of their promotion
    if target_role == "admin" && body.role == "member" && caller_role.as_deref() == Some("admin") {
        if let Some(updated_at) = role_updated_at {
            if let Ok(promoted_at) = chrono::DateTime::parse_from_rfc3339(&updated_at) {
                let hours_since = (chrono::Utc::now() - promoted_at.with_timezone(&chrono::Utc))
                    .num_hours();
                if hours_since > 72 {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(serde_json::json!({"error": "Admins can only demote other admins within 72 hours of their promotion. Only the owner can demote after that."})),
                    )
                        .into_response();
                }
            }
        } else {
            // No role_updated_at means they were promoted before this feature existed — treat as >72h
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Only the owner can demote this admin"})),
            )
                .into_response();
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE memberships SET role = ?, role_updated_at = ? WHERE user_id = ? AND server_id = ?")
        .bind(&body.role)
        .bind(&now)
        .bind(&target_user_id)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();

    // Broadcast role change
    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::MemberRoleUpdated {
                server_id: server_id.clone(),
                user_id: target_user_id.clone(),
                role: body.role.clone(),
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
    // Check membership role
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

    // Fetch all channels for this server to validate
    let all_channels = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE server_id = ?")
        .bind(&server_id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let channel_map: std::collections::HashMap<&str, &Channel> =
        all_channels.iter().map(|c| (c.id.as_str(), c)).collect();

    // Validate all items
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

        // Non-category channels cannot be parents
        let ch = channel_map[item.id.as_str()];
        if ch.channel_type != "category" {
            if body.items.iter().any(|other| other.parent_id.as_deref() == Some(item.id.as_str())) {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Only categories can have children"}))).into_response();
            }
        }
    }

    // Apply updates
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

/// POST /api/servers/:serverId/rooms/:channelId/accept-knock
pub async fn accept_knock(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, channel_id)): Path<(String, String)>,
    Json(body): Json<AcceptKnockRequest>,
) -> impl IntoResponse {
    // Verify caller is creator or admin/owner
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
    let is_creator = channel.creator_id.as_deref() == Some(&user.id);
    if !is_admin_or_owner && !is_creator {
        return StatusCode::FORBIDDEN.into_response();
    }

    // Send acceptance to the knocking user
    state
        .gateway
        .send_to_user(
            &body.user_id,
            &crate::ws::events::ServerEvent::RoomKnockAccepted {
                channel_id: channel_id.clone(),
            },
        )
        .await;

    StatusCode::NO_CONTENT.into_response()
}

/// POST /api/servers/:serverId/rooms/:channelId/invite
pub async fn invite_to_room(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, channel_id)): Path<(String, String)>,
    Json(body): Json<InviteToRoomRequest>,
) -> impl IntoResponse {
    // Verify inviter is a server member
    let inviter_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if inviter_member == 0 {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Not a member"}))).into_response();
    }

    // Verify channel is a room in this server
    let channel = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE id = ? AND server_id = ? AND is_room = 1",
    )
    .bind(&channel_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let channel = match channel {
        Some(c) => c,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Room not found"}))).into_response(),
    };

    // Verify target user is a server member
    let target_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&body.user_id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if target_member == 0 {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Target user is not a server member"}))).into_response();
    }

    // Send invite to target user
    state
        .gateway
        .send_to_user(
            &body.user_id,
            &crate::ws::events::ServerEvent::RoomInvite {
                channel_id: channel_id.clone(),
                channel_name: channel.name.clone(),
                inviter_id: user.id.clone(),
                inviter_username: user.username.clone(),
                server_id: server_id.clone(),
            },
        )
        .await;

    StatusCode::NO_CONTENT.into_response()
}

/// POST /api/servers/:serverId/rooms/:channelId/move
pub async fn move_user(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, channel_id)): Path<(String, String)>,
    Json(body): Json<MoveUserRequest>,
) -> impl IntoResponse {
    // Verify caller is admin/owner
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if !matches!(role.as_deref(), Some("owner") | Some("admin")) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Insufficient permissions"}))).into_response();
    }

    // Verify both channels are voice channels in this server
    let source = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE id = ? AND server_id = ?",
    )
    .bind(&channel_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if source.is_none() {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Source channel not found"}))).into_response();
    }

    let target = sqlx::query_as::<_, Channel>(
        "SELECT * FROM channels WHERE id = ? AND server_id = ?",
    )
    .bind(&body.target_channel_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let target = match target {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Target channel not found"}))).into_response(),
    };

    // Verify target user is in the source channel
    let participants = state.gateway.voice_channel_participants(&channel_id).await;
    let user_in_channel = participants.iter().any(|p| p.user_id == body.user_id);
    if !user_in_channel {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "User is not in the source channel"}))).into_response();
    }

    // Send force move to target user
    state
        .gateway
        .send_to_user(
            &body.user_id,
            &crate::ws::events::ServerEvent::RoomForceMove {
                target_channel_id: body.target_channel_id.clone(),
                target_channel_name: target.name.clone(),
            },
        )
        .await;

    StatusCode::NO_CONTENT.into_response()
}
