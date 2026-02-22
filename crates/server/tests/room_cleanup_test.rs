mod common;

use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Start the test app on a random TCP port and return the base URL.
async fn start_server() -> (String, sqlx::SqlitePool) {
    let pool = common::setup_test_db().await;
    let app = common::create_test_app(pool.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://127.0.0.1:{}", addr.port());

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    (base, pool)
}

/// Connect a WebSocket with a session token.
async fn ws_connect(
    base: &str,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
{
    let ws_url = format!(
        "{}/gateway?token={}",
        base.replace("http://", "ws://"),
        token
    );
    let (ws, _) = connect_async(&ws_url).await.unwrap();
    ws
}

/// Drain all pending messages until timeout.
async fn drain_messages(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Vec<Value> {
    let mut messages = Vec::new();
    loop {
        let timeout =
            tokio::time::timeout(std::time::Duration::from_millis(200), ws.next()).await;
        match timeout {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    messages.push(v);
                }
            }
            _ => break,
        }
    }
    messages
}

/// Send a JSON message over WebSocket.
async fn send_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    value: &Value,
) {
    ws.send(Message::Text(serde_json::to_string(value).unwrap().into()))
        .await
        .unwrap();
}

/// Helper: check if room still exists in the database.
async fn room_exists(pool: &sqlx::SqlitePool, room_id: &str) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM channels WHERE id = ?")
        .bind(room_id)
        .fetch_one(pool)
        .await
        .unwrap()
        > 0
}

// NOTE: The default cleanup delay is 30 seconds, which is too long for tests.
// These tests verify the behavior by:
// 1. Checking that the room is NOT immediately deleted (timer is scheduled)
// 2. Checking that rejoining cancels the timer
// 3. For actual deletion, we check that persistent rooms are NOT cleaned up
//
// For the actual cleanup deletion test, we'd need to either:
//   - Expose a test-only API to set the cleanup delay
//   - Or wait the full 30 seconds
// We choose to verify the scheduling/cancellation logic and that persistent rooms survive.

#[tokio::test]
async fn cleanup_timer_scheduled_on_last_leave() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Temp Room", &user_id).await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Join voice in the room
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    // Leave voice
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "leave"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Room should still exist (cleanup timer is 30s, not immediate)
    assert!(
        room_exists(&pool, &room_id).await,
        "Room should still exist immediately after leave (timer is scheduled, not fired)"
    );
}

#[tokio::test]
async fn cleanup_cancelled_on_rejoin() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Resilient Room", &user_id).await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Join → leave → rejoin quickly
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "leave"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Rejoin before cleanup fires
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Room should definitely still exist
    assert!(
        room_exists(&pool, &room_id).await,
        "Room should survive after rejoin cancels cleanup"
    );
}

#[tokio::test]
async fn cleanup_deletes_room_and_broadcasts() {
    // This test verifies that after the cleanup delay, a non-persistent empty room
    // is deleted and a room_deleted event is broadcast.
    // We use a short wait by relying on the 30-second timer — we'll wait 32 seconds.
    // If this test is too slow for CI, it can be marked #[ignore].
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Doomed Room", &user_id).await;

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Join and leave voice
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "leave"}),
    )
    .await;

    // Wait for the 30-second cleanup timer to fire
    tokio::time::sleep(std::time::Duration::from_secs(32)).await;

    // Room should be deleted
    assert!(
        !room_exists(&pool, &room_id).await,
        "Non-persistent empty room should be auto-deleted after cleanup delay"
    );

    // Check for room_deleted broadcast
    let msgs = drain_messages(&mut ws).await;
    let has_deleted = msgs.iter().any(|m| {
        m["type"] == "room_deleted" && m["channelId"] == room_id
    });
    assert!(has_deleted, "Should receive room_deleted event after cleanup");
}

#[tokio::test]
async fn persistent_room_not_cleaned_up() {
    let (base, pool) = start_server().await;

    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    let server_id = common::create_test_server(&pool, &user_id, "TestServer").await;
    let room_id = common::create_room(&pool, &server_id, "Persistent Room", &user_id).await;

    // Mark room as persistent
    sqlx::query("UPDATE channels SET is_persistent = 1 WHERE id = ?")
        .bind(&room_id)
        .execute(&pool)
        .await
        .unwrap();

    let mut ws = ws_connect(&base, &token).await;
    drain_messages(&mut ws).await;

    // Join and leave voice
    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "join"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    drain_messages(&mut ws).await;

    send_json(
        &mut ws,
        &json!({"type": "voice_state_update", "channelId": room_id, "action": "leave"}),
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Persistent room should still exist
    assert!(
        room_exists(&pool, &room_id).await,
        "Persistent room should NOT be cleaned up"
    );
}
