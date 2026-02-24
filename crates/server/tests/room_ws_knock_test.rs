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

// ── Accept/Invite/Move (5 tests) ──

#[tokio::test]
async fn accept_knock_sends_accepted_to_knocker() {
    let (base, pool) = start_server().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (knocker_id, knocker_token) =
        common::create_test_user(&pool, "knocker@test.com", "knocker", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &knocker_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "VIP", &owner_id).await;

    let mut ws_knocker = ws_connect(&base, &knocker_token).await;
    drain_messages(&mut ws_knocker).await;

    // Owner accepts knock via HTTP
    let client = reqwest::Client::new();
    let res = client
        .post(format!(
            "{}/api/servers/{}/rooms/{}/accept-knock",
            base, server_id, room_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&json!({ "userId": knocker_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws_knocker).await;
    let has_accepted = msgs.iter().any(|m| {
        m["type"] == "room_knock_accepted" && m["channelId"] == room_id
    });
    assert!(has_accepted, "Knocker should receive room_knock_accepted event");
}

#[tokio::test]
async fn accept_knock_requires_creator_or_admin() {
    let (base, pool) = start_server().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;
    let (knocker_id, _) =
        common::create_test_user(&pool, "knocker@test.com", "knocker", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;
    common::add_member(&pool, &knocker_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "VIP", &owner_id).await;

    // Non-creator member tries to accept
    let client = reqwest::Client::new();
    let res = client
        .post(format!(
            "{}/api/servers/{}/rooms/{}/accept-knock",
            base, server_id, room_id
        ))
        .header("Authorization", format!("Bearer {}", member_token))
        .json(&json!({ "userId": knocker_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);
}

#[tokio::test]
async fn invite_to_room_sends_event_to_target() {
    let (base, pool) = start_server().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (target_id, target_token) =
        common::create_test_user(&pool, "target@test.com", "target", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &target_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Fun Room", &owner_id).await;

    let mut ws_target = ws_connect(&base, &target_token).await;
    drain_messages(&mut ws_target).await;

    // Owner invites target via HTTP
    let client = reqwest::Client::new();
    let res = client
        .post(format!(
            "{}/api/servers/{}/rooms/{}/invite",
            base, server_id, room_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&json!({ "userId": target_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws_target).await;
    let has_invite = msgs.iter().any(|m| {
        m["type"] == "room_invite"
            && m["channelId"] == room_id
            && m["channelName"] == "Fun Room"
    });
    assert!(has_invite, "Target should receive room_invite event");
}

#[tokio::test]
async fn invite_requires_target_is_member() {
    let (base, pool) = start_server().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (outsider_id, _) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    // outsider is NOT a member of the server
    let room_id = common::create_room(&pool, &server_id, "Room", &owner_id).await;

    let client = reqwest::Client::new();
    let res = client
        .post(format!(
            "{}/api/servers/{}/rooms/{}/invite",
            base, server_id, room_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&json!({ "userId": outsider_id }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 400, "Should reject invite for non-member");
}

#[tokio::test]
async fn force_move_sends_event_to_target() {
    let (base, pool) = start_server().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (target_id, target_token) =
        common::create_test_user(&pool, "target@test.com", "target", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &target_id, &server_id, "member").await;
    let room1_id = common::create_room(&pool, &server_id, "Room 1", &owner_id).await;
    let room2_id = common::create_room(&pool, &server_id, "Room 2", &owner_id).await;

    let mut ws_target = ws_connect(&base, &target_token).await;
    drain_messages(&mut ws_target).await;

    // Target joins room 1 via WS
    send_json(
        &mut ws_target,
        &json!({"type": "voice_state_update", "channelId": room1_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws_target).await;

    // Owner force moves target from room 1 to room 2
    let client = reqwest::Client::new();
    let res = client
        .post(format!(
            "{}/api/servers/{}/rooms/{}/move",
            base, server_id, room1_id
        ))
        .header("Authorization", format!("Bearer {}", owner_token))
        .json(&json!({
            "userId": target_id,
            "targetChannelId": room2_id
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 204);

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws_target).await;
    let has_force_move = msgs.iter().any(|m| {
        m["type"] == "room_force_move"
            && m["targetChannelId"] == room2_id
            && m["targetChannelName"] == "Room 2"
    });
    assert!(has_force_move, "Target should receive room_force_move event");
}
