mod common;

use common::ws_helpers::{drain_messages, send_json, start_server, ws_connect};
use serde_json::json;

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
