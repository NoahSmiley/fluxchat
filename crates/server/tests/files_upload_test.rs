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
            room_cleanup_delay_secs: 2,
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
