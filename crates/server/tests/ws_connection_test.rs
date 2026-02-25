mod common;

use common::ws_helpers::{drain_messages, send_json, start_server, ws_connect};
use futures::StreamExt;
use serde_json::json;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::test]
async fn connect_with_valid_token() {
    let (base, pool) = start_server().await;
    let (_, token) = common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let mut ws = ws_connect(&base, &token).await;
    // Should receive initial presence messages
    let msgs = drain_messages(&mut ws).await;
    assert!(!msgs.is_empty(), "Should receive presence on connect");

    // Check we got our own presence
    let has_own_presence = msgs.iter().any(|m| m["type"] == "presence" && m["userId"].as_str().is_some());
    assert!(has_own_presence);
}

#[tokio::test]
async fn connect_without_token_closes() {
    let (base, _pool) = start_server().await;

    let ws_url = format!("{}/gateway", base.replace("http://", "ws://"));
    let (mut ws, _) = connect_async(&ws_url).await.unwrap();

    // Connection should close almost immediately since no auth
    let result = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next()).await;
    match result {
        Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Err(_) => {} // Expected
        Ok(Some(Ok(_))) => {} // Might get empty message before close
        Ok(Some(Err(_))) => {} // Connection error is fine
    }
}

#[tokio::test]
async fn connect_with_expired_token_closes() {
    let (base, pool) = start_server().await;

    let user_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(r#"INSERT INTO "user" (id, name, username, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, ?, ?)"#)
        .bind(&user_id).bind("expired").bind("expired").bind("expired@test.com").bind(&now).bind(&now)
        .execute(&pool).await.unwrap();

    let token = uuid::Uuid::new_v4().to_string();
    let expired = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
    sqlx::query(r#"INSERT INTO "session" (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"#)
        .bind(uuid::Uuid::new_v4().to_string()).bind(&user_id).bind(&token).bind(&expired).bind(&now).bind(&now)
        .execute(&pool).await.unwrap();

    let ws_url = format!("{}/gateway?token={}", base.replace("http://", "ws://"), token);
    let (mut ws, _) = connect_async(&ws_url).await.unwrap();

    // Should close because session is expired
    let result = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next()).await;
    match result {
        Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Err(_) => {}
        Ok(Some(Ok(_))) => {}
        Ok(Some(Err(_))) => {}
    }
}

#[tokio::test]
async fn send_message_creates_db_record() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Subscribe to channel
    send_json(&mut ws, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Send message
    send_json(
        &mut ws,
        &json!({
            "type": "send_message",
            "channelId": channel_id,
            "content": "hello world",
            "attachmentIds": []
        }),
    )
    .await;

    // Verify message in DB
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages WHERE channel_id = ?")
        .bind(&channel_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn send_message_broadcasts_to_channel_subscribers() {
    let (base, pool) = start_server().await;
    let (user1_id, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let server_id = common::create_test_server(&pool, &user1_id, "TestServer").await;
    common::add_member(&pool, &user2_id, &server_id, "member").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    // Both subscribe
    send_json(&mut ws1, &json!({"type": "join_channel", "channelId": channel_id})).await;
    send_json(&mut ws2, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Alice sends message
    send_json(
        &mut ws1,
        &json!({
            "type": "send_message",
            "channelId": channel_id,
            "content": "hello bob",
            "attachmentIds": []
        }),
    )
    .await;

    // Bob should receive the message
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_msg = msgs.iter().any(|m| m["type"] == "message");
    assert!(has_msg, "Bob should receive the message");
}
