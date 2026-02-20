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
async fn list_whitelist_as_admin() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let _server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server.get("/api/whitelist").add_header(h, v).await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert!(body.is_empty());
}

#[tokio::test]
async fn list_whitelist_forbidden_for_member() {
    let (server, pool) = setup().await;

    let (owner_id, _owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;

    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;

    let (h, v) = auth_header(&member_token);
    let res = server.get("/api/whitelist").add_header(h, v).await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Insufficient permissions");
}

#[tokio::test]
async fn add_to_whitelist() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let _server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/whitelist")
        .add_header(h, v)
        .json(&json!({ "emails": ["alice@test.com", "bob@test.com"] }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 2);
    assert_eq!(body[0]["email"], "alice@test.com");
    assert_eq!(body[1]["email"], "bob@test.com");
}

#[tokio::test]
async fn add_duplicate_email_ignored() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let _server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    // First add
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/whitelist")
        .add_header(h, v)
        .json(&json!({ "emails": ["alice@test.com"] }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 1);

    // Second add of same email — should return empty because INSERT OR IGNORE
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/whitelist")
        .add_header(h, v)
        .json(&json!({ "emails": ["alice@test.com"] }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: Vec<serde_json::Value> = res.json();
    assert!(body.is_empty());
}

#[tokio::test]
async fn remove_from_whitelist() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let _server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    // Add an email
    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/whitelist")
        .add_header(h, v)
        .json(&json!({ "emails": ["alice@test.com"] }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: Vec<serde_json::Value> = res.json();
    let entry_id = body[0]["id"].as_str().unwrap().to_string();

    // Delete
    let (h, v) = auth_header(&token);
    let res = server
        .delete(&format!("/api/whitelist/{}", entry_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NO_CONTENT);

    // Verify it's gone
    let (h, v) = auth_header(&token);
    let res = server.get("/api/whitelist").add_header(h, v).await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert!(body.is_empty());
}

#[tokio::test]
async fn remove_forbidden_for_member() {
    let (server, pool) = setup().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;

    // Add an email as owner
    let (h, v) = auth_header(&owner_token);
    let res = server
        .post("/api/whitelist")
        .add_header(h, v)
        .json(&json!({ "emails": ["alice@test.com"] }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: Vec<serde_json::Value> = res.json();
    let entry_id = body[0]["id"].as_str().unwrap().to_string();

    // Create a member
    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;
    common::add_member(&pool, &member_id, &server_id, "member").await;

    // Member tries to delete
    let (h, v) = auth_header(&member_token);
    let res = server
        .delete(&format!("/api/whitelist/{}", entry_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Insufficient permissions");
}
