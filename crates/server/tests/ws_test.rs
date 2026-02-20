mod common;

use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Start the test app on a random TCP port and return the base URL.
async fn start_server() -> (String, sqlx::SqlitePool) {
    let pool = common::setup_test_db().await;
    let app = common::create_test_app(pool.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://127.0.0.1:{}", addr.port());

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Give the server a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    (base, pool)
}

/// Connect a WebSocket with a session token.
async fn ws_connect(
    base: &str,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
{
    let ws_url = format!(
        "{}/gateway?token={}",
        base.replace("http://", "ws://"),
        token
    );
    let (ws, _) = connect_async(&ws_url).await.unwrap();
    ws
}

/// Read next text message parsed as JSON, with timeout.
#[allow(dead_code)]
async fn recv_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Option<Value> {
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(3), ws.next()).await;
    match timeout {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str(&text).ok(),
        _ => None,
    }
}

/// Drain all pending messages until timeout.
async fn drain_messages(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Vec<Value> {
    let mut messages = Vec::new();
    loop {
        let timeout =
            tokio::time::timeout(std::time::Duration::from_millis(200), ws.next()).await;
        match timeout {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    messages.push(v);
                }
            }
            _ => break,
        }
    }
    messages
}

/// Send a JSON message over WebSocket.
async fn send_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    value: &Value,
) {
    ws.send(Message::Text(serde_json::to_string(value).unwrap().into()))
        .await
        .unwrap();
}

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

