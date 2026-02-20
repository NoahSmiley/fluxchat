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

#[tokio::test]
async fn add_to_queue_and_get() {
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
    let body: serde_json::Value = res.json();
    let session_id = body["sessionId"].as_str().unwrap().to_string();

    // Add track to queue
    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/spotify/sessions/{}/queue", session_id))
        .add_header(h, v)
        .json(&json!({
            "trackUri": "spotify:track:abc123",
            "trackName": "Test Song",
            "trackArtist": "Test Artist",
            "trackAlbum": "Test Album",
            "trackImageUrl": "https://img.example.com/cover.jpg",
            "trackDurationMs": 210000,
            "source": "spotify"
        }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["id"].as_str().is_some());

    // Verify the track is in the queue via get session
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
    let queue = body["queue"].as_array().unwrap();
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0]["trackName"], "Test Song");
    assert_eq!(queue[0]["trackArtist"], "Test Artist");
}

#[tokio::test]
async fn remove_from_queue() {
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
    let body: serde_json::Value = res.json();
    let session_id = body["sessionId"].as_str().unwrap().to_string();

    // Add track to queue
    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/spotify/sessions/{}/queue", session_id))
        .add_header(h, v)
        .json(&json!({
            "trackUri": "spotify:track:xyz789",
            "trackName": "Remove Me",
            "trackArtist": "Artist",
            "trackDurationMs": 180000,
            "source": "spotify"
        }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let item_id = body["id"].as_str().unwrap().to_string();

    // Remove from queue
    let (h, v) = auth_header(&token);
    let res = server
        .delete(&format!(
            "/api/spotify/sessions/{}/queue/{}",
            session_id, item_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["success"], true);

    // Verify queue is now empty
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
    assert!(body["queue"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn delete_session_only_host() {
    let (server, pool) = setup().await;

    let (_user_a_id, token_a) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_user_b_id, token_b) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    let voice_channel_id = uuid::Uuid::new_v4().to_string();

    // User A creates session (becomes host)
    let (h, v) = auth_header(&token_a);
    let res = server
        .post("/api/spotify/sessions")
        .add_header(h, v)
        .json(&json!({ "voiceChannelId": voice_channel_id }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let session_id = body["sessionId"].as_str().unwrap().to_string();

    // User B tries to delete the session (not the host)
    let (h, v) = auth_header(&token_b);
    let res = server
        .delete(&format!("/api/spotify/sessions/{}/end", session_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Not the host");

    // Host (User A) can delete
    let (h, v) = auth_header(&token_a);
    let res = server
        .delete(&format!("/api/spotify/sessions/{}/end", session_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["success"], true);
}
