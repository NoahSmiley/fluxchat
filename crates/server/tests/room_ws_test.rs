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
