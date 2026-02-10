use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{
    AuthUser, Channel, CreateChannelRequest, CreateServerRequest, JoinServerRequest,
    MemberWithUser, Server, ServerWithRole, UpdateChannelRequest,
};
use crate::AppState;

/// POST /api/servers
pub async fn create_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<CreateServerRequest>,
) -> impl IntoResponse {
    if let Err(e) = flux_shared::validation::validate_server_name(&body.name) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
    }

    let server_id = uuid::Uuid::new_v4().to_string();
    let invite_code = nanoid::nanoid!(10);
    let now = chrono::Utc::now().to_rfc3339();
    let name = body.name.trim().to_string();

    // Insert server
    let _ = sqlx::query(
        "INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&server_id)
    .bind(&name)
    .bind(&user.id)
    .bind(&invite_code)
    .bind(&now)
    .execute(&state.db)
    .await;

    // Create default text channel
    let text_ch_id = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, 'general', 'text', ?)",
    )
    .bind(&text_ch_id)
    .bind(&server_id)
    .bind(&now)
    .execute(&state.db)
    .await;

    // Create default voice channel
    let voice_ch_id = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, created_at) VALUES (?, ?, 'general', 'voice', ?)",
    )
    .bind(&voice_ch_id)
    .bind(&server_id)
    .bind(&now)
    .execute(&state.db)
    .await;

    // Add owner as member
    let _ = sqlx::query(
        "INSERT INTO memberships (user_id, server_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    )
    .bind(&user.id)
    .bind(&server_id)
    .bind(&now)
    .execute(&state.db)
    .await;

    let server = Server {
        id: server_id,
        name,
        owner_id: user.id,
        invite_code,
        created_at: now,
    };

    (StatusCode::CREATED, Json(server)).into_response()
}

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

/// POST /api/servers/join
pub async fn join_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<JoinServerRequest>,
) -> impl IntoResponse {
    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE invite_code = ?")
        .bind(&body.invite_code)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    let server = match server {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Invalid invite code"})),
            )
                .into_response()
        }
    };

    // Check if already a member
    let existing = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server.id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if existing > 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Already a member of this server"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO memberships (user_id, server_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    )
    .bind(&user.id)
    .bind(&server.id)
    .bind(&now)
    .execute(&state.db)
    .await;

    Json(server).into_response()
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

    let channels = sqlx::query_as::<_, Channel>("SELECT * FROM channels WHERE server_id = ?")
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

    if let Err(e) = flux_shared::validation::validate_channel_name(&body.name) {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
    }

    let channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let name = body.name.trim().to_string();
    let bitrate = if body.channel_type == "voice" {
        body.bitrate
    } else {
        None
    };

    let _ = sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, bitrate, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&channel_id)
    .bind(&server_id)
    .bind(&name)
    .bind(&body.channel_type)
    .bind(bitrate)
    .bind(&now)
    .execute(&state.db)
    .await;

    let channel = Channel {
        id: channel_id,
        server_id,
        name,
        channel_type: body.channel_type,
        bitrate,
        created_at: now,
    };

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

    // Find channel
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
        id: channel.id,
        server_id: channel.server_id,
        name: new_name.to_string(),
        channel_type: channel.channel_type,
        bitrate: new_bitrate,
        created_at: channel.created_at,
    };

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

    match role.as_deref() {
        Some("owner") | Some("admin") => {}
        _ => {
            return (StatusCode::FORBIDDEN).into_response();
        }
    }

    let _ = sqlx::query("DELETE FROM channels WHERE id = ? AND server_id = ?")
        .bind(&channel_id)
        .bind(&server_id)
        .execute(&state.db)
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
        r#"SELECT m.user_id, m.server_id, m.role, m.joined_at, u.username, u.image
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
