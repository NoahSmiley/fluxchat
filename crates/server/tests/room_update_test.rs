mod common;

use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum_test::TestServer;
use serde_json::json;

fn auth_header(token: &str) -> (HeaderName, HeaderValue) {
    (
        HeaderName::from_static("authorization"),
        format!("Bearer {}", token).parse().unwrap(),
    )
}

async fn setup() -> (TestServer, sqlx::SqlitePool) {
    let pool = common::setup_test_db().await;
    let app = common::create_test_app(pool.clone());
    let server = TestServer::new(app).unwrap();
    (server, pool)
}

// ── Room Update/Lock Tests (5) ──

#[tokio::test]
async fn update_room_lock_as_creator() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (creator_id, creator_token) =
        common::create_test_user(&pool, "creator@test.com", "creator", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &creator_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "My Room", &creator_id).await;

    let (h, v) = auth_header(&creator_token);
    let res = server
        .patch(&format!("/api/servers/{}/channels/{}", server_id, room_id))
        .add_header(h, v)
        .json(&json!({ "isLocked": true }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["isLocked"], 1);
}

#[tokio::test]
async fn update_room_lock_as_admin() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (creator_id, _) =
        common::create_test_user(&pool, "creator@test.com", "creator", "pass123").await;
    let (admin_id, admin_token) =
        common::create_test_user(&pool, "admin@test.com", "admin", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &creator_id, &server_id, "member").await;
    common::add_member(&pool, &admin_id, &server_id, "admin").await;
    let room_id = common::create_room(&pool, &server_id, "Their Room", &creator_id).await;

    let (h, v) = auth_header(&admin_token);
    let res = server
        .patch(&format!("/api/servers/{}/channels/{}", server_id, room_id))
        .add_header(h, v)
        .json(&json!({ "isLocked": true }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["isLocked"], 1);
}

#[tokio::test]
async fn update_room_lock_as_member_returns_403() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (creator_id, _) =
        common::create_test_user(&pool, "creator@test.com", "creator", "pass123").await;
    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &creator_id, &server_id, "member").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Their Room", &creator_id).await;

    let (h, v) = auth_header(&member_token);
    let res = server
        .patch(&format!("/api/servers/{}/channels/{}", server_id, room_id))
        .add_header(h, v)
        .json(&json!({ "isLocked": true }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn update_room_rename_as_creator() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (creator_id, creator_token) =
        common::create_test_user(&pool, "creator@test.com", "creator", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &creator_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "old-name", &creator_id).await;

    let (h, v) = auth_header(&creator_token);
    let res = server
        .patch(&format!("/api/servers/{}/channels/{}", server_id, room_id))
        .add_header(h, v)
        .json(&json!({ "name": "new-name" }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["name"], "new-name");
}

#[tokio::test]
async fn update_room_rename_as_member_returns_403() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (creator_id, _) =
        common::create_test_user(&pool, "creator@test.com", "creator", "pass123").await;
    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &creator_id, &server_id, "member").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "their-room", &creator_id).await;

    let (h, v) = auth_header(&member_token);
    let res = server
        .patch(&format!("/api/servers/{}/channels/{}", server_id, room_id))
        .add_header(h, v)
        .json(&json!({ "name": "hijacked" }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}

// ── Room Deletion Tests (3) ──

#[tokio::test]
async fn delete_empty_room_as_creator() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Temp Room", &user_id).await;

    let (h, v) = auth_header(&token);
    let res = server
        .delete(&format!("/api/servers/{}/channels/{}", server_id, room_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NO_CONTENT);

    // Verify room is gone from DB
    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM channels WHERE id = ?")
            .bind(&room_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "Room should be deleted from database");
}

#[tokio::test]
async fn delete_room_with_participants_returns_403() {
    // This test uses a live server with WebSocket to add a voice participant.
    // The axum-test TestServer doesn't run the gateway, so we start a real server.
    let pool = common::setup_test_db().await;
    let app = common::create_test_app(pool.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://127.0.0.1:{}", addr.port());

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Active Room", &user_id).await;

    // Connect via WS and join voice in this room
    use futures::SinkExt;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    let ws_url = format!("{}/gateway?token={}", base.replace("http://", "ws://"), token);
    let (mut ws, _) = connect_async(&ws_url).await.unwrap();

    // Drain initial messages
    loop {
        let timeout = tokio::time::timeout(std::time::Duration::from_millis(200),
            futures::StreamExt::next(&mut ws)).await;
        match timeout {
            Ok(Some(Ok(_))) => {},
            _ => break,
        }
    }

    // Join voice in the room
    ws.send(Message::Text(
        serde_json::to_string(&json!({
            "type": "voice_state_update",
            "channelId": room_id,
            "action": "join"
        }))
        .unwrap()
        .into(),
    ))
    .await
    .unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Try to delete room via HTTP — should fail
    let client = reqwest::Client::new();
    let res = client
        .delete(format!("{}/api/servers/{}/channels/{}", base, server_id, room_id))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 403, "Cannot delete a room with active participants");
}

#[tokio::test]
async fn delete_room_as_member_returns_403() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (creator_id, _) =
        common::create_test_user(&pool, "creator@test.com", "creator", "pass123").await;
    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &creator_id, &server_id, "member").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;
    let room_id = common::create_room(&pool, &server_id, "Not Yours", &creator_id).await;

    let (h, v) = auth_header(&member_token);
    let res = server
        .delete(&format!("/api/servers/{}/channels/{}", server_id, room_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}
