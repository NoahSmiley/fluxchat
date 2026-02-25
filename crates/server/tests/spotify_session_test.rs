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
async fn create_session() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let voice_channel_id = uuid::Uuid::new_v4().to_string();

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/sessions")
        .add_header(h, v)
        .json(&json!({ "voiceChannelId": voice_channel_id }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["sessionId"].as_str().is_some());
    assert!(!body["sessionId"].as_str().unwrap().is_empty());
    // First creation should not have "existing" field set to true
    assert!(body.get("existing").is_none() || body["existing"] != true);
}

#[tokio::test]
async fn create_session_returns_existing() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let voice_channel_id = uuid::Uuid::new_v4().to_string();

    // Create first session
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/sessions")
        .add_header(h, v)
        .json(&json!({ "voiceChannelId": voice_channel_id }))
        .await;

    res.assert_status_ok();
    let body1: serde_json::Value = res.json();
    let session_id = body1["sessionId"].as_str().unwrap().to_string();

    // Create again for same channel
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/sessions")
        .add_header(h, v)
        .json(&json!({ "voiceChannelId": voice_channel_id }))
        .await;

    res.assert_status_ok();
    let body2: serde_json::Value = res.json();
    assert_eq!(body2["sessionId"], session_id);
    assert_eq!(body2["existing"], true);
}

#[tokio::test]
async fn get_session_exists() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let voice_channel_id = uuid::Uuid::new_v4().to_string();

    // Create session
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/sessions")
        .add_header(h, v)
        .json(&json!({ "voiceChannelId": voice_channel_id }))
        .await;

    res.assert_status_ok();

    // Get session by channel ID
    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!(
            "/api/spotify/sessions/channel/{}",
            voice_channel_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["session"].is_object());
    assert_eq!(body["session"]["voiceChannelId"], voice_channel_id);
    assert!(body["queue"].is_array());
}

#[tokio::test]
async fn get_session_not_found() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let random_channel_id = uuid::Uuid::new_v4().to_string();

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!(
            "/api/spotify/sessions/channel/{}",
            random_channel_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["session"].is_null());
    assert!(body["queue"].as_array().unwrap().is_empty());
}
