use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AcceptKnockRequest, AuthUser, Channel, InviteToRoomRequest, MoveUserRequest};
use crate::AppState;

/// POST /api/servers/:serverId/rooms/:channelId/accept-knock
pub async fn accept_knock(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, channel_id)): Path<(String, String)>,
    Json(body): Json<AcceptKnockRequest>,
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
    let is_creator = channel.creator_id.as_deref() == Some(&user.id);
    if !is_admin_or_owner && !is_creator {
        return StatusCode::FORBIDDEN.into_response();
    }

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

    let participants = state.gateway.voice_channel_participants(&channel_id).await;
    let user_in_channel = participants.iter().any(|p| p.user_id == body.user_id);
    if !user_in_channel {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "User is not in the source channel"}))).into_response();
    }

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
