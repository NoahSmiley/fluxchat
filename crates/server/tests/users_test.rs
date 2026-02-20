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
async fn get_me_returns_profile() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server.get("/api/users/me").add_header(h, v).await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["id"], user_id);
    assert_eq!(body["username"], "alice");
    assert_eq!(body["email"], "alice@test.com");
    assert_eq!(body["ringStyle"], "default");
    assert_eq!(body["ringSpin"], false);
    assert_eq!(body["status"], "online");
}

#[tokio::test]
async fn get_me_without_auth_returns_401() {
    let (server, _pool) = setup().await;

    let res = server.get("/api/users/me").await;

    res.assert_status(StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn update_username() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({ "username": "newname" }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["username"], "newname");
}

#[tokio::test]
async fn update_username_too_short() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({ "username": "a" }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Username must be 2-32 characters");
}

#[tokio::test]
async fn update_username_invalid_chars() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({ "username": "bad name!" }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(
        body["error"],
        "Username can only contain letters, numbers, hyphens, and underscores"
    );
}

#[tokio::test]
async fn update_username_already_taken() {
    let (server, pool) = setup().await;

    common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    let (h, v) = auth_header(&token2);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({ "username": "alice" }))
        .await;

    res.assert_status(StatusCode::CONFLICT);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Username already taken");
}

#[tokio::test]
async fn update_ring_style() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({ "ringStyle": "chroma" }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["ringStyle"], "chroma");
}

#[tokio::test]
async fn update_ring_style_invalid() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({ "ringStyle": "garbage" }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Invalid ring style");
}

#[tokio::test]
async fn update_image_to_null() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({ "image": null }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["image"].is_null());
}

#[tokio::test]
async fn update_no_fields_returns_400() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch("/api/users/me")
        .add_header(h, v)
        .json(&json!({}))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "No fields to update");
}
