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
        "INSERT INTO channels (id, server_id, name, type, bitrate, parent_id, position, is_room, is_persistent, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
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
        created_at: now,
    };

    // Broadcast room creation to all connected clients
    if body.is_room {
        state
            .gateway
            .broadcast_all(
                &crate::ws::events::ServerEvent::RoomCreated {
                    channel: channel.clone(),
                },
                None,
            )
            .await;
    }

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

    // Permission check: rooms allow creator to rename (unless persistent lobby — admin/owner only)
    let is_admin_or_owner = matches!(role.as_deref(), Some("owner") | Some("admin"));
    if channel.is_room == 1 {
        if channel.is_persistent == 1 && !is_admin_or_owner {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Only admins can rename the lobby"})),
            )
                .into_response();
        }
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

    let _ = sqlx::query("UPDATE channels SET name = ?, bitrate = ? WHERE id = ?")
        .bind(new_name)
        .bind(new_bitrate)
        .bind(&channel_id)
        .execute(&state.db)
        .await;

    let updated = Channel {
        id: channel.id.clone(),
        server_id: channel.server_id,
        name: new_name.to_string(),
        channel_type: channel.channel_type,
        bitrate: new_bitrate,
        parent_id: channel.parent_id,
        position: channel.position,
        is_room: channel.is_room,
        is_persistent: channel.is_persistent,
        creator_id: channel.creator_id,
        created_at: channel.created_at,
    };

    // Broadcast channel update to all subscribers so bitrate changes apply to everyone
    let ch_id = channel.id.clone();
    state
        .gateway
        .broadcast_channel(
            &ch_id,
            &crate::ws::events::ServerEvent::ChannelUpdate {
                channel_id: ch_id.clone(),
                bitrate: new_bitrate,
            },
            None,
        )
        .await;

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

    // Can't delete persistent lobby
    if channel.is_persistent == 1 {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Cannot delete persistent lobby"})),
        )
            .into_response();
    }

    let is_admin_or_owner = matches!(role.as_deref(), Some("owner") | Some("admin"));

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

    // Broadcast room deletion if it was a room
    if channel.is_room == 1 {
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
    }

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
