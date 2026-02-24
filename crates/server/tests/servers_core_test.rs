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
async fn list_servers_returns_user_servers() {
    let (server, _pool, _user_id, token, server_id) = setup_with_server().await;

    let (h, v) = auth_header(&token);
    let res = server.get("/api/servers").add_header(h, v).await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["id"], server_id);
    assert_eq!(body[0]["role"], "owner");
}

#[tokio::test]
async fn get_server_as_member() {
    let (server, _pool, _user_id, token, server_id) = setup_with_server().await;

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/servers/{}", server_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["id"], server_id);
    assert_eq!(body["role"], "owner");
}

#[tokio::test]
async fn get_server_as_non_member_returns_403() {
    let (server, pool, _user_id, _token, server_id) = setup_with_server().await;

    let (_, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .get(&format!("/api/servers/{}", server_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn create_channel_as_owner() {
    let (server, _pool, _user_id, token, server_id) = setup_with_server().await;

    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "new-channel",
            "type": "text"
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    assert_eq!(body["name"], "new-channel");
    assert_eq!(body["type"], "text");
    assert_eq!(body["serverId"], server_id);
}

#[tokio::test]
async fn create_channel_as_member_returns_403() {
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
        .post(&format!("/api/servers/{}/channels", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "hacky-channel",
            "type": "text"
        }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn update_channel() {
    let (server, pool, _user_id, token, server_id) = setup_with_server().await;

    let channel_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM channels WHERE server_id = ? LIMIT 1",
    )
    .bind(&server_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .patch(&format!(
            "/api/servers/{}/channels/{}",
            server_id, channel_id
        ))
        .add_header(h, v)
        .json(&json!({ "name": "renamed" }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["name"], "renamed");
}

#[tokio::test]
async fn delete_channel() {
    let (server, pool, _user_id, token, server_id) = setup_with_server().await;

    let channel_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM channels WHERE server_id = ? LIMIT 1",
    )
    .bind(&server_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .delete(&format!(
            "/api/servers/{}/channels/{}",
            server_id, channel_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NO_CONTENT);

    // Verify deleted
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM channels WHERE id = ?",
    )
    .bind(&channel_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 0);
}
