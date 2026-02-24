mod chat;
mod chat_ext;
mod lifecycle;
mod misc;
mod voice;

use axum::{
    extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}},
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::AppState;
use crate::models::AuthUser;
use crate::ws::events::{ClientEvent, ServerEvent};
use crate::ws::gateway::ClientId;

/// WebSocket upgrade handler
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    query: axum::extract::Query<std::collections::HashMap<String, String>>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let auth_user = extract_session(&state, &headers, &query).await;
    ws.on_upgrade(move |socket| handle_socket(socket, state, auth_user))
}

async fn extract_session(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    query: &std::collections::HashMap<String, String>,
) -> Option<AuthUser> {
    let token_from_query = query.get("token").map(|t| t.as_str());

    let auth_header = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.to_string());

    let token_from_cookie = headers.get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .filter_map(|c| {
            let c = c.trim();
            if c.starts_with("better-auth.session_token=") {
                Some(c.trim_start_matches("better-auth.session_token=").to_string())
            } else {
                None
            }
        })
        .next();

    let token = token_from_query
        .map(|t| t.to_string())
        .or(auth_header)
        .or(token_from_cookie)?;

    if token.is_empty() {
        return None;
    }
    let token = token.as_str();

    let row = sqlx::query_as::<_, (String, String, String)>(
        r#"SELECT u.id, u.username, s.expiresAt
           FROM "session" s
           JOIN "user" u ON u.id = s.userId
           WHERE s.token = ?"#,
    )
    .bind(token)
    .fetch_optional(&state.db)
    .await
    .ok()??;

    let now = chrono::Utc::now().to_rfc3339();
    if row.2 < now {
        return None;
    }

    Some(AuthUser {
        id: row.0,
        username: row.1,
    })
}

async fn handle_socket(socket: WebSocket, state: Arc<AppState>, auth_user: Option<AuthUser>) {
    let user = match auth_user {
        Some(u) => u,
        None => return,
    };

    let client_id = state.gateway.next_client_id().await;
    let (mut ws_tx, mut ws_rx) = socket.split();

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let user_status = sqlx::query_scalar::<_, String>(
        r#"SELECT status FROM "user" WHERE id = ?"#,
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "online".to_string());

    state
        .gateway
        .register(client_id, user.id.clone(), user.username.clone(), tx, user_status.clone())
        .await;

    // Broadcast online presence (invisible users don't broadcast)
    if user_status != "invisible" {
        state
            .gateway
            .broadcast_all(
                &ServerEvent::Presence {
                    user_id: user.id.clone(),
                    status: user_status.clone(),
                },
                None,
            )
            .await;
    }

    lifecycle::send_initial_state(&state, client_id, &user, &user_status).await;

    // Task to forward messages from mpsc to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_tx.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Receive loop
    let state_clone = state.clone();
    let user_clone = user.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    let text_str: &str = &text;
                    if let Ok(event) = serde_json::from_str::<ClientEvent>(text_str) {
                        handle_client_event(
                            &state_clone,
                            client_id,
                            &user_clone,
                            event,
                        )
                        .await;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    lifecycle::handle_disconnect(&state, client_id, &user).await;
}

async fn handle_client_event(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    event: ClientEvent,
) {
    match event {
        ClientEvent::JoinChannel { channel_id } => {
            state.gateway.subscribe_channel(client_id, &channel_id).await;
        }
        ClientEvent::LeaveChannel { channel_id } => {
            state.gateway.unsubscribe_channel(client_id, &channel_id).await;
        }
        ClientEvent::JoinDm { dm_channel_id } => {
            state.gateway.subscribe_dm(client_id, &dm_channel_id).await;
        }
        ClientEvent::LeaveDm { dm_channel_id } => {
            state.gateway.unsubscribe_dm(client_id, &dm_channel_id).await;
        }
        ClientEvent::SendMessage { channel_id, content, attachment_ids } => {
            chat::handle_send_message(state, client_id, user, channel_id, content, attachment_ids).await;
        }
        ClientEvent::EditMessage { message_id, content } => {
            chat::handle_edit_message(state, client_id, user, message_id, content).await;
        }
        ClientEvent::DeleteMessage { message_id } => {
            chat::handle_delete_message(state, client_id, user, message_id).await;
        }
        ClientEvent::TypingStart { channel_id } => {
            chat::handle_typing(state, client_id, user, &channel_id, true).await;
        }
        ClientEvent::TypingStop { channel_id } => {
            chat::handle_typing(state, client_id, user, &channel_id, false).await;
        }
        ClientEvent::AddReaction { message_id, emoji } => {
            chat_ext::handle_add_reaction(state, client_id, user, message_id, emoji).await;
        }
        ClientEvent::RemoveReaction { message_id, emoji } => {
            chat_ext::handle_remove_reaction(state, user, message_id, emoji).await;
        }
        ClientEvent::SendDm { dm_channel_id, ciphertext, mls_epoch } => {
            chat_ext::handle_send_dm(state, user, dm_channel_id, ciphertext, mls_epoch).await;
        }
        ClientEvent::VoiceStateUpdate { channel_id, action } => {
            voice::handle_voice_state(state, client_id, &channel_id, &action).await;
        }
        ClientEvent::VoiceDrinkUpdate { channel_id, drink_count } => {
            voice::handle_drink_update(state, user, &channel_id, drink_count).await;
        }
        ClientEvent::SpotifyPlaybackControl { session_id, action, track_uri, position_ms, source } => {
            voice::handle_spotify_playback(state, client_id, session_id, action, track_uri, position_ms, source).await;
        }
        ClientEvent::PlaySound { channel_id, sound_id } => {
            voice::handle_play_sound(state, client_id, user, &channel_id, &sound_id).await;
        }
        ClientEvent::UpdateActivity { activity } => {
            misc::handle_update_activity(state, client_id, user, activity).await;
        }
        ClientEvent::UpdateStatus { status } => {
            misc::handle_update_status(state, client_id, user, status).await;
        }
        ClientEvent::ShareServerKey { server_id, user_id: target_user_id, encrypted_key } => {
            misc::handle_share_server_key(state, user, server_id, target_user_id, encrypted_key).await;
        }
        ClientEvent::RequestServerKey { server_id } => {
            misc::handle_request_server_key(state, client_id, user, server_id).await;
        }
        ClientEvent::RoomKnock { channel_id } => {
            misc::handle_room_knock(state, user, &channel_id).await;
        }
        ClientEvent::Ping => {}
    }
}
