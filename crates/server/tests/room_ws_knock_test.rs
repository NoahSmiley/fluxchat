mod common;

use common::ws_helpers::{drain_messages, send_json, start_server, ws_connect};
use serde_json::json;

// ── Knock Flow (3 tests) ──

#[tokio::test]
async fn room_knock_on_locked_room_notifies_creator() {
    let (base, pool) = start_server().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (knocker_id, knocker_token) =
        common::create_test_user(&pool, "knocker@test.com", "knocker", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &knocker_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Private", &owner_id).await;

    // Lock the room
    sqlx::query("UPDATE channels SET is_locked = 1 WHERE id = ?")
        .bind(&room_id)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws_owner = ws_connect(&base, &owner_token).await;
    let mut ws_knocker = ws_connect(&base, &knocker_token).await;
    drain_messages(&mut ws_owner).await;
    drain_messages(&mut ws_knocker).await;

    // Knocker knocks
    send_json(
        &mut ws_knocker,
        &json!({"type": "room_knock", "channelId": room_id}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws_owner).await;
    let has_knock = msgs.iter().any(|m| {
        m["type"] == "room_knock"
            && m["channelId"] == room_id
            && m["userId"] == knocker_id
    });
    assert!(has_knock, "Creator should receive room_knock event");
}

#[tokio::test]
async fn room_knock_on_unlocked_room_ignored() {
    let (base, pool) = start_server().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (knocker_id, knocker_token) =
        common::create_test_user(&pool, "knocker@test.com", "knocker", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &knocker_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Open Room", &owner_id).await;
    // Room is unlocked by default

    let mut ws_owner = ws_connect(&base, &owner_token).await;
    let mut ws_knocker = ws_connect(&base, &knocker_token).await;
    drain_messages(&mut ws_owner).await;
    drain_messages(&mut ws_knocker).await;

    // Knocker knocks on unlocked room
    send_json(
        &mut ws_knocker,
        &json!({"type": "room_knock", "channelId": room_id}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws_owner).await;
    let has_knock = msgs.iter().any(|m| m["type"] == "room_knock");
    assert!(!has_knock, "Knock on unlocked room should be silently ignored");
}

#[tokio::test]
async fn room_knock_notifies_all_admins() {
    let (base, pool) = start_server().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (admin_id, admin_token) =
        common::create_test_user(&pool, "admin@test.com", "admin", "pass123").await;
    let (knocker_id, knocker_token) =
        common::create_test_user(&pool, "knocker@test.com", "knocker", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &admin_id, &server_id, "admin").await;
    common::add_member(&pool, &knocker_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "VIP Room", &owner_id).await;

    // Lock the room
    sqlx::query("UPDATE channels SET is_locked = 1 WHERE id = ?")
        .bind(&room_id)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws_owner = ws_connect(&base, &owner_token).await;
    let mut ws_admin = ws_connect(&base, &admin_token).await;
    let mut ws_knocker = ws_connect(&base, &knocker_token).await;
    drain_messages(&mut ws_owner).await;
    drain_messages(&mut ws_admin).await;
    drain_messages(&mut ws_knocker).await;

    // Knocker knocks
    send_json(
        &mut ws_knocker,
        &json!({"type": "room_knock", "channelId": room_id}),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let owner_msgs = drain_messages(&mut ws_owner).await;
    let admin_msgs = drain_messages(&mut ws_admin).await;

    let owner_got_knock = owner_msgs.iter().any(|m| m["type"] == "room_knock");
    let admin_got_knock = admin_msgs.iter().any(|m| m["type"] == "room_knock");

    assert!(owner_got_knock, "Owner should receive knock notification");
    assert!(admin_got_knock, "Admin should receive knock notification");
}
