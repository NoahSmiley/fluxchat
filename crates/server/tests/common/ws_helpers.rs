#![allow(dead_code)]

use futures::{SinkExt, StreamExt};
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message;

/// Start the test app on a random TCP port and return the base URL.
pub async fn start_server() -> (String, sqlx::SqlitePool) {
    let pool = super::setup_test_db().await;
    let app = super::create_test_app(pool.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://127.0.0.1:{}", addr.port());

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    // Give the server a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    (base, pool)
}

/// Connect a WebSocket with a session token.
pub async fn ws_connect(
    base: &str,
    token: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
{
    let ws_url = format!(
        "{}/gateway?token={}",
        base.replace("http://", "ws://"),
        token
    );
    let (ws, _) = tokio_tungstenite::connect_async(&ws_url).await.unwrap();
    ws
}

/// Read next text message parsed as JSON, with timeout.
pub async fn recv_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Option<Value> {
    let timeout = tokio::time::timeout(std::time::Duration::from_secs(3), ws.next()).await;
    match timeout {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str(&text).ok(),
        _ => None,
    }
}

/// Drain all pending messages until timeout.
pub async fn drain_messages(
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
pub async fn send_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    value: &Value,
) {
    ws.send(Message::Text(serde_json::to_string(value).unwrap().into()))
        .await
        .unwrap();
}
