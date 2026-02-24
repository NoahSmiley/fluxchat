mod common;

use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum_test::TestServer;

fn auth_header(token: &str) -> (HeaderName, HeaderValue) {
    (
        HeaderName::from_static("authorization"),
        format!("Bearer {}", token).parse().unwrap(),
    )
}

async fn setup_with_channel() -> (TestServer, sqlx::SqlitePool, String, String, String, String) {
    let pool = common::setup_test_db().await;
    let app = common::create_test_app(pool.clone());
    let server = TestServer::new(app).unwrap();

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let server_id = uuid::Uuid::new_v4().to_string();
    let channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, 'Test', ?, 'inv', ?)",
    )
    .bind(&server_id)
    .bind(&user_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO memberships (user_id, server_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
    )
    .bind(&user_id)
    .bind(&server_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        "INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, 'general', 'text', 0, ?)",
    )
    .bind(&channel_id)
    .bind(&server_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    (server, pool, user_id, token, server_id, channel_id)
}

async fn insert_message(pool: &sqlx::SqlitePool, channel_id: &str, sender_id: &str, content: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(channel_id)
    .bind(sender_id)
    .bind(content)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();

    // Also insert into FTS index
    sqlx::query("INSERT INTO messages_fts (message_id, plaintext) VALUES (?, ?)")
        .bind(&id)
        .bind(content)
        .execute(pool)
        .await
        .unwrap();

    id
}

#[tokio::test]
async fn list_messages_empty_channel() {
    let (server, _pool, _user_id, token, _server_id, channel_id) =
        setup_with_channel().await;

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/channels/{}/messages", channel_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["items"].as_array().unwrap().len(), 0);
    assert_eq!(body["hasMore"], false);
}

#[tokio::test]
async fn list_messages_with_pagination() {
    let (server, pool, user_id, token, _server_id, channel_id) =
        setup_with_channel().await;

    // Insert messages (more than default limit to test pagination logic)
    for i in 0..5 {
        insert_message(&pool, &channel_id, &user_id, &format!("msg {}", i)).await;
        // Small delay to ensure distinct timestamps
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/channels/{}/messages?limit=3", channel_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let items = body["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(body["hasMore"], true);
    assert!(body["cursor"].as_str().is_some());
}

#[tokio::test]
async fn list_messages_non_member_returns_403() {
    let (server, pool, _user_id, _token, _server_id, channel_id) =
        setup_with_channel().await;

    let (_, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .get(&format!("/api/channels/{}/messages", channel_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn search_messages_fts() {
    let (server, pool, user_id, token, _server_id, channel_id) =
        setup_with_channel().await;

    insert_message(&pool, &channel_id, &user_id, "hello world").await;
    insert_message(&pool, &channel_id, &user_id, "goodbye world").await;
    insert_message(&pool, &channel_id, &user_id, "testing 123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!(
            "/api/channels/{}/messages/search?q=hello",
            channel_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let items = body["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["content"], "hello world");
}

#[tokio::test]
async fn search_server_messages_with_sender_filter() {
    let (server, pool, user_id, token, server_id, channel_id) =
        setup_with_channel().await;

    let (user2_id, _) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    // Add user2 as member
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO memberships (user_id, server_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    )
    .bind(&user2_id)
    .bind(&server_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    insert_message(&pool, &channel_id, &user_id, "alice's message").await;
    insert_message(&pool, &channel_id, &user2_id, "bob's message").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!(
            "/api/servers/{}/messages/search?sender_id={}",
            server_id, user2_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let items = body["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["senderId"], user2_id);
}

#[tokio::test]
async fn get_reactions_for_messages() {
    let (server, pool, user_id, token, _server_id, channel_id) =
        setup_with_channel().await;

    let msg_id = insert_message(&pool, &channel_id, &user_id, "react to me").await;

    // Add a reaction
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, '👍', ?)",
    )
    .bind(uuid::Uuid::new_v4().to_string())
    .bind(&msg_id)
    .bind(&user_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/messages/reactions?ids={}", msg_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["emoji"], "👍");
    assert_eq!(body[0]["messageId"], msg_id);
}
