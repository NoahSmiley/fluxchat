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

// ── Room Creation Tests (6) ──

#[tokio::test]
async fn create_room_as_member() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;

    let (h, v) = auth_header(&member_token);
    let res = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Chill Room",
            "type": "voice",
            "isRoom": true
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    assert_eq!(body["isRoom"], 1);
    assert_eq!(body["type"], "voice");
    assert_eq!(body["creatorId"], member_id);
    assert_eq!(body["name"], "Chill Room");
}

#[tokio::test]
async fn create_room_as_nonmember_returns_403() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (_, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Sneaky Room",
            "type": "voice",
            "isRoom": true
        }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn create_room_forces_voice_type() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Text Room Attempt",
            "type": "text",
            "isRoom": true
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    assert_eq!(body["type"], "voice", "Room should always be voice type");
}

#[tokio::test]
async fn create_room_ignores_parent_id() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "No Parent Room",
            "type": "voice",
            "isRoom": true,
            "parentId": "some-fake-parent-id"
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    assert!(body["parentId"].is_null(), "Room parentId should always be null");
}

#[tokio::test]
async fn create_room_name_validation() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    // Empty name
    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h.clone(), v.clone())
        .json(&json!({
            "name": "",
            "type": "voice",
            "isRoom": true
        }))
        .await;
    res.assert_status(StatusCode::BAD_REQUEST);

    // 65-char name (exceeds 64 limit)
    let long_name = "a".repeat(65);
    let (h2, v2) = auth_header(&token);
    let res2 = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h2, v2)
        .json(&json!({
            "name": long_name,
            "type": "voice",
            "isRoom": true
        }))
        .await;
    res2.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_room_defaults() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Default Room",
            "type": "voice",
            "isRoom": true
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    assert_eq!(body["isLocked"], 0, "Room should be unlocked by default");
}
