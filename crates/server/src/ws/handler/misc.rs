use crate::AppState;
use crate::models::AuthUser;
use crate::ws::events::{ActivityInfo, ServerEvent};
use crate::ws::gateway::ClientId;

pub async fn handle_update_activity(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    activity: Option<ActivityInfo>,
) {
    state.gateway.set_activity(client_id, activity.clone()).await;
    state
        .gateway
        .broadcast_all(
            &ServerEvent::ActivityUpdate {
                user_id: user.id.clone(),
                activity,
            },
            None,
        )
        .await;
}

pub async fn handle_update_status(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    status: String,
) {
    let valid = ["online", "idle", "dnd", "invisible"];
    if !valid.contains(&status.as_str()) {
        return;
    }

    state.gateway.set_status(client_id, status.clone()).await;

    let _ = sqlx::query(r#"UPDATE "user" SET status = ? WHERE id = ?"#)
        .bind(&status)
        .bind(&user.id)
        .execute(&state.db)
        .await;

    if status == "invisible" {
        state.gateway.broadcast_all(
            &ServerEvent::Presence {
                user_id: user.id.clone(),
                status: "offline".into(),
            },
            None,
        ).await;
    } else {
        state.gateway.broadcast_all(
            &ServerEvent::Presence {
                user_id: user.id.clone(),
                status: status.clone(),
            },
            None,
        ).await;
    }

    state.gateway.send_to(
        client_id,
        &ServerEvent::Presence {
            user_id: user.id.clone(),
            status,
        },
    ).await;
}

pub async fn handle_share_server_key(
    state: &AppState,
    user: &AuthUser,
    server_id: String,
    target_user_id: String,
    encrypted_key: String,
) {
    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO server_keys (server_id, user_id, encrypted_key, sender_id, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_id, user_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, sender_id = excluded.sender_id",
    )
    .bind(&server_id)
    .bind(&target_user_id)
    .bind(&encrypted_key)
    .bind(&user.id)
    .bind(&now)
    .execute(&state.db)
    .await;

    state
        .gateway
        .send_to_user(
            &target_user_id,
            &ServerEvent::ServerKeyShared {
                server_id,
                encrypted_key,
                sender_id: user.id.clone(),
            },
        )
        .await;
}

pub async fn handle_request_server_key(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    server_id: String,
) {
    state
        .gateway
        .broadcast_all(
            &ServerEvent::ServerKeyRequested {
                server_id,
                user_id: user.id.clone(),
            },
            Some(client_id),
        )
        .await;
}

pub async fn handle_room_knock(
    state: &AppState,
    user: &AuthUser,
    channel_id: &str,
) {
    let channel = sqlx::query_as::<_, (Option<String>, i64, String)>(
        "SELECT creator_id, is_locked, server_id FROM channels WHERE id = ?",
    )
    .bind(channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (creator_id, is_locked, server_id) = match channel {
        Some(c) => c,
        None => return,
    };

    if is_locked == 0 {
        return;
    }

    let knock_event = ServerEvent::RoomKnock {
        channel_id: channel_id.to_string(),
        user_id: user.id.clone(),
        username: user.username.clone(),
    };

    if let Some(ref cid) = creator_id {
        state.gateway.send_to_user(cid, &knock_event).await;
    }

    let admins = sqlx::query_as::<_, (String,)>(
        "SELECT user_id FROM memberships WHERE server_id = ? AND role IN ('admin', 'owner')",
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for (admin_id,) in admins {
        if Some(admin_id.as_str()) == creator_id.as_deref() || admin_id == user.id {
            continue;
        }
        state.gateway.send_to_user(&admin_id, &knock_event).await;
    }
}
