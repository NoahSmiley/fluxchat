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
async fn set_public_key() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .put("/api/users/me/public-key")
        .add_header(h, v)
        .json(&json!({ "publicKey": "dGVzdC1wdWJsaWMta2V5LWJhc2U2NA==" }))
        .await;

    res.assert_status(StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn get_public_key_existing() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    // Set the public key first
    let (h, v) = auth_header(&token);
    server
        .put("/api/users/me/public-key")
        .add_header(h, v)
        .json(&json!({ "publicKey": "dGVzdC1wdWJsaWMta2V5LWJhc2U2NA==" }))
        .await
        .assert_status(StatusCode::NO_CONTENT);

    // Now retrieve it
    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/users/{}/public-key", user_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["publicKey"], "dGVzdC1wdWJsaWMta2V5LWJhc2U2NA==");
}

#[tokio::test]
async fn get_public_key_not_set() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/users/{}/public-key", user_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["publicKey"].is_null());
}

#[tokio::test]
async fn get_public_key_user_not_found() {
    let (server, pool) = setup().await;

    let (_, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/users/nonexistent-user-id/public-key")
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NOT_FOUND);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "User not found");
}

#[tokio::test]
async fn store_server_key() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/keys", server_id))
        .add_header(h, v)
        .json(&json!({
            "encryptedKey": "encrypted-group-key-base64",
            "senderId": user_id
        }))
        .await;

    res.assert_status(StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn store_server_key_not_member() {
    let (server, pool) = setup().await;

    let (owner_id, _) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (outsider_id, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .post(&format!("/api/servers/{}/keys", server_id))
        .add_header(h, v)
        .json(&json!({
            "encryptedKey": "encrypted-group-key-base64",
            "senderId": outsider_id
        }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Not a member");
}

#[tokio::test]
async fn get_my_server_key_exists() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    // Store a key first
    let (h, v) = auth_header(&token);
    server
        .post(&format!("/api/servers/{}/keys", server_id))
        .add_header(h, v)
        .json(&json!({
            "encryptedKey": "encrypted-group-key-base64",
            "senderId": user_id
        }))
        .await
        .assert_status(StatusCode::NO_CONTENT);

    // Now retrieve it
    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/servers/{}/keys/me", server_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["encryptedKey"], "encrypted-group-key-base64");
    assert_eq!(body["senderId"], user_id);
}

#[tokio::test]
async fn share_server_key_with_member() {
    let (server, pool) = setup().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let (member_id, _) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;

    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;

    let (h, v) = auth_header(&owner_token);
    let res = server
        .post(&format!(
            "/api/servers/{}/keys/{}",
            server_id, member_id
        ))
        .add_header(h, v)
        .json(&json!({
            "encryptedKey": "wrapped-key-for-member",
            "senderId": owner_id
        }))
        .await;

    res.assert_status(StatusCode::NO_CONTENT);
}
