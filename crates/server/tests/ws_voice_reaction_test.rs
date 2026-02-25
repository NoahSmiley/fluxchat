mod common;

use common::ws_helpers::{drain_messages, send_json, start_server, ws_connect};
use serde_json::json;

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
        m["type"] == "voice_state" && m["participants"].as_array().is_some_and(|a| a.is_empty())
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
                .is_some_and(|a| a.iter().any(|p| p["drinkCount"] == 3))
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
