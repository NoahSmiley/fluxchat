mod common;

use common::ws_helpers::{drain_messages, send_json, start_server, ws_connect};
use serde_json::json;

#[tokio::test]
async fn send_dm_creates_record_and_broadcasts() {
    let (base, pool) = start_server().await;
    let (user1_id, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    // Create DM channel
    let dm_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)")
        .bind(&dm_id)
        .bind(&user1_id)
        .bind(&user2_id)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(&mut ws1, &json!({"type": "join_dm", "dmChannelId": dm_id})).await;
    send_json(&mut ws2, &json!({"type": "join_dm", "dmChannelId": dm_id})).await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    send_json(
        &mut ws1,
        &json!({
            "type": "send_dm",
            "dmChannelId": dm_id,
            "ciphertext": "encrypted-hello",
            "mlsEpoch": 0
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM dm_messages WHERE dm_channel_id = ?")
            .bind(&dm_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn send_dm_non_participant_ignored() {
    let (base, pool) = start_server().await;
    let (user1_id, _) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (user2_id, _) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;
    let (_, token3) =
        common::create_test_user(&pool, "charlie@test.com", "charlie", "pass123").await;

    let dm_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO dm_channels (id, user1_id, user2_id, created_at) VALUES (?, ?, ?, ?)")
        .bind(&dm_id)
        .bind(&user1_id)
        .bind(&user2_id)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws3 = ws_connect(&base, &token3).await;
    drain_messages(&mut ws3).await;

    // Charlie tries to send DM in Alice-Bob channel
    send_json(
        &mut ws3,
        &json!({
            "type": "send_dm",
            "dmChannelId": dm_id,
            "ciphertext": "snoop",
            "mlsEpoch": 0
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    let count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM dm_messages WHERE dm_channel_id = ?")
            .bind(&dm_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 0, "Non-participant DM should be ignored");
}

#[tokio::test]
async fn update_activity_broadcasts() {
    let (base, pool) = start_server().await;
    let (_, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(
        &mut ws1,
        &json!({
            "type": "update_activity",
            "activity": {
                "name": "Spotify",
                "activityType": "listening",
                "artist": "Artist"
            }
        }),
    )
    .await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_activity = msgs
        .iter()
        .any(|m| m["type"] == "activity_update" && m["activity"]["name"] == "Spotify");
    assert!(has_activity);
}

#[tokio::test]
async fn update_status_broadcasts_presence() {
    let (base, pool) = start_server().await;
    let (_, token1) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let (_, token2) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    let mut ws1 = ws_connect(&base, &token1).await;
    let mut ws2 = ws_connect(&base, &token2).await;
    drain_messages(&mut ws1).await;
    drain_messages(&mut ws2).await;

    send_json(&mut ws1, &json!({"type": "update_status", "status": "dnd"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws2).await;
    let has_presence = msgs
        .iter()
        .any(|m| m["type"] == "presence" && m["status"] == "dnd");
    assert!(has_presence);
}

#[tokio::test]
async fn ping_event_does_not_error() {
    let (base, pool) = start_server().await;
    let (_, token) = common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    send_json(&mut ws, &json!({"type": "ping"})).await;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let msgs = drain_messages(&mut ws).await;
    let has_error = msgs.iter().any(|m| m["type"] == "error");
    assert!(!has_error, "Ping should not produce error");
}
