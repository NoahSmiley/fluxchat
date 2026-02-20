mod common;

use axum::http::{HeaderName, HeaderValue};
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
async fn sign_up_first_user_bypasses_whitelist() {
    let (server, _pool) = setup().await;

    let res = server
        .post("/api/auth/sign-up/email")
        .json(&json!({
            "email": "alice@test.com",
            "password": "password123",
            "name": "Alice",
            "username": "alice"
        }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["user"]["email"], "alice@test.com");
    assert_eq!(body["user"]["username"], "alice");
    assert!(body["token"].as_str().is_some());
}

#[tokio::test]
async fn sign_up_second_user_rejected_without_whitelist() {
    let (server, pool) = setup().await;

    // Create first user directly
    common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let res = server
        .post("/api/auth/sign-up/email")
        .json(&json!({
            "email": "bob@test.com",
            "password": "password123",
            "name": "Bob",
            "username": "bob"
        }))
        .await;

    res.assert_status(axum::http::StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Email not authorized");
}

#[tokio::test]
async fn sign_up_second_user_succeeds_with_whitelist() {
    let (server, pool) = setup().await;

    let (user_id, _) = common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    // Add bob to whitelist
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO email_whitelist (id, email, added_by, added_at) VALUES (?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind("bob@test.com")
        .bind(&user_id)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    let res = server
        .post("/api/auth/sign-up/email")
        .json(&json!({
            "email": "bob@test.com",
            "password": "password123",
            "name": "Bob",
            "username": "bob"
        }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["user"]["username"], "bob");
}

#[tokio::test]
async fn sign_up_duplicate_email_returns_409() {
    let (server, _pool) = setup().await;

    // Sign up first user (no whitelist needed — first user)
    server
        .post("/api/auth/sign-up/email")
        .json(&json!({
            "email": "alice@test.com",
            "password": "password123",
            "name": "Alice",
            "username": "alice"
        }))
        .await
        .assert_status_ok();

    // Add alice's email to whitelist for the second attempt
    let alice = sqlx::query_scalar::<_, String>(r#"SELECT id FROM "user" WHERE username = 'alice'"#)
        .fetch_one(&_pool)
        .await
        .unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO email_whitelist (id, email, added_by, added_at) VALUES (?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind("alice@test.com")
        .bind(&alice)
        .bind(&now)
        .execute(&_pool)
        .await
        .unwrap();

    let res = server
        .post("/api/auth/sign-up/email")
        .json(&json!({
            "email": "alice@test.com",
            "password": "password456",
            "name": "Alice2",
            "username": "alice2"
        }))
        .await;

    res.assert_status(axum::http::StatusCode::CONFLICT);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Email already registered");
}

#[tokio::test]
async fn sign_up_duplicate_username_returns_409() {
    let (server, pool) = setup().await;

    let (user_id, _) = common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    // Whitelist the second email
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO email_whitelist (id, email, added_by, added_at) VALUES (?, ?, ?, ?)")
        .bind(uuid::Uuid::new_v4().to_string())
        .bind("bob@test.com")
        .bind(&user_id)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    let res = server
        .post("/api/auth/sign-up/email")
        .json(&json!({
            "email": "bob@test.com",
            "password": "password123",
            "name": "Bob",
            "username": "alice"
        }))
        .await;

    res.assert_status(axum::http::StatusCode::CONFLICT);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Username already taken");
}

#[tokio::test]
async fn sign_up_short_username_returns_400() {
    let (server, _pool) = setup().await;

    let res = server
        .post("/api/auth/sign-up/email")
        .json(&json!({
            "email": "a@test.com",
            "password": "password123",
            "name": "A",
            "username": "a"
        }))
        .await;

    res.assert_status(axum::http::StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn sign_in_valid_credentials() {
    let (server, pool) = setup().await;

    common::create_test_user(&pool, "alice@test.com", "alice", "password123").await;

    let res = server
        .post("/api/auth/sign-in/email")
        .json(&json!({
            "email": "alice@test.com",
            "password": "password123"
        }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["user"]["email"], "alice@test.com");
    assert!(body["token"].as_str().is_some());
}

#[tokio::test]
async fn sign_in_wrong_password_returns_401() {
    let (server, pool) = setup().await;

    common::create_test_user(&pool, "alice@test.com", "alice", "password123").await;

    let res = server
        .post("/api/auth/sign-in/email")
        .json(&json!({
            "email": "alice@test.com",
            "password": "wrongpassword"
        }))
        .await;

    res.assert_status(axum::http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn sign_in_nonexistent_email_returns_401() {
    let (server, _pool) = setup().await;

    let res = server
        .post("/api/auth/sign-in/email")
        .json(&json!({
            "email": "nobody@test.com",
            "password": "password123"
        }))
        .await;

    res.assert_status(axum::http::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn sign_out_deletes_session() {
    let (server, pool) = setup().await;

    let (_, token) = common::create_test_user(&pool, "alice@test.com", "alice", "password123").await;

    // Sign out
    let res = server
        .post("/api/auth/sign-out")
        .add_header(auth_header(&token).0, auth_header(&token).1)
        .await;

    res.assert_status_ok();

    // Session should be deleted — get-session should return null
    let res = server
        .get("/api/auth/get-session")
        .add_header(auth_header(&token).0, auth_header(&token).1)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body.is_null());
}

#[tokio::test]
async fn get_session_with_valid_token() {
    let (server, pool) = setup().await;

    let (_, token) = common::create_test_user(&pool, "alice@test.com", "alice", "password123").await;

    let res = server
        .get("/api/auth/get-session")
        .add_header(auth_header(&token).0, auth_header(&token).1)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["user"]["username"], "alice");
}

#[tokio::test]
async fn get_session_with_missing_token_returns_null() {
    let (server, _pool) = setup().await;

    let res = server.get("/api/auth/get-session").await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body.is_null());
}

#[tokio::test]
async fn get_session_with_expired_token_returns_null() {
    let (server, pool) = setup().await;

    let user_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        r#"INSERT INTO "user" (id, name, username, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, 0, ?, ?)"#,
    )
    .bind(&user_id).bind("alice").bind("alice").bind("alice@test.com").bind(&now).bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Create an expired session
    let token = uuid::Uuid::new_v4().to_string();
    let expired = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
    sqlx::query(
        r#"INSERT INTO "session" (id, userId, token, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&user_id)
    .bind(&token)
    .bind(&expired)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let res = server
        .get("/api/auth/get-session")
        .add_header(auth_header(&token).0, auth_header(&token).1)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body.is_null());
}
