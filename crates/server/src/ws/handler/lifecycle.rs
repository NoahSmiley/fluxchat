use crate::AppState;
use crate::models::AuthUser;
use crate::ws::events::ServerEvent;
use crate::ws::gateway::ClientId;

pub async fn send_initial_state(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    user_status: &str,
) {
    // Send current voice states
    let voice_states = state.gateway.all_voice_states().await;
    for (channel_id, participants) in voice_states {
        state
            .gateway
            .send_to(client_id, &ServerEvent::VoiceState { channel_id, participants })
            .await;
    }

    // Send online users with their statuses
    let online_statuses = state.gateway.online_user_statuses().await;
    for (uid, status) in online_statuses {
        if uid != user.id {
            state
                .gateway
                .send_to(client_id, &ServerEvent::Presence { user_id: uid, status })
                .await;
        }
    }

    // Send own status back to self
    state
        .gateway
        .send_to(
            client_id,
            &ServerEvent::Presence {
                user_id: user.id.clone(),
                status: user_status.to_string(),
            },
        )
        .await;

    // Send current activities of all online users
    let activities = state.gateway.get_all_activities().await;
    for (uid, activity) in activities {
        state
            .gateway
            .send_to(client_id, &ServerEvent::ActivityUpdate { user_id: uid, activity: Some(activity) })
            .await;
    }
}

pub async fn handle_disconnect(state: &AppState, client_id: ClientId, user: &AuthUser) {
    let (old_voice, was_invisible) = {
        let clients = state.gateway.clients.read().await;
        let client = clients.get(&client_id);
        (
            client.and_then(|c| c.voice_channel_id.clone()),
            client.map(|c| c.status == "invisible").unwrap_or(false),
        )
    };

    state.gateway.unregister(client_id).await;

    if let Some(channel_id) = old_voice {
        let participants = state.gateway.voice_channel_participants(&channel_id).await;

        if participants.is_empty() {
            let is_room = sqlx::query_scalar::<_, i64>(
                "SELECT is_room FROM channels WHERE id = ?",
            )
            .bind(&channel_id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            if is_room == Some(1) {
                state.gateway.schedule_room_cleanup(
                    channel_id.clone(),
                    std::time::Duration::from_secs(state.config.room_cleanup_delay_secs),
                    state.db.clone(),
                ).await;
            }
        }

        state
            .gateway
            .broadcast_all(
                &ServerEvent::VoiceState { channel_id, participants },
                None,
            )
            .await;
    }

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

    if !was_invisible {
        state
            .gateway
            .broadcast_all(
                &ServerEvent::Presence {
                    user_id: user.id.clone(),
                    status: "offline".into(),
                },
                None,
            )
            .await;
    }
}
