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
async fn auth_info_no_spotify_account() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/spotify/auth-info")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["linked"], false);
    assert!(body["displayName"].is_null());
}

#[tokio::test]
async fn auth_info_with_spotify_linked() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    common::link_spotify_account(&pool, &user_id, "SpotifyUser").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/spotify/auth-info")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["linked"], true);
    assert_eq!(body["displayName"], "SpotifyUser");
}

#[tokio::test]
async fn init_auth_returns_state_and_redirect() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/init-auth")
        .add_header(h, v)
        .json(&json!({ "codeVerifier": "test-verifier-string" }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["state"].as_str().is_some());
    assert!(!body["state"].as_str().unwrap().is_empty());
    assert!(body["redirectUri"].as_str().is_some());
    assert!(!body["redirectUri"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn init_auth_cleans_previous_entries() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    // First call
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/init-auth")
        .add_header(h, v)
        .json(&json!({ "codeVerifier": "verifier-one" }))
        .await;

    res.assert_status_ok();
    let body1: serde_json::Value = res.json();
    let state1 = body1["state"].as_str().unwrap().to_string();

    // Second call should still work (old entry cleaned)
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/init-auth")
        .add_header(h, v)
        .json(&json!({ "codeVerifier": "verifier-two" }))
        .await;

    res.assert_status_ok();
    let body2: serde_json::Value = res.json();
    let state2 = body2["state"].as_str().unwrap().to_string();

    // States should be different (new nonce each time)
    assert_ne!(state1, state2);
}

#[tokio::test]
async fn unlink_spotify() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    common::link_spotify_account(&pool, &user_id, "SpotifyUser").await;

    // Verify linked
    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/spotify/auth-info")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["linked"], true);

    // Unlink
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/unlink")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["success"], true);

    // Verify unlinked
    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/spotify/auth-info")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["linked"], false);
}

#[tokio::test]
async fn unlink_spotify_no_account() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    // Unlink when not linked should still succeed (idempotent)
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/spotify/unlink")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["success"], true);
}

#[tokio::test]
async fn get_token_not_linked() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/spotify/token")
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::UNAUTHORIZED);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Spotify not linked");
}
