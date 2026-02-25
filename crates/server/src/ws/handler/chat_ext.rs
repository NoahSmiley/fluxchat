use crate::AppState;
use crate::models::AuthUser;
use crate::ws::events::ServerEvent;
use crate::ws::gateway::ClientId;

pub async fn handle_add_reaction(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    message_id: String,
    emoji: String,
) {
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
    // suppress unused variable warning
    let _ = client_id;
}

pub async fn handle_remove_reaction(
    state: &AppState,
    user: &AuthUser,
    message_id: String,
    emoji: String,
) {
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

pub async fn handle_send_dm(
    state: &AppState,
    user: &AuthUser,
    dm_channel_id: String,
    ciphertext: String,
    mls_epoch: i64,
) {
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

    state.gateway.broadcast_dm(&dm_channel_id, &event).await;

    let other_user_id = if user.id == user1 { &user2 } else { &user1 };
    if other_user_id != &user.id
        && !state
            .gateway
            .is_user_subscribed_to_dm(other_user_id, &dm_channel_id)
            .await
    {
        state.gateway.send_to_user(other_user_id, &event).await;
    }
}
