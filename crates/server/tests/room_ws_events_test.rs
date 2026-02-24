mod common;

use common::ws_helpers::{drain_messages, send_json, start_server, ws_connect};
use serde_json::json;

// ── Room Lifecycle Events (2 tests) ──

#[tokio::test]
async fn room_created_event_on_http_create() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Create room via HTTP
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/servers/{}/channels", base, server_id))
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({
            "name": "New Room",
            "type": "voice",
            "isRoom": true
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 201);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_room_created = msgs.iter().any(|m| {
        m["type"] == "room_created" && m["channel"]["name"] == "New Room"
    });
    assert!(has_room_created, "Should receive room_created event");
}

#[tokio::test]
async fn room_deleted_event_on_http_delete() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Doomed Room", &user_id).await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Delete room via HTTP
    let client = reqwest::Client::new();
    let res = client
        .delete(format!("{}/api/servers/{}/channels/{}", base, server_id, room_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_room_deleted = msgs.iter().any(|m| {
        m["type"] == "room_deleted" && m["channelId"] == room_id
    });
    assert!(has_room_deleted, "Should receive room_deleted event");
}

// ── Lock Events (2 tests) ──

#[tokio::test]
async fn room_lock_toggled_broadcast() {
    let (base, pool) = start_server().await;

    let (user1_id, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let server_id = common::create_test_server(&pool, &user1_id, "TestServer").await;
    common::add_member(&pool, &user2_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Lockable", &user1_id).await;

    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws2).await;

    // Lock the room via HTTP
    let client = reqwest::Client::new();
    let res = client
        .patch(format!("{}/api/servers/{}/channels/{}", base, server_id, room_id))
        .header("Authorization", format!("Bearer {}", token1))
        .json(&json!({ "isLocked": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_lock = msgs.iter().any(|m| {
        m["type"] == "room_lock_toggled"
            && m["channelId"] == room_id
            && m["isLocked"] == true
    });
    assert!(has_lock, "Should receive room_lock_toggled event");
}

#[tokio::test]
async fn room_unlock_toggled_broadcast() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Locked", &user_id).await;

    // Pre-lock the room
    sqlx::query("UPDATE channels SET is_locked = 1 WHERE id = ?")
        .bind(&room_id)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Unlock via HTTP
    let client = reqwest::Client::new();
    let res = client
        .patch(format!("{}/api/servers/{}/channels/{}", base, server_id, room_id))
        .header("Authorization", format!("Bearer {}", token))
        .json(&json!({ "isLocked": false }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_unlock = msgs.iter().any(|m| {
        m["type"] == "room_lock_toggled"
            && m["channelId"] == room_id
            && m["isLocked"] == false
    });
    assert!(has_unlock, "Should receive room_lock_toggled(false) event");
}