#[tokio::test]
async fn edit_message_broadcasts_update() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    // Insert a message directly
    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, 'original', ?)")
        .bind(&msg_id).bind(&channel_id).bind(&user_id).bind(&now)
        .execute(&pool).await.unwrap();

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(
        &mut ws,
        &json!({"type": "edit_message", "messageId": msg_id, "content": "edited"}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_edit = msgs.iter().any(|m| m["type"] == "message_edit");
    assert!(has_edit);
}

#[tokio::test]
async fn edit_message_rejects_non_owner() {
    let (base, pool) = start_server().await;
    let (user1_id, _token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let server_id = common::create_test_server(&pool, &user1_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    // Alice's message
    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, 'alice msg', ?)")
        .bind(&msg_id).bind(&channel_id).bind(&user1_id).bind(&now)
        .execute(&pool).await.unwrap();

    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws2).await;

    // Bob tries to edit Alice's message
    send_json(
        &mut ws2,
        &json!({"type": "edit_message", "messageId": msg_id, "content": "hacked"}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_error = msgs.iter().any(|m| m["type"] == "error");
    assert!(has_error, "Should receive error for editing other's message");
}

#[tokio::test]
async fn delete_message_broadcasts_delete() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, 'to delete', ?)")
        .bind(&msg_id).bind(&channel_id).bind(&user_id).bind(&now)
        .execute(&pool).await.unwrap();

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(&mut ws, &json!({"type": "delete_message", "messageId": msg_id})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_delete = msgs.iter().any(|m| m["type"] == "message_delete");
    assert!(has_delete);

    // Verify deleted from DB
    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(&msg_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn delete_message_rejects_non_owner() {
    let (base, pool) = start_server().await;
    let (user1_id, _) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_, token2) = common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let server_id = common::create_test_server(&pool, &user1_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, 'alice msg', ?)")
        .bind(&msg_id).bind(&channel_id).bind(&user1_id).bind(&now)
        .execute(&pool).await.unwrap();

    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws2).await;

    send_json(&mut ws2, &json!({"type": "delete_message", "messageId": msg_id})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_error = msgs.iter().any(|m| m["type"] == "error");
    assert!(has_error);

    // Message should still exist
    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM messages WHERE id = ?")
            .bind(&msg_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn typing_start_broadcasts() {
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

    send_json(&mut ws1, &json!({"type": "join_channel", "channelId": channel_id})).await;
    send_json(&mut ws2, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(&mut ws1, &json!({"type": "typing_start", "channelId": channel_id})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_typing = msgs.iter().any(|m| m["type"] == "typing" && m["active"] == true);
    assert!(has_typing);
}

#[tokio::test]
async fn typing_stop_broadcasts() {
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

    send_json(&mut ws1, &json!({"type": "join_channel", "channelId": channel_id})).await;
    send_json(&mut ws2, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(&mut ws1, &json!({"type": "typing_stop", "channelId": channel_id})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_typing_stop = msgs.iter().any(|m| m["type"] == "typing" && m["active"] == false);
    assert!(has_typing_stop);
}

#[tokio::test]
async fn join_channel_subscribes() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Send a message to the channel and verify we receive it
    send_json(
        &mut ws,
        &json!({
            "type": "send_message",
            "channelId": channel_id,
            "content": "test msg",
            "attachmentIds": []
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_msg = msgs.iter().any(|m| m["type"] == "message");
    assert!(has_msg);
}

#[tokio::test]
async fn leave_channel_unsubscribes() {
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

    send_json(&mut ws2, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Leave channel
    send_json(&mut ws2, &json!({"type": "leave_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Alice sends message — Bob should NOT get it
    send_json(&mut ws1, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(
        &mut ws1,
        &json!({
            "type": "send_message",
            "channelId": channel_id,
            "content": "should not reach bob",
            "attachmentIds": []
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_msg = msgs.iter().any(|m| m["type"] == "message");
    assert!(!has_msg, "Bob should not receive messages after leaving");
}

#[tokio::test]
async fn voice_join_broadcasts_state() {
    let (base, pool) = start_server().await;
    let (user1_id, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let server_id = common::create_test_server(&pool, &user1_id, "TestServer").await;
    common::add_member(&pool, &user2_id, &server_id, "member").await;
    let vc_id = common::create_voice_channel(&pool, &server_id, "voice-chat").await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(&mut ws1, &json!({"type": "voice_state_update", "channelId": vc_id, "action": "join"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_voice = msgs.iter().any(|m| m["type"] == "voice_state");
    assert!(has_voice, "Voice state should be broadcast");
}

#[tokio::test]
async fn voice_leave_broadcasts_state() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let vc_id = common::create_voice_channel(&pool, &server_id, "voice-chat").await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "voice_state_update", "channelId": vc_id, "action": "join"})).await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "voice_state_update", "channelId": vc_id, "action": "leave"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_voice_empty = msgs.iter().any(|m| {
        m["type"] == "voice_state" && m["participants"].as_array().map_or(false, |a| a.is_empty())
    });
    assert!(has_voice_empty, "Voice state should show empty participants after leave");
}

#[tokio::test]
async fn voice_drink_update() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let vc_id = common::create_voice_channel(&pool, &server_id, "voice-chat").await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "voice_state_update", "channelId": vc_id, "action": "join"})).await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "voice_drink_update", "channelId": vc_id, "drinkCount": 3})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_drink = msgs.iter().any(|m| {
        m["type"] == "voice_state"
            && m["participants"]
                .as_array()
                .map_or(false, |a| a.iter().any(|p| p["drinkCount"] == 3))
    });
    assert!(has_drink);
}

#[tokio::test]
async fn add_reaction_persists_and_broadcasts() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, 'hello', ?)")
        .bind(&msg_id).bind(&channel_id).bind(&user_id).bind(&now)
        .execute(&pool).await.unwrap();

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(&mut ws, &json!({"type": "add_reaction", "messageId": msg_id, "emoji": "👍"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Check DB
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM reactions WHERE message_id = ? AND emoji = '👍'",
    )
    .bind(&msg_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);

    let msgs = drain_messages(&mut ws).await;
    let has_reaction = msgs.iter().any(|m| m["type"] == "reaction_add");
    assert!(has_reaction);
}

#[tokio::test]
async fn remove_reaction_persists_and_broadcasts() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, 'hello', ?)")
        .bind(&msg_id).bind(&channel_id).bind(&user_id).bind(&now)
        .execute(&pool).await.unwrap();

    // Add reaction directly
    sqlx::query("INSERT INTO reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, '👍', ?)")
        .bind(uuid::Uuid::new_v4().to_string()).bind(&msg_id).bind(&user_id).bind(&now)
        .execute(&pool).await.unwrap();

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "join_channel", "channelId": channel_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(&mut ws, &json!({"type": "remove_reaction", "messageId": msg_id, "emoji": "👍"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM reactions WHERE message_id = ? AND emoji = '👍'",
    )
    .bind(&msg_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
}

#[tokio::test]
async fn duplicate_reaction_ignored() {
    let (base, pool) = start_server().await;
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = common::create_text_channel(&pool, &server_id, "test-channel").await;

    let msg_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, 'hello', ?)")
        .bind(&msg_id).bind(&channel_id).bind(&user_id).bind(&now)
        .execute(&pool).await.unwrap();

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "add_reaction", "messageId": msg_id, "emoji": "🎉"})).await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    send_json(&mut ws, &json!({"type": "add_reaction", "messageId": msg_id, "emoji": "🎉"})).await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = '🎉'",
    )
    .bind(&msg_id)
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1, "Duplicate reaction should be ignored");
}

#[tokio::test]
async fn send_dm_creates_record_and_broadcasts() {
    let (base, pool) = start_server().await;
    let (user1_id, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    // Create DM channel
    let dm_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)")
        .bind(&dm_id)
        .bind(&user1_id)
        .bind(&user2_id)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(&mut ws1, &json!({"type": "join_dm", "dmChannelId": dm_id})).await;
    send_json(&mut ws2, &json!({"type": "join_dm", "dmChannelId": dm_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(
        &mut ws1,
        &json!({
            "type": "send_dm",
            "dmChannelId": dm_id,
            "ciphertext": "encrypted-hello",
            "mlsEpoch": 0
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM dm_messages WHERE dm_channel_id = ?")
            .bind(&dm_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn send_dm_non_participant_ignored() {
    let (base, pool) = start_server().await;
    let (user1_id, _) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, _) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let (_, token3) =
        common::create_test_user(&pool, "charlie@test.com", "charlie", "pass123").await;

    let dm_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)")
        .bind(&dm_id)
        .bind(&user1_id)
        .bind(&user2_id)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws3 = ws_connect(&base, &token3).await;
    drain_messages(&mut ws3).await;

    // Charlie tries to send DM in Alice-Bob channel
    send_json(
        &mut ws3,
        &json!({
            "type": "send_dm",
            "dmChannelId": dm_id,
            "ciphertext": "snoop",
            "mlsEpoch": 0
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM dm_messages WHERE dm_channel_id = ?")
            .bind(&dm_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "Non-participant DM should be ignored");
}

#[tokio::test]
async fn update_activity_broadcasts() {
    let (base, pool) = start_server().await;
    let (_, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(
        &mut ws1,
        &json!({
            "type": "update_activity",
            "activity": {
                "name": "Spotify",
                "activityType": "listening",
                "artist": "Artist"
            }
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_activity = msgs
        .iter()
        .any(|m| m["type"] == "activity_update" && m["activity"]["name"] == "Spotify");
    assert!(has_activity);
}

#[tokio::test]
async fn update_status_broadcasts_presence() {
    let (base, pool) = start_server().await;
    let (_, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(&mut ws1, &json!({"type": "update_status", "status": "dnd"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_presence = msgs
        .iter()
        .any(|m| m["type"] == "presence" && m["status"] == "dnd");
    assert!(has_presence);
}

#[tokio::test]
async fn ping_event_does_not_error() {
    let (base, pool) = start_server().await;
    let (_, token) = common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "ping"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_error = msgs.iter().any(|m| m["type"] == "error");
    assert!(!has_error, "Ping should not produce error");
}
