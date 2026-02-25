mod common;

use common::ws_helpers::{drain_messages, send_json, start_server, ws_connect};
use serde_json::json;

// ── Voice State in Rooms (4 tests) ──

#[tokio::test]
async fn room_voice_join_broadcasts_participants() {
    let (base, pool) = start_server().await;

    let (user1_id, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let server_id = common::create_test_server(&pool, &user1_id, "TestServer").await;
    common::add_member(&pool, &user2_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Hang Out", &user1_id).await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    // Alice joins the room
    send_json(
        &mut ws1,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_voice = msgs
        .iter()
        .any(|m| m["type"] == "voice_state" && m["channelId"] == room_id);
    assert!(has_voice, "Should receive voice_state for room join");
}

#[tokio::test]
async fn room_voice_leave_broadcasts_empty() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Temp Room", &user_id).await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Join then leave
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "leave"}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_empty = msgs.iter().any(|m| {
        m["type"] == "voice_state"
            && m["channelId"] == room_id
            && m["participants"]
                .as_array()
                .is_some_and(|a| a.is_empty())
    });
    assert!(has_empty, "Should broadcast empty participants after leave");
}

#[tokio::test]
async fn room_voice_multiple_users_in_room() {
    let (base, pool) = start_server().await;

    let (user1_id, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let server_id = common::create_test_server(&pool, &user1_id, "TestServer").await;
    common::add_member(&pool, &user2_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Party", &user1_id).await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    // Both join
    send_json(
        &mut ws1,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(
        &mut ws2,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws1).await;
    let two_participants = msgs.iter().any(|m| {
        m["type"] == "voice_state"
            && m["channelId"] == room_id
            && m["participants"]
                .as_array()
                .is_some_and(|a| a.len() == 2)
    });
    assert!(two_participants, "Room should show 2 participants");
}

#[tokio::test]
async fn room_voice_switch_between_rooms() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room1_id = common::create_room(&pool, &server_id, "Room A", &user_id).await;
    let room2_id = common::create_room(&pool, &server_id, "Room B", &user_id).await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Join room 1
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room1_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    // Leave room 1, join room 2
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room1_id, "action": "leave"}),
    )
    .await;
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room2_id, "action": "join"}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;

    // Room 1 should be empty
    let room1_empty = msgs.iter().any(|m| {
        m["type"] == "voice_state"
            && m["channelId"] == room1_id
            && m["participants"]
                .as_array()
                .is_some_and(|a| a.is_empty())
    });
    // Room 2 should have user
    let room2_occupied = msgs.iter().any(|m| {
        m["type"] == "voice_state"
            && m["channelId"] == room2_id
            && m["participants"]
                .as_array()
                .is_some_and(|a| !a.is_empty())
    });

    assert!(room1_empty, "Room 1 should be empty after switch");
    assert!(room2_occupied, "Room 2 should have participant after switch");
}
