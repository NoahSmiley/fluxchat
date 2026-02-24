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
async fn update_sound() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let attachment_id =
        common::create_test_attachment(&pool, &user_id, "sound.mp3", "audio/mpeg").await;

    // Create a sound
    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Original Name",
            "audioAttachmentId": attachment_id,
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    let sound_id = body["id"].as_str().unwrap().to_string();

    // Update the sound
    let (h, v) = auth_header(&token);
    let res = server
        .patch(&format!(
            "/api/servers/{}/soundboard/{}",
            server_id, sound_id
        ))
        .add_header(h, v)
        .json(&json!({
            "name": "Updated Name",
            "volume": 0.8
        }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["name"], "Updated Name");
    assert_eq!(body["volume"], 0.8);
}

#[tokio::test]
async fn delete_sound() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let attachment_id =
        common::create_test_attachment(&pool, &user_id, "sound.mp3", "audio/mpeg").await;

    // Create a sound
    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "To Delete",
            "audioAttachmentId": attachment_id,
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    let sound_id = body["id"].as_str().unwrap().to_string();

    // Delete the sound
    let (h, v) = auth_header(&token);
    let res = server
        .delete(&format!(
            "/api/servers/{}/soundboard/{}",
            server_id, sound_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NO_CONTENT);

    // Verify it's gone
    let (h, v) = auth_header(&token);
    let res = server
        .get(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert!(body.is_empty());
}

#[tokio::test]
async fn favorite_and_unfavorite_sound() {
    let (server, pool) = setup().await;

    let (user_id, token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;

    let attachment_id =
        common::create_test_attachment(&pool, &user_id, "sound.mp3", "audio/mpeg").await;

    // Create a sound
    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Fav Sound",
            "audioAttachmentId": attachment_id,
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    let sound_id = body["id"].as_str().unwrap().to_string();

    // Favorite the sound
    let (h, v) = auth_header(&token);
    let res = server
        .post(&format!(
            "/api/servers/{}/soundboard/{}/favorite",
            server_id, sound_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NO_CONTENT);

    // Unfavorite the sound
    let (h, v) = auth_header(&token);
    let res = server
        .delete(&format!(
            "/api/servers/{}/soundboard/{}/favorite",
            server_id, sound_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn favorite_not_member() {
    let (server, pool) = setup().await;

    let (owner_id, owner_token) =
        common::create_test_user(&pool, "owner@test.com", "owner", "pass123").await;
    let server_id = common::create_test_server(&pool, &owner_id, "TestServer").await;

    let attachment_id =
        common::create_test_attachment(&pool, &owner_id, "sound.mp3", "audio/mpeg").await;

    // Create a sound as owner
    let (h, v) = auth_header(&owner_token);
    let res = server
        .post(&format!("/api/servers/{}/soundboard", server_id))
        .add_header(h, v)
        .json(&json!({
            "name": "Sound",
            "audioAttachmentId": attachment_id,
            "volume": 0.5
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    let sound_id = body["id"].as_str().unwrap().to_string();

    // Outsider tries to favorite
    let (_outsider_id, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .post(&format!(
            "/api/servers/{}/soundboard/{}/favorite",
            server_id, sound_id
        ))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Not a member of this server");
}
