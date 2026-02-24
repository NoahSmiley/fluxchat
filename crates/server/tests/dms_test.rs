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
async fn create_dm_channel() {
    let (server, pool) = setup().await;

    let (_user1_id, user1_token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, _) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    let (h, v) = auth_header(&user1_token);
    let res = server
        .post("/api/dms")
        .add_header(h, v)
        .json(&json!({ "userId": user2_id }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert!(body["id"].as_str().is_some());
    assert_eq!(body["otherUser"]["username"], "bob");

    // Creating again should return the same channel (idempotent)
    let (h, v) = auth_header(&user1_token);
    let res2 = server
        .post("/api/dms")
        .add_header(h, v)
        .json(&json!({ "userId": user2_id }))
        .await;

    res2.assert_status_ok();
    let body2: serde_json::Value = res2.json();
    assert_eq!(body["id"], body2["id"]);
}

#[tokio::test]
async fn list_dm_channels() {
    let (server, pool) = setup().await;

    let (user1_id, user1_token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, _) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    // Create a DM channel directly
    let now = chrono::Utc::now().to_rfc3339();
    let (id1, id2) = if user1_id < user2_id {
        (&user1_id, &user2_id)
    } else {
        (&user2_id, &user1_id)
    };
    sqlx::query(
        "INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&uuid::Uuid::new_v4().to_string())
    .bind(id1)
    .bind(id2)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&user1_token);
    let res = server.get("/api/dms").add_header(h, v).await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["otherUser"]["username"], "bob");
}

#[tokio::test]
async fn list_dm_messages_paginated() {
    let (server, pool) = setup().await;

    let (user1_id, user1_token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, _) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    // Create DM channel
    let dm_channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let (id1, id2) = if user1_id < user2_id {
        (&user1_id, &user2_id)
    } else {
        (&user2_id, &user1_id)
    };
    sqlx::query(
        "INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&dm_channel_id)
    .bind(id1)
    .bind(id2)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Insert DM messages
    for i in 0..3 {
        sqlx::query(
            "INSERT INTO dm_messages (id, dm_channel_id, sender_id, ciphertext, mls_epoch, created_at) VALUES (?, ?, ?, ?, 0, ?)",
        )
        .bind(&uuid::Uuid::new_v4().to_string())
        .bind(&dm_channel_id)
        .bind(&user1_id)
        .bind(&format!("encrypted msg {}", i))
        .bind(&chrono::Utc::now().to_rfc3339())
        .execute(&pool)
        .await
        .unwrap();
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
    }

    let (h, v) = auth_header(&user1_token);
    let res = server
        .get(&format!("/api/dms/{}/messages", dm_channel_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["items"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn dm_messages_non_participant_returns_403() {
    let (server, pool) = setup().await;

    let (user1_id, _) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, _) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let (_, outsider_token) =
        common::create_test_user(&pool, "outsider@test.com", "outsider", "pass123").await;

    let dm_channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let (id1, id2) = if user1_id < user2_id {
        (&user1_id, &user2_id)
    } else {
        (&user2_id, &user1_id)
    };
    sqlx::query(
        "INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .bind(&dm_channel_id)
    .bind(id1)
    .bind(id2)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&outsider_token);
    let res = server
        .get(&format!("/api/dms/{}/messages", dm_channel_id))
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
}
