mod preview;

pub use preview::*;

use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;
use tokio_util::io::ReaderStream;

use crate::models::{Attachment, AuthUser};
use crate::AppState;

/// POST /api/upload
pub async fn upload(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    mut multipart: Multipart,
) -> impl IntoResponse {
    let field = match multipart.next_field().await {
        Ok(Some(f)) => f,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "No file provided"})),
            )
                .into_response()
        }
    };

    let original_filename = field
        .file_name()
        .unwrap_or("file")
        .to_string();
    let content_type = field
        .content_type()
        .unwrap_or("application/octet-stream")
        .to_string();

    // Read file data
    let data = match field.bytes().await {
        Ok(d) => d,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Failed to read file"})),
            )
                .into_response()
        }
    };

    let size = data.len() as u64;
    if size > state.config.max_upload_bytes {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(serde_json::json!({
                "error": format!("File too large. Max size: {} MB", state.config.max_upload_bytes / 1_048_576)
            })),
        )
            .into_response();
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Determine extension from original filename
    let ext = original_filename
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 10 && e.chars().all(|c| c.is_alphanumeric()))
        .unwrap_or("bin");
    let stored_filename = format!("{}.{}", id, ext);
    let file_path = std::path::Path::new(&state.config.upload_dir).join(&stored_filename);

    // Write file to disk
    if tokio::fs::write(&file_path, &data).await.is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to save file"})),
        )
            .into_response();
    }

    // Insert DB record
    let result = sqlx::query(
        r#"INSERT INTO attachments (id, message_id, uploader_id, filename, content_type, size, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?)"#,
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&original_filename)
    .bind(&content_type)
    .bind(size as i64)
    .bind(&now)
    .execute(&state.db)
    .await;

    if result.is_err() {
        // Clean up file on DB error
        let _ = tokio::fs::remove_file(&file_path).await;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to save attachment record"})),
        )
            .into_response();
    }

    Json(serde_json::json!({
        "id": id,
        "filename": original_filename,
        "contentType": content_type,
        "size": size,
    }))
    .into_response()
}

/// GET /api/files/:id/:filename
pub async fn serve_file(
    State(state): State<Arc<AppState>>,
    Path((id, _filename)): Path<(String, String)>,
) -> impl IntoResponse {
    // Look up attachment
    let attachment = sqlx::query_as::<_, Attachment>(
        "SELECT * FROM attachments WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let attachment = match attachment {
        Some(a) => a,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "File not found"})),
            )
                .into_response()
        }
    };

    // Determine stored filename
    let ext = attachment
        .filename
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 10 && e.chars().all(|c| c.is_alphanumeric()))
        .unwrap_or("bin");
    let stored_filename = format!("{}.{}", id, ext);
    let file_path = std::path::Path::new(&state.config.upload_dir).join(&stored_filename);

    let file = match tokio::fs::File::open(&file_path).await {
        Ok(f) => f,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "File not found on disk"})),
            )
                .into_response()
        }
    };

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let disposition = if attachment.content_type.starts_with("image/")
        || attachment.content_type.starts_with("video/")
        || attachment.content_type.starts_with("audio/")
    {
        "inline".to_string()
    } else {
        format!("attachment; filename=\"{}\"", attachment.filename)
    };

    (
        [
            (header::CONTENT_TYPE, attachment.content_type),
            (header::CONTENT_DISPOSITION, disposition),
            (
                header::CACHE_CONTROL,
                "public, max-age=31536000, immutable".to_string(),
            ),
        ],
        body,
    )
        .into_response()
}
