use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{AddToQueueRequest, AuthUser, ListeningSession, QueueItem};
use crate::ws::events::ServerEvent;
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub voice_channel_id: String,
}

/// POST /api/spotify/sessions
pub async fn create_session(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Json(body): Json<CreateSessionRequest>,
) -> impl IntoResponse {
    let existing = sqlx::query_scalar::<_, String>(
        r#"SELECT id FROM "listening_sessions" WHERE voice_channel_id = ?"#,
    )
    .bind(&body.voice_channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some(id) = existing {
        return Json(serde_json::json!({"sessionId": id, "existing": true})).into_response();
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query(
        r#"INSERT INTO "listening_sessions" (id, voice_channel_id, host_user_id, current_track_position_ms, is_playing, created_at, updated_at)
           VALUES (?, ?, ?, 0, 0, ?, ?)"#,
    )
    .bind(&id)
    .bind(&body.voice_channel_id)
    .bind(&user.id)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    Json(serde_json::json!({"sessionId": id})).into_response()
}

/// GET /api/spotify/sessions/channel/:voiceChannelId
pub async fn get_session(
    _user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(voice_channel_id): Path<String>,
) -> impl IntoResponse {
    let session = sqlx::query_as::<_, ListeningSession>(
        r#"SELECT * FROM "listening_sessions" WHERE voice_channel_id = ?"#,
    )
    .bind(&voice_channel_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match session {
        Some(s) => {
            let queue = sqlx::query_as::<_, QueueItem>(
                r#"SELECT * FROM "session_queue" WHERE session_id = ? ORDER BY position ASC"#,
            )
            .bind(&s.id)
            .fetch_all(&state.db)
            .await
            .unwrap_or_default();

            Json(serde_json::json!({"session": s, "queue": queue})).into_response()
        }
        None => Json(serde_json::json!({"session": null, "queue": []})).into_response(),
    }
}

/// POST /api/spotify/sessions/:sessionId/queue
pub async fn add_to_queue(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
    Json(body): Json<AddToQueueRequest>,
) -> impl IntoResponse {
    let max_pos = sqlx::query_scalar::<_, i64>(
        r#"SELECT COALESCE(MAX(position), -1) FROM "session_queue" WHERE session_id = ?"#,
    )
    .bind(&session_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(-1);

    let item_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let position = max_pos + 1;

    let _ = sqlx::query(
        r#"INSERT INTO "session_queue"
           (id, session_id, track_uri, track_name, track_artist, track_album, track_image_url, track_duration_ms, added_by_user_id, position, created_at, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&item_id)
    .bind(&session_id)
    .bind(&body.track_uri)
    .bind(&body.track_name)
    .bind(&body.track_artist)
    .bind(&body.track_album)
    .bind(&body.track_image_url)
    .bind(body.track_duration_ms)
    .bind(&user.id)
    .bind(position)
    .bind(&now)
    .bind(&body.source)
    .execute(&state.db)
    .await;

    let queue_item = QueueItem {
        id: item_id.clone(),
        session_id: session_id.clone(),
        track_uri: body.track_uri,
        track_name: body.track_name,
        track_artist: body.track_artist,
        track_album: body.track_album,
        track_image_url: body.track_image_url,
        track_duration_ms: body.track_duration_ms,
        added_by_user_id: user.id.clone(),
        position,
        created_at: now,
        source: body.source,
    };

    let voice_channel_id = sqlx::query_scalar::<_, String>(
        r#"SELECT voice_channel_id FROM "listening_sessions" WHERE id = ?"#,
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();

    state
        .gateway
        .broadcast_all(
            &ServerEvent::SpotifyQueueUpdate {
                session_id,
                voice_channel_id,
                queue_item,
            },
            None,
        )
        .await;

    Json(serde_json::json!({"id": item_id})).into_response()
}

/// DELETE /api/spotify/sessions/:sessionId/queue/:itemId
pub async fn remove_from_queue(
    _user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path((session_id, item_id)): Path<(String, String)>,
) -> impl IntoResponse {
    let voice_channel_id = sqlx::query_scalar::<_, String>(
        r#"SELECT voice_channel_id FROM "listening_sessions" WHERE id = ?"#,
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();

    let _ = sqlx::query(r#"DELETE FROM "session_queue" WHERE id = ? AND session_id = ?"#)
        .bind(&item_id)
        .bind(&session_id)
        .execute(&state.db)
        .await;

    state
        .gateway
        .broadcast_all(
            &ServerEvent::SpotifyQueueRemove {
                session_id,
                voice_channel_id,
                item_id: item_id.clone(),
            },
            None,
        )
        .await;

    Json(serde_json::json!({"success": true})).into_response()
}

/// DELETE /api/spotify/sessions/:sessionId/end
pub async fn delete_session(
    user: AuthUser,
    State(state): State<Arc<AppState>>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    let session = sqlx::query_as::<_, ListeningSession>(
        r#"SELECT * FROM "listening_sessions" WHERE id = ?"#,
    )
    .bind(&session_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let session = match session {
        Some(s) if s.host_user_id == user.id => s,
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not the host"})),
            )
                .into_response()
        }
    };

    let _ = sqlx::query(r#"DELETE FROM "listening_sessions" WHERE id = ?"#)
        .bind(&session_id)
        .execute(&state.db)
        .await;

    state
        .gateway
        .broadcast_all(
            &ServerEvent::SpotifySessionEnded {
                session_id,
                voice_channel_id: session.voice_channel_id,
            },
            None,
        )
        .await;

    Json(serde_json::json!({"success": true})).into_response()
}
