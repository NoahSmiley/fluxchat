mod common;

use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum_test::multipart::{MultipartForm, Part};
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
    std::fs::create_dir_all("/tmp/flux-test-uploads").ok();
    (server, pool)
}

#[tokio::test]
async fn upload_file_creates_attachment_record() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let form = MultipartForm::new().add_part(
        "file",
        Part::bytes(b"hello world".to_vec())
            .file_name("test.txt")
            .mime_type("text/plain"),
    );

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/upload")
        .add_header(h, v)
        .multipart(form)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["id"].as_str().is_some());
    assert_eq!(body["filename"], "test.txt");
    assert_eq!(body["contentType"], "text/plain");
    assert_eq!(body["size"], 11); // "hello world" is 11 bytes
}

#[tokio::test]
async fn upload_file_no_file_returns_400() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let form = MultipartForm::new(); // No parts added

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/upload")
        .add_header(h, v)
        .multipart(form)
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "No file provided");
}

#[tokio::test]
async fn upload_file_too_large() {
    use flux_server::{config::Config, routes, ws, AppState};
    use std::sync::Arc;

    let pool = common::setup_test_db().await;
    std::fs::create_dir_all("/tmp/flux-test-uploads").ok();

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    // Create a custom app with a very small max upload size
    let state = Arc::new(AppState {
        db: pool.clone(),
        config: Config {
            host: "127.0.0.1".into(),
            port: 0,
            database_path: ":memory:".into(),
            auth_secret: "test-secret".into(),
            livekit_api_key: "".into(),
            livekit_api_secret: "".into(),
            livekit_url: "ws://localhost:7880".into(),
            upload_dir: "/tmp/flux-test-uploads".into(),
            max_upload_bytes: 100, // Very small limit
        },
        gateway: Arc::new(ws::gateway::GatewayState::new()),
        spotify_auth_pending: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        youtube_url_cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
    });
    let server = TestServer::new(routes::build_router(state)).unwrap();

    // Create 200-byte payload (exceeds 100-byte limit)
    let big_data = vec![0u8; 200];
    let form = MultipartForm::new().add_part(
        "file",
        Part::bytes(big_data)
            .file_name("big.bin")
            .mime_type("application/octet-stream"),
    );

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/upload")
        .add_header(h, v)
        .multipart(form)
        .await;

    res.assert_status(StatusCode::PAYLOAD_TOO_LARGE);
    let body: serde_json::Value = res.json();
    assert!(body["error"].as_str().unwrap().contains("too large"));
}

#[tokio::test]
async fn upload_without_auth_returns_401() {
    let (server, _pool) = setup().await;

    let form = MultipartForm::new().add_part(
        "file",
        Part::bytes(b"data".to_vec())
            .file_name("test.txt")
            .mime_type("text/plain"),
    );

    let res = server.post("/api/upload").multipart(form).await;

    // Without auth header, the AuthUser extractor will fail
    // The exact status depends on the middleware; typically 401
    let status = res.status_code();
    assert!(
        status == StatusCode::UNAUTHORIZED || status == StatusCode::BAD_REQUEST,
        "Expected 401 or 400, got {}",
        status
    );
}

#[tokio::test]
async fn serve_file_existing() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let form = MultipartForm::new().add_part(
        "file",
        Part::bytes(b"serve me".to_vec())
            .file_name("serve.txt")
            .mime_type("text/plain"),
    );

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/upload")
        .add_header(h, v)
        .multipart(form)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let file_id = body["id"].as_str().unwrap().to_string();

    // Serve the file (no auth required)
    let res = server
        .get(&format!("/api/files/{}/serve.txt", file_id))
        .await;

    res.assert_status_ok();
    let body_bytes = res.as_bytes();
    assert_eq!(body_bytes.as_ref(), b"serve me");
}

#[tokio::test]
async fn serve_file_not_found() {
    let (server, _pool) = setup().await;

    let res = server
        .get("/api/files/nonexistent-id/foo.txt")
        .await;

    res.assert_status(StatusCode::NOT_FOUND);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "File not found");
}

#[tokio::test]
async fn serve_file_correct_disposition_inline() {
    let (server, pool) = setup().await;

    let (_user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let form = MultipartForm::new().add_part(
        "file",
        Part::bytes(b"fake image data".to_vec())
            .file_name("photo.png")
            .mime_type("image/png"),
    );

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/upload")
        .add_header(h, v)
        .multipart(form)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    let file_id = body["id"].as_str().unwrap().to_string();

    // Serve the image file
    let res = server
        .get(&format!("/api/files/{}/photo.png", file_id))
        .await;

    res.assert_status_ok();

    let disposition = res
        .header("content-disposition")
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(disposition, "inline");
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
