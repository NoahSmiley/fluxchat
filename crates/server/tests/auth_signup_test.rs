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
