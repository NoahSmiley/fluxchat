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
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    // Extract session from cookie
    let auth_user = extract_session_from_headers(&state, &headers).await;

    ws.on_upgrade(move |socket| handle_socket(socket, state, auth_user))
}

async fn extract_session_from_headers(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Option<AuthUser> {
    let cookie_header = headers.get("cookie")?.to_str().ok()?;

    // Parse cookie to find session token
    let token = cookie_header
        .split(';')
        .filter_map(|c| {
            let c = c.trim();
            if c.starts_with("better-auth.session_token=") {
                Some(c.trim_start_matches("better-auth.session_token="))
            } else {
                None
            }
        })
        .next()?;

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
        None => {
            // Can't authenticate — close connection
            return;
        }
    };

    let client_id = state.gateway.next_client_id().await;
    let (mut ws_tx, mut ws_rx) = socket.split();

    // Create mpsc channel for sending messages to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Register client
    state
        .gateway
        .register(client_id, user.id.clone(), user.username.clone(), tx)
        .await;

    // Broadcast online presence
    state
        .gateway
        .broadcast_all(
            &ServerEvent::Presence {
                user_id: user.id.clone(),
                status: "online".into(),
            },
            None,
        )
        .await;

    // Send current voice states
    let voice_states = state.gateway.all_voice_states().await;
    for (channel_id, participants) in voice_states {
        state
            .gateway
            .send_to(
                client_id,
                &ServerEvent::VoiceState {
                    channel_id,
                    participants,
                },
            )
            .await;
    }

    // Send online users
    let online_ids = state.gateway.online_user_ids().await;
    for uid in online_ids {
        if uid != user.id {
            state
                .gateway
                .send_to(
                    client_id,
                    &ServerEvent::Presence {
                        user_id: uid,
                        status: "online".into(),
                    },
                )
                .await;
        }
    }

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

    // Wait for either task to finish
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Clean up: unregister and handle voice leave
    let old_voice = {
        let clients = state.gateway.clients.read().await;
        clients.get(&client_id).and_then(|c| c.voice_channel_id.clone())
    };

    state.gateway.unregister(client_id).await;

    // Broadcast voice state update if was in voice
    if let Some(channel_id) = old_voice {
        let participants = state.gateway.voice_channel_participants(&channel_id).await;
        state
            .gateway
            .broadcast_all(
                &ServerEvent::VoiceState {
                    channel_id,
                    participants,
                },
                None,
            )
            .await;
    }

    // Broadcast offline presence
    state
        .gateway
        .broadcast_all(
            &ServerEvent::Presence {
                user_id: user.id,
                status: "offline".into(),
            },
            None,
        )
        .await;
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
        ClientEvent::SendMessage {
            channel_id,
            ciphertext,
            mls_epoch,
        } => {
            if let Err(e) = flux_shared::validation::validate_message_content(&ciphertext) {
                state
                    .gateway
                    .send_to(client_id, &ServerEvent::Error { message: e })
                    .await;
                return;
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let result = sqlx::query(
                r#"INSERT INTO messages (id, channel_id, sender_id, ciphertext, mls_epoch, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)"#,
            )
            .bind(&id)
            .bind(&channel_id)
            .bind(&user.id)
            .bind(&ciphertext)
            .bind(mls_epoch)
            .bind(&now)
            .execute(&state.db)
            .await;

            if result.is_err() {
                return;
            }

            // Try to index in FTS
            if let Ok(decoded) = base64_decode(&ciphertext) {
                let _ = sqlx::query(
                    "INSERT INTO messages_fts (message_id, plaintext) VALUES (?, ?)",
                )
                .bind(&id)
                .bind(&decoded)
                .execute(&state.db)
                .await;
            }

            let message = crate::models::Message {
                id,
                channel_id: channel_id.clone(),
                sender_id: user.id.clone(),
                ciphertext,
                mls_epoch,
                created_at: now,
                edited_at: None,
            };

            state
                .gateway
                .broadcast_channel(&channel_id, &ServerEvent::Message { message }, None)
                .await;
        }
        ClientEvent::EditMessage {
            message_id,
            ciphertext,
        } => {
            if let Err(e) = flux_shared::validation::validate_message_content(&ciphertext) {
                state
                    .gateway
                    .send_to(client_id, &ServerEvent::Error { message: e })
                    .await;
                return;
            }

            // Verify ownership
            let row = sqlx::query_as::<_, (String, String)>(
                "SELECT sender_id, channel_id FROM messages WHERE id = ?",
            )
            .bind(&message_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let (sender_id, channel_id) = match row {
                Some(r) => r,
                None => return,
            };

            if sender_id != user.id {
                state
                    .gateway
                    .send_to(
                        client_id,
                        &ServerEvent::Error {
                            message: "Not your message".into(),
                        },
                    )
                    .await;
                return;
            }

            let now = chrono::Utc::now().to_rfc3339();

            let _ = sqlx::query(
                "UPDATE messages SET ciphertext = ?, edited_at = ? WHERE id = ?",
            )
            .bind(&ciphertext)
            .bind(&now)
            .bind(&message_id)
            .execute(&state.db)
            .await;

            // Update FTS
            if let Ok(decoded) = base64_decode(&ciphertext) {
                let _ = sqlx::query(
                    "DELETE FROM messages_fts WHERE message_id = ?",
                )
                .bind(&message_id)
                .execute(&state.db)
                .await;
                let _ = sqlx::query(
                    "INSERT INTO messages_fts (message_id, plaintext) VALUES (?, ?)",
                )
                .bind(&message_id)
                .bind(&decoded)
                .execute(&state.db)
                .await;
            }

            state
                .gateway
                .broadcast_channel(
                    &channel_id,
                    &ServerEvent::MessageEdit {
                        message_id,
                        ciphertext,
                        edited_at: now,
                    },
                    None,
                )
                .await;
        }
        ClientEvent::TypingStart { channel_id } => {
            state
                .gateway
                .broadcast_channel(
                    &channel_id,
                    &ServerEvent::Typing {
                        channel_id: channel_id.clone(),
                        user_id: user.id.clone(),
                        active: true,
                    },
                    Some(client_id),
                )
                .await;
        }
        ClientEvent::TypingStop { channel_id } => {
            state
                .gateway
                .broadcast_channel(
                    &channel_id,
                    &ServerEvent::Typing {
                        channel_id: channel_id.clone(),
                        user_id: user.id.clone(),
                        active: false,
                    },
                    Some(client_id),
                )
                .await;
        }
        ClientEvent::VoiceStateUpdate { channel_id, action } => {
            match action.as_str() {
                "join" => {
                    state.gateway.voice_join(client_id, &channel_id).await;
                    let participants = state.gateway.voice_channel_participants(&channel_id).await;
                    state
                        .gateway
                        .broadcast_all(
                            &ServerEvent::VoiceState {
                                channel_id,
                                participants,
                            },
                            None,
                        )
                        .await;
                }
                "leave" => {
                    if let Some(left_channel) = state.gateway.voice_leave(client_id).await {
                        let participants =
                            state.gateway.voice_channel_participants(&left_channel).await;
                        state
                            .gateway
                            .broadcast_all(
                                &ServerEvent::VoiceState {
                                    channel_id: left_channel,
                                    participants,
                                },
                                None,
                            )
                            .await;
                    }
                }
                _ => {}
            }
        }
        ClientEvent::AddReaction { message_id, emoji } => {
            // Check for duplicate
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
            )
            .bind(&message_id)
            .bind(&user.id)
            .bind(&emoji)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

            if exists > 0 {
                return;
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let _ = sqlx::query(
                "INSERT INTO reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&message_id)
            .bind(&user.id)
            .bind(&emoji)
            .bind(&now)
            .execute(&state.db)
            .await;

            // Find channel for the message
            let channel_id = sqlx::query_scalar::<_, String>(
                "SELECT channel_id FROM messages WHERE id = ?",
            )
            .bind(&message_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            if let Some(channel_id) = channel_id {
                state
                    .gateway
                    .broadcast_channel(
                        &channel_id,
                        &ServerEvent::ReactionAdd {
                            message_id,
                            user_id: user.id.clone(),
                            emoji,
                        },
                        None,
                    )
                    .await;
            }
        }
        ClientEvent::RemoveReaction { message_id, emoji } => {
            let _ = sqlx::query(
                "DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
            )
            .bind(&message_id)
            .bind(&user.id)
            .bind(&emoji)
            .execute(&state.db)
            .await;

            let channel_id = sqlx::query_scalar::<_, String>(
                "SELECT channel_id FROM messages WHERE id = ?",
            )
            .bind(&message_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            if let Some(channel_id) = channel_id {
                state
                    .gateway
                    .broadcast_channel(
                        &channel_id,
                        &ServerEvent::ReactionRemove {
                            message_id,
                            user_id: user.id.clone(),
                            emoji,
                        },
                        None,
                    )
                    .await;
            }
        }
        ClientEvent::SendDm {
            dm_channel_id,
            ciphertext,
            mls_epoch,
        } => {
            // Verify user is participant
            let dm = sqlx::query_as::<_, (String, String)>(
                "SELECT user1_id, user2_id FROM dm_channels WHERE id = ?",
            )
            .bind(&dm_channel_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let (user1, user2) = match dm {
                Some(d) => d,
                None => return,
            };

            if user.id != user1 && user.id != user2 {
                return;
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let _ = sqlx::query(
                r#"INSERT INTO dm_messages (id, dm_channel_id, sender_id, ciphertext, mls_epoch, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)"#,
            )
            .bind(&id)
            .bind(&dm_channel_id)
            .bind(&user.id)
            .bind(&ciphertext)
            .bind(mls_epoch)
            .bind(&now)
            .execute(&state.db)
            .await;

            let message = crate::models::DmMessage {
                id,
                dm_channel_id: dm_channel_id.clone(),
                sender_id: user.id.clone(),
                ciphertext,
                mls_epoch,
                created_at: now,
            };

            let event = ServerEvent::DmMessage { message };

            // Broadcast to DM subscribers
            state.gateway.broadcast_dm(&dm_channel_id, &event).await;

            // Also send to the other user if they're connected but not subscribed
            let other_user_id = if user.id == user1 { &user2 } else { &user1 };
            state.gateway.send_to_user(other_user_id, &event).await;
        }
        ClientEvent::Ping => {
            // No-op — just keeps connection alive
        }
    }
}

fn base64_decode(input: &str) -> Result<String, ()> {
    // Simple base64 decode (atob equivalent)
    use std::str;
    // Use a basic approach: the data is encoded with btoa() which is standard base64
    let bytes = base64_decode_bytes(input)?;
    str::from_utf8(&bytes).map(|s| s.to_string()).map_err(|_| ())
}

fn base64_decode_bytes(input: &str) -> Result<Vec<u8>, ()> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let input = input.trim_end_matches('=');
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for &byte in input.as_bytes() {
        let val = TABLE.iter().position(|&c| c == byte).ok_or(())? as u32;
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }

    Ok(output)
}
