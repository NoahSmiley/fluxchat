mod common;

use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum_test::multipart::{MultipartForm, Part};
use axum_test::TestServer;


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
    std::fs::create_dir_all("/tmp/flux-test-uploads").ok();
    (server, pool)
}

#[tokio::test]
async fn link_preview_missing_url() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/link-preview")
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Missing url parameter");
}

#[tokio::test]
async fn link_preview_empty_url() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/link-preview?url=")
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Missing url parameter");
}

#[tokio::test]
async fn link_preview_returns_cached() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    // Insert a cached link preview directly
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO link_previews (url, title, description, image, domain, fetched_at) VALUES (?, 'Cached Title', 'Cached desc', 'https://img.example.com/og.jpg', 'example.com', ?)",
    )
    .bind("https://example.com/page")
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .get("/api/link-preview?url=https%3A%2F%2Fexample.com%2Fpage")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["title"], "Cached Title");
    assert_eq!(body["description"], "Cached desc");
    assert_eq!(body["image"], "https://img.example.com/og.jpg");
    assert_eq!(body["domain"], "example.com");
}

#[tokio::test]
async fn link_preview_without_auth() {
    let (server, _pool) = setup().await;

    let res = server.get("/api/link-preview?url=https://example.com").await;

    // Without auth, the AuthUser extractor will fail
    let status = res.status_code();
    assert!(
        status == StatusCode::UNAUTHORIZED || status == StatusCode::BAD_REQUEST,
        "Expected 401 or 400, got {}",
        status
    );
}

#[tokio::test]
async fn upload_then_link_to_message() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let form = MultipartForm::new().add_part(
        "file",
        Part::bytes(b"attachment data".to_vec())
            .file_name("doc.pdf")
            .mime_type("application/pdf"),
    );

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/upload")
        .add_header(h, v)
        .multipart(form)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let attachment_id = body["id"].as_str().unwrap().to_string();

    // Verify attachment exists with message_id = NULL
    let msg_id = sqlx::query_scalar::<_, Option<String>>(
        "SELECT message_id FROM attachments WHERE id = ?",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(msg_id.is_none());

    // Verify uploader_id is correct
    let uploader = sqlx::query_scalar::<_, String>(
        "SELECT uploader_id FROM attachments WHERE id = ?",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(uploader, user_id);

    // Create a real message to link to (needs a server + channel first)
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let channel_id = sqlx::query_scalar::<_, String>(
        "SELECT id FROM channels WHERE server_id = ? LIMIT 1",
    )
    .bind(&server_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let message_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO messages (id, channel_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
    )
    .bind(&message_id)
    .bind(&channel_id)
    .bind(&user_id)
    .bind("test message")
    .execute(&pool)
    .await
    .unwrap();

    // Link attachment to the message
    sqlx::query("UPDATE attachments SET message_id = ? WHERE id = ?")
        .bind(&message_id)
        .bind(&attachment_id)
        .execute(&pool)
        .await
        .unwrap();

    // Verify it's now linked
    let linked_msg_id = sqlx::query_scalar::<_, Option<String>>(
        "SELECT message_id FROM attachments WHERE id = ?",
    )
    .bind(&attachment_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(linked_msg_id.unwrap(), message_id);
}
