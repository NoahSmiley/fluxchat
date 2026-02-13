use axum::{
    extract::{State, WebSocketUpgrade, ws::{Message, WebSocket}},
    response::IntoResponse,
};
use base64::{engine::general_purpose, Engine};
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
    // Extract session from query param, Authorization header, or cookie
    let auth_user = extract_session(&state, &headers, &query).await;

    ws.on_upgrade(move |socket| handle_socket(socket, state, auth_user))
}

async fn extract_session(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    query: &std::collections::HashMap<String, String>,
) -> Option<AuthUser> {
    // 1. Try query param ?token=...
    let token_from_query = query.get("token").map(|t| t.as_str());

    // 2. Try Authorization: Bearer <token>
    let auth_header = headers.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.to_string());

    // 3. Try cookie
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

    // Send current activities of all online users
    let activities = state.gateway.get_all_activities().await;
    for (uid, activity) in activities {
        state
            .gateway
            .send_to(
                client_id,
                &ServerEvent::ActivityUpdate {
                    user_id: uid,
                    activity: Some(activity),
                },
            )
            .await;
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

    // Clear activity on disconnect
    state
        .gateway
        .broadcast_all(
            &ServerEvent::ActivityUpdate {
                user_id: user.id.clone(),
                activity: None,
            },
            None,
        )
        .await;

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
            attachment_ids,
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

            // Index plaintext in FTS5 for non-encrypted channels
            let is_encrypted = sqlx::query_scalar::<_, bool>(
                "SELECT encrypted FROM channels WHERE id = ?",
            )
            .bind(&channel_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or(false);

            if !is_encrypted {
                if let Ok(decoded) = general_purpose::STANDARD.decode(&ciphertext) {
                    if let Ok(plaintext) = String::from_utf8(decoded) {
                        let _ = sqlx::query(
                            "INSERT INTO messages_fts(message_id, plaintext) VALUES (?, ?)",
                        )
                        .bind(&id)
                        .bind(&plaintext)
                        .execute(&state.db)
                        .await;
                    }
                }
            }

            // Link attachments to this message
            let mut attachments = Vec::new();
            if !attachment_ids.is_empty() {
                for att_id in &attachment_ids {
                    let _ = sqlx::query(
                        "UPDATE attachments SET message_id = ? WHERE id = ? AND uploader_id = ? AND message_id IS NULL",
                    )
                    .bind(&id)
                    .bind(att_id)
                    .bind(&user.id)
                    .execute(&state.db)
                    .await;
                }

                // Fetch the linked attachments
                let placeholders: Vec<String> = attachment_ids.iter().map(|_| "?".to_string()).collect();
                let in_clause = placeholders.join(",");
                let sql = format!(
                    "SELECT * FROM attachments WHERE id IN ({}) AND message_id = ?",
                    in_clause
                );
                let mut query = sqlx::query_as::<_, crate::models::Attachment>(&sql);
                for att_id in &attachment_ids {
                    query = query.bind(att_id);
                }
                query = query.bind(&id);
                attachments = query.fetch_all(&state.db).await.unwrap_or_default();
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
                .broadcast_channel(&channel_id, &ServerEvent::Message { message, attachments }, None)
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

            // Update FTS5 index for non-encrypted channels
            let is_encrypted = sqlx::query_scalar::<_, bool>(
                "SELECT encrypted FROM channels WHERE id = ?",
            )
            .bind(&channel_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten()
            .unwrap_or(false);

            if !is_encrypted {
                let _ = sqlx::query("DELETE FROM messages_fts WHERE message_id = ?")
                    .bind(&message_id)
                    .execute(&state.db)
                    .await;
                if let Ok(decoded) = general_purpose::STANDARD.decode(&ciphertext) {
                    if let Ok(plaintext) = String::from_utf8(decoded) {
                        let _ = sqlx::query(
                            "INSERT INTO messages_fts(message_id, plaintext) VALUES (?, ?)",
                        )
                        .bind(&message_id)
                        .bind(&plaintext)
                        .execute(&state.db)
                        .await;
                    }
                }
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
        ClientEvent::DeleteMessage { message_id } => {
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

            // Delete from FTS5 index (no-op if not indexed)
            let _ = sqlx::query("DELETE FROM messages_fts WHERE message_id = ?")
                .bind(&message_id)
                .execute(&state.db)
                .await;

            // Delete the message (attachments cascade)
            let _ = sqlx::query("DELETE FROM messages WHERE id = ?")
                .bind(&message_id)
                .execute(&state.db)
                .await;

            state
                .gateway
                .broadcast_channel(
                    &channel_id,
                    &ServerEvent::MessageDelete {
                        message_id,
                        channel_id: channel_id.clone(),
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
        ClientEvent::UpdateActivity { activity } => {
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
        ClientEvent::ShareServerKey {
            server_id,
            user_id: target_user_id,
            encrypted_key,
        } => {
            // Store the wrapped key for the target user
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

            // Send to the target user
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
        ClientEvent::RequestServerKey { server_id } => {
            // Broadcast to all so any member with the key can share it
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
        ClientEvent::SpotifyPlaybackControl {
            session_id,
            action,
            track_uri,
            position_ms,
        } => {
            // Verify user is the session host
            let session = sqlx::query_as::<_, (String, String)>(
                r#"SELECT host_user_id, voice_channel_id FROM "listening_sessions" WHERE id = ?"#,
            )
            .bind(&session_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let (_host_id, voice_channel_id) = match session {
                Some(s) => s,
                None => return,
            };

            // Update session state in DB
            let now = chrono::Utc::now().to_rfc3339();
            match action.as_str() {
                "play" => {
                    let _ = sqlx::query(
                        r#"UPDATE "listening_sessions" SET is_playing = 1, current_track_uri = COALESCE(?, current_track_uri), current_track_position_ms = COALESCE(?, current_track_position_ms), updated_at = ? WHERE id = ?"#,
                    )
                    .bind(&track_uri)
                    .bind(position_ms)
                    .bind(&now)
                    .bind(&session_id)
                    .execute(&state.db)
                    .await;
                }
                "pause" => {
                    let _ = sqlx::query(
                        r#"UPDATE "listening_sessions" SET is_playing = 0, current_track_position_ms = COALESCE(?, current_track_position_ms), updated_at = ? WHERE id = ?"#,
                    )
                    .bind(position_ms)
                    .bind(&now)
                    .bind(&session_id)
                    .execute(&state.db)
                    .await;
                }
                "seek" => {
                    if let Some(pos) = position_ms {
                        let _ = sqlx::query(
                            r#"UPDATE "listening_sessions" SET current_track_position_ms = ?, updated_at = ? WHERE id = ?"#,
                        )
                        .bind(pos)
                        .bind(&now)
                        .bind(&session_id)
                        .execute(&state.db)
                        .await;
                    }
                }
                "skip" => {
                    let _ = sqlx::query(
                        r#"UPDATE "listening_sessions" SET current_track_uri = ?, current_track_position_ms = 0, is_playing = 1, updated_at = ? WHERE id = ?"#,
                    )
                    .bind(&track_uri)
                    .bind(&now)
                    .bind(&session_id)
                    .execute(&state.db)
                    .await;

                    // Remove the skipped-to track from the queue
                    if let Some(uri) = &track_uri {
                        let _ = sqlx::query(
                            r#"DELETE FROM "session_queue" WHERE session_id = ? AND track_uri = ?"#,
                        )
                        .bind(&session_id)
                        .bind(uri)
                        .execute(&state.db)
                        .await;
                    }
                }
                _ => return,
            }

            // Broadcast to all connected clients except the sender
            state
                .gateway
                .broadcast_all(
                    &ServerEvent::SpotifyPlaybackSync {
                        session_id,
                        voice_channel_id,
                        action,
                        track_uri,
                        position_ms,
                    },
                    Some(client_id),
                )
                .await;
        }
        ClientEvent::Ping => {
            // No-op — just keeps connection alive
        }
    }
}

