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
async fn voice_token_channel_not_found() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/voice/token")
        .add_header(h, v)
        .json(&json!({ "channelId": "nonexistent-channel-id" }))
        .await;

    res.assert_status(StatusCode::NOT_FOUND);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Channel not found");
}

#[tokio::test]
async fn voice_token_not_a_voice_channel() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let text_channel_id = common::create_text_channel(&pool, &server_id, "chat").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/voice/token")
        .add_header(h, v)
        .json(&json!({ "channelId": text_channel_id }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Not a voice channel");
}

#[tokio::test]
async fn voice_token_not_a_member() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (_, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    let voice_channel_id = common::create_voice_channel(&pool, &server_id, "Voice").await;

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .post("/api/voice/token")
        .add_header(h, v)
        .json(&json!({ "channelId": voice_channel_id }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Not a member of this server");
}

#[tokio::test]
async fn voice_token_livekit_not_configured() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let voice_channel_id = common::create_voice_channel(&pool, &server_id, "Voice").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/voice/token")
        .add_header(h, v)
        .json(&json!({ "channelId": voice_channel_id }))
        .await;

    res.assert_status(StatusCode::SERVICE_UNAVAILABLE);
    let body: serde_json::Value = res.json();
    assert!(body["error"].as_str().unwrap().contains("LiveKit not configured"));
}

#[tokio::test]
async fn voice_token_with_livekit_configured() {
    use flux_server::{config::Config, routes, ws, AppState};
    use std::sync::Arc;

    let pool = common::setup_test_db().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let voice_channel_id = common::create_voice_channel(&pool, &server_id, "Voice").await;

    // Create a custom app with LiveKit configured
    let state = Arc::new(AppState {
        db: pool.clone(),
        config: Config {
            host: "127.0.0.1".into(),
            port: 0,
            database_path: ":memory:".into(),
            auth_secret: "test-secret".into(),
            livekit_api_key: "devkey".into(),
            livekit_api_secret: "secret-that-is-at-least-256-bits-long-for-hmac".into(),
            livekit_url: "ws://localhost:7880".into(),
            upload_dir: "/tmp/flux-test-uploads".into(),
            max_upload_bytes: 10_485_760,
        },
        gateway: Arc::new(ws::gateway::GatewayState::new()),
        spotify_auth_pending: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        youtube_url_cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
    });
    let server = TestServer::new(routes::build_router(state)).unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/voice/token")
        .add_header(h, v)
        .json(&json!({ "channelId": voice_channel_id }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["token"].as_str().is_some());
    assert!(!body["token"].as_str().unwrap().is_empty());
    assert_eq!(body["url"], "ws://localhost:7880");
}
