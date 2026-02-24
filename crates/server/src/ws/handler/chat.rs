use crate::AppState;
use crate::models::AuthUser;
use crate::ws::events::ServerEvent;
use crate::ws::gateway::ClientId;

pub async fn handle_send_message(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    channel_id: String,
    content: String,
    attachment_ids: Vec<String>,
) {
    if let Err(e) = flux_shared::validation::validate_message_content(&content) {
        state
            .gateway
            .send_to(client_id, &ServerEvent::Error { message: e })
            .await;
        return;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let result = sqlx::query(
        r#"INSERT INTO messages (id, channel_id, sender_id, content, created_at)
           VALUES (?, ?, ?, ?, ?)"#,
    )
    .bind(&id)
    .bind(&channel_id)
    .bind(&user.id)
    .bind(&content)
    .bind(&now)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to insert message: {:?}", e);
        state.gateway.send_to(client_id, &ServerEvent::Error { message: format!("Failed to save message: {}", e) }).await;
        return;
    }

    let _ = sqlx::query(
        "INSERT INTO messages_fts (message_id, plaintext) VALUES (?, ?)",
    )
    .bind(&id)
    .bind(&content)
    .execute(&state.db)
    .await;

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
        content,
        created_at: now,
        edited_at: None,
    };

    state
        .gateway
        .broadcast_channel(&channel_id, &ServerEvent::Message { message, attachments }, None)
        .await;
}

pub async fn handle_edit_message(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    message_id: String,
    content: String,
) {
    if let Err(e) = flux_shared::validation::validate_message_content(&content) {
        state
            .gateway
            .send_to(client_id, &ServerEvent::Error { message: e })
            .await;
        return;
    }

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
            .send_to(client_id, &ServerEvent::Error { message: "Not your message".into() })
            .await;
        return;
    }

    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query("UPDATE messages SET content = ?, edited_at = ? WHERE id = ?")
        .bind(&content)
        .bind(&now)
        .bind(&message_id)
        .execute(&state.db)
        .await;

    let _ = sqlx::query("DELETE FROM messages_fts WHERE message_id = ?")
        .bind(&message_id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("INSERT INTO messages_fts (message_id, plaintext) VALUES (?, ?)")
        .bind(&message_id)
        .bind(&content)
        .execute(&state.db)
        .await;

    state
        .gateway
        .broadcast_channel(
            &channel_id,
            &ServerEvent::MessageEdit { message_id, content, edited_at: now },
            None,
        )
        .await;
}

pub async fn handle_delete_message(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    message_id: String,
) {
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
            .send_to(client_id, &ServerEvent::Error { message: "Not your message".into() })
            .await;
        return;
    }

    let _ = sqlx::query("DELETE FROM messages_fts WHERE message_id = ?")
        .bind(&message_id)
        .execute(&state.db)
        .await;

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

pub async fn handle_typing(
    state: &AppState,
    client_id: ClientId,
    user: &AuthUser,
    channel_id: &str,
    active: bool,
) {
    state
        .gateway
        .broadcast_channel(
            channel_id,
            &ServerEvent::Typing {
                channel_id: channel_id.to_string(),
                user_id: user.id.clone(),
                active,
            },
            Some(client_id),
        )
        .await;
}
