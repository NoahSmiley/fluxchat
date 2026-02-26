use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::AuthUser;
use crate::ws::events::ServerEvent;
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGallerySetRequest {
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddImagesRequest {
    pub image_attachment_ids: Vec<String>,
    pub image_names: Vec<String>,
}

/// Helper: check ownership, returns Ok(()) or an error response
async fn check_ownership(
    state: &AppState,
    set_id: &str,
    user_id: &str,
) -> Result<(), axum::response::Response> {
    let owner_id = sqlx::query_scalar::<_, String>(
        "SELECT creator_id FROM gallery_sets WHERE id = ?",
    )
    .bind(set_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match owner_id.as_deref() {
        Some(id) if id == user_id => Ok(()),
        Some(_) => Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not the owner of this set"})),
        )
            .into_response()),
        None => Err(StatusCode::NOT_FOUND.into_response()),
    }
}

/// Notify all subscribers of a gallery set that it was updated
async fn notify_subscribers(state: &AppState, set_id: &str) {
    let subscriber_ids: Vec<String> = sqlx::query_scalar(
        "SELECT user_id FROM gallery_subscriptions WHERE set_id = ?",
    )
    .bind(set_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let event = ServerEvent::GallerySetUpdated {
        set_id: set_id.to_string(),
    };
    for uid in &subscriber_ids {
        state.gateway.send_to_user(uid, &event).await;
    }
}

/// PATCH /api/gallery/:setId — owner only
pub async fn update_gallery_set(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(set_id): Path<String>,
    Json(body): Json<UpdateGallerySetRequest>,
) -> impl IntoResponse {
    if let Err(resp) = check_ownership(&state, &set_id, &user.id).await {
        return resp;
    }

    let now = chrono::Utc::now().to_rfc3339();

    if let Some(name) = &body.name {
        let name = name.trim();
        if !name.is_empty() {
            sqlx::query("UPDATE gallery_sets SET name = ?, updated_at = ? WHERE id = ?")
                .bind(name)
                .bind(&now)
                .bind(&set_id)
                .execute(&state.db)
                .await
                .ok();
        }
    }

    if let Some(description) = &body.description {
        sqlx::query("UPDATE gallery_sets SET description = ?, updated_at = ? WHERE id = ?")
            .bind(description)
            .bind(&now)
            .bind(&set_id)
            .execute(&state.db)
            .await
            .ok();
    }

    notify_subscribers(&state, &set_id).await;
    StatusCode::NO_CONTENT.into_response()
}

/// POST /api/gallery/:setId/images — add images to an existing set (owner only)
pub async fn add_images(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(set_id): Path<String>,
    Json(body): Json<AddImagesRequest>,
) -> impl IntoResponse {
    if let Err(resp) = check_ownership(&state, &set_id, &user.id).await {
        return resp;
    }

    if body.image_attachment_ids.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "At least one image is required"})),
        )
            .into_response();
    }

    if body.image_attachment_ids.len() != body.image_names.len() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Attachment IDs and names must have the same length"})),
        )
            .into_response();
    }

    // Validate attachments belong to the user
    for att_id in &body.image_attachment_ids {
        let ok = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM attachments WHERE id = ? AND uploader_id = ?",
        )
        .bind(att_id)
        .bind(&user.id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0)
            > 0;

        if !ok {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Invalid attachment: {}", att_id)})),
            )
                .into_response();
        }
    }

    // Get current max position
    let max_pos: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(position), -1) FROM gallery_set_images WHERE set_id = ?",
    )
    .bind(&set_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(-1);

    let now = chrono::Utc::now().to_rfc3339();

    for (i, (att_id, img_name)) in body
        .image_attachment_ids
        .iter()
        .zip(body.image_names.iter())
        .enumerate()
    {
        let img_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO gallery_set_images (id, set_id, attachment_id, name, position, created_at)
               VALUES (?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&img_id)
        .bind(&set_id)
        .bind(att_id)
        .bind(img_name)
        .bind(max_pos + 1 + i as i64)
        .bind(&now)
        .execute(&state.db)
        .await
        .ok();
    }

    // Update cover if not set
    sqlx::query(
        "UPDATE gallery_sets SET updated_at = ?, cover_attachment_id = COALESCE(cover_attachment_id, ?) WHERE id = ?",
    )
    .bind(&now)
    .bind(body.image_attachment_ids.first())
    .bind(&set_id)
    .execute(&state.db)
    .await
    .ok();

    notify_subscribers(&state, &set_id).await;
    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/gallery/:setId/images/:imageId — remove a single image from a set (owner only)
pub async fn remove_image(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((set_id, image_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(resp) = check_ownership(&state, &set_id, &user.id).await {
        return resp;
    }

    sqlx::query("DELETE FROM gallery_set_images WHERE id = ? AND set_id = ?")
        .bind(&image_id)
        .bind(&set_id)
        .execute(&state.db)
        .await
        .ok();

    // Update cover to first remaining image (or NULL)
    let now = chrono::Utc::now().to_rfc3339();
    let first_att: Option<String> = sqlx::query_scalar(
        "SELECT attachment_id FROM gallery_set_images WHERE set_id = ? ORDER BY position ASC LIMIT 1",
    )
    .bind(&set_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    sqlx::query("UPDATE gallery_sets SET cover_attachment_id = ?, updated_at = ? WHERE id = ?")
        .bind(&first_att)
        .bind(&now)
        .bind(&set_id)
        .execute(&state.db)
        .await
        .ok();

    notify_subscribers(&state, &set_id).await;
    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/gallery/:setId — owner only, cascade deletes images + subscriptions
pub async fn delete_gallery_set(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(set_id): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = check_ownership(&state, &set_id, &user.id).await {
        return resp;
    }

    sqlx::query("DELETE FROM gallery_sets WHERE id = ?")
        .bind(&set_id)
        .execute(&state.db)
        .await
        .ok();

    StatusCode::NO_CONTENT.into_response()
}

/// POST /api/gallery/:setId/subscribe
pub async fn subscribe(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(set_id): Path<String>,
) -> impl IntoResponse {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO gallery_subscriptions (user_id, set_id, created_at) VALUES (?, ?, ?)",
    )
    .bind(&user.id)
    .bind(&set_id)
    .bind(&now)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}

/// DELETE /api/gallery/:setId/subscribe
pub async fn unsubscribe(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(set_id): Path<String>,
) -> impl IntoResponse {
    sqlx::query(
        "DELETE FROM gallery_subscriptions WHERE user_id = ? AND set_id = ?",
    )
    .bind(&user.id)
    .bind(&set_id)
    .execute(&state.db)
    .await
    .ok();

    StatusCode::NO_CONTENT.into_response()
}
