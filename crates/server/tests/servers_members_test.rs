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

async fn setup_with_server() -> (TestServer, sqlx::SqlitePool, String, String, String) {
    let pool = common::setup_test_db().await;
    let app = common::create_test_app(pool.clone());
    let server = TestServer::new(app).unwrap();

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;

    // Create a server + membership
    let server_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, 'TestServer', ?, 'test-invite', ?)",
    )
    .bind(&server_id)
    .bind(&user_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO memberships (user_id, server_id, role, joined_at, role_updated_at) VALUES (?, ?, 'owner', ?, ?)",
    )
    .bind(&user_id)
    .bind(&server_id)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Create default channels
    sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, 'general', 'text', 0, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&server_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    (server, pool, user_id, token, server_id)
}

#[tokio::test]
async fn list_channels_ordered_by_position() {
    let (server, pool, _user_id, token, server_id) = setup_with_server().await;

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, 'second', 'text', 1, ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&server_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 2);
    assert_eq!(body[0]["name"], "general");
    assert_eq!(body[1]["name"], "second");
}

#[tokio::test]
async fn list_members_with_user_details() {
    let (server, _pool, _user_id, token, server_id) = setup_with_server().await;

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/servers/{}/members", server_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["username"], "owner");
    assert_eq!(body[0]["role"], "owner");
}

#[tokio::test]
async fn leave_server_as_member() {
    let (server, pool, _user_id, _token, server_id) = setup_with_server().await;

    let (member_id, member_token) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO memberships (user_id, server_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    )
    .bind(&member_id)
    .bind(&server_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&member_token);
    let res = server
        .delete(&format!("/api/servers/{}/members/me", server_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn leave_server_as_owner_blocked() {
    let (server, _pool, _user_id, token, server_id) = setup_with_server().await;

    let (h, v) = auth_header(&token);
    let res = server
        .delete(&format!("/api/servers/{}/members/me", server_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_member_role() {
    let (server, pool, _owner_id, owner_token, server_id) = setup_with_server().await;

    let (member_id, _) =
        common::create_test_user(&pool, "member@test.com", "member", "pass123").await;

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO memberships (user_id, server_id, role, joined_at, role_updated_at) VALUES (?, ?, 'member', ?, ?)",
    )
    .bind(&member_id)
    .bind(&server_id)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&owner_token);
    let res = server
        .patch(&format!("/api/members/{}/role", member_id))
        .add_header(h, v)
        .json(&json!({ "role": "admin" }))
        .await;

    res.assert_status(StatusCode::NO_CONTENT);

    // Verify role changed
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&member_id)
    .bind(&server_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(role, "admin");
}

#[tokio::test]
async fn update_server_name() {
    let (server, _pool, _user_id, token, server_id) = setup_with_server().await;

    let (h, v) = auth_header(&token);
    let res = server
        .patch(&format!("/api/servers/{}", server_id))
        .add_header(h, v)
        .json(&json!({ "name": "Renamed Server" }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["name"], "Renamed Server");
}
