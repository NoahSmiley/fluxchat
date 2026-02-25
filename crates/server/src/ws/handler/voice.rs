use crate::AppState;
use crate::models::AuthUser;
use crate::ws::events::ServerEvent;
use crate::ws::gateway::ClientId;

pub async fn handle_voice_state(
    state: &AppState,
    client_id: ClientId,
    channel_id: &str,
    action: &str,
) {
    match action {
        "join" => {
            state.gateway.cancel_room_cleanup(channel_id).await;
            state.gateway.voice_join(client_id, channel_id).await;
            let participants = state.gateway.voice_channel_participants(channel_id).await;
            state
                .gateway
                .broadcast_all(
                    &ServerEvent::VoiceState {
                        channel_id: channel_id.to_string(),
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

                if participants.is_empty() {
                    let _ = sqlx::query(
                        r#"UPDATE "listening_sessions" SET "is_playing" = 0, "updated_at" = datetime('now') WHERE "voice_channel_id" = ? AND "is_playing" = 1"#,
                    )
                    .bind(&left_channel)
                    .execute(&state.db)
                    .await;

                    let is_room = sqlx::query_scalar::<_, i64>(
                        "SELECT is_room FROM channels WHERE id = ?",
                    )
                    .bind(&left_channel)
                    .fetch_optional(&state.db)
                    .await
                    .ok()
                    .flatten();

                    if is_room == Some(1) {
                        state.gateway.schedule_room_cleanup(
                            left_channel.clone(),
                            std::time::Duration::from_secs(state.config.room_cleanup_delay_secs),
                            state.db.clone(),
                        ).await;
                    }
                }

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

pub async fn handle_drink_update(
    state: &AppState,
    user: &AuthUser,
    channel_id: &str,
    drink_count: i32,
) {
    state.gateway.update_drink_count(&user.id, channel_id, drink_count).await;
    let participants = state.gateway.voice_channel_participants(channel_id).await;
    state
        .gateway
        .broadcast_all(
            &ServerEvent::VoiceState {
                channel_id: channel_id.to_string(),
                participants,
            },
            None,
        )
        .await;
}

pub async fn handle_spotify_playback(
    state: &AppState,
    client_id: ClientId,
    session_id: String,
    action: String,
    track_uri: Option<String>,
    position_ms: Option<i64>,
    source: String,
) {
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

    state
        .gateway
        .broadcast_all(
            &ServerEvent::SpotifyPlaybackSync {
                session_id,
                voice_channel_id,
                action,
                track_uri,
                position_ms,
                source,
            },
            Some(client_id),
        )
        .await;
}

pub async fn handle_play_sound(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    channel_id: &str,
    sound_id: &str,
) {
    let sender_channel = {
        let clients = state.gateway.clients.read().await;
        clients.get(&client_id).and_then(|c| c.voice_channel_id.clone())
    };
    if sender_channel.as_deref() != Some(channel_id) {
        return;
    }

    let row = sqlx::query_as::<_, (String, String, f64)>(
        r#"SELECT
            s.audio_attachment_id,
            a_audio.filename,
            s.volume
           FROM soundboard_sounds s
           JOIN attachments a_audio ON a_audio.id = s.audio_attachment_id
           WHERE s.id = ?"#,
    )
    .bind(sound_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (audio_attachment_id, audio_filename, volume) = match row {
        Some(r) => r,
        None => return,
    };

    state
        .gateway
        .broadcast_all(
            &ServerEvent::SoundboardPlay {
                channel_id: channel_id.to_string(),
                sound_id: sound_id.to_string(),
                audio_attachment_id,
                audio_filename,
                volume,
                username: user.username.clone(),
            },
            None,
        )
        .await;
}
