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

#[tokio::test]
async fn list_sounds_empty() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert!(body.is_empty());
}

#[tokio::test]
async fn list_sounds_not_member() {
    let (server, pool) = setup().await;

    let (owner_id, _owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;

    let (_outsider_id, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .get(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Not a member of this server");
}

#[tokio::test]
async fn create_sound_as_admin() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let attachment_id =
        common::create_test_attachment(&pool, &user_id, "sound.mp3", "audio/mpeg").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Test Sound",
            "audioAttachmentId": attachment_id,
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    assert_eq!(body["name"], "Test Sound");
    assert_eq!(body["volume"], 0.5);
    assert_eq!(body["serverId"], server_id);
    assert!(body["id"].as_str().is_some());
}

#[tokio::test]
async fn create_sound_not_admin() {
    let (server, pool) = setup().await;

    let (owner_id, _owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;

    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;

    let attachment_id =
        common::create_test_attachment(&pool, &member_id, "sound.mp3", "audio/mpeg").await;

    let (h, v) = auth_header(&member_token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Test Sound",
            "audioAttachmentId": attachment_id,
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Insufficient permissions");
}

#[tokio::test]
async fn create_sound_empty_name() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let attachment_id =
        common::create_test_attachment(&pool, &user_id, "sound.mp3", "audio/mpeg").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "",
            "audioAttachmentId": attachment_id,
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Name is required");
}

#[tokio::test]
async fn create_sound_invalid_attachment() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Test Sound",
            "audioAttachmentId": "nonexistent-attachment-id",
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Invalid audio attachment");
}
