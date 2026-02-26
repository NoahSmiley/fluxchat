pub mod manage;

pub use manage::*;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

// ── Row types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GallerySetRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub creator_id: String,
    pub creator_username: String,
    pub cover_attachment_id: Option<String>,
    pub cover_filename: Option<String>,
    pub image_count: i64,
    pub subscriber_count: i64,
    pub subscribed: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GallerySetImageRow {
    pub id: String,
    pub set_id: String,
    pub attachment_id: String,
    pub filename: String,
    pub name: String,
    pub position: i64,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGallerySetRequest {
    pub name: String,
    pub description: Option<String>,
    pub image_attachment_ids: Vec<String>,
    pub image_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct GalleryQuery {
    pub q: Option<String>,
}

// ── Shared query fragment ──────────────────────────────────────────────────

const GALLERY_SET_SELECT: &str = r#"
    SELECT
        gs.id,
        gs.name,
        gs.description,
        gs.creator_id,
        COALESCE(u.username, 'Unknown') AS creator_username,
        gs.cover_attachment_id,
        a_cover.filename AS cover_filename,
        (SELECT COUNT(*) FROM gallery_set_images gsi WHERE gsi.set_id = gs.id) AS image_count,
        (SELECT COUNT(*) FROM gallery_subscriptions gsub WHERE gsub.set_id = gs.id) AS subscriber_count,
        CASE WHEN my_sub.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS subscribed,
        gs.created_at,
        gs.updated_at
    FROM gallery_sets gs
    LEFT JOIN "user" u ON u.id = gs.creator_id
    LEFT JOIN attachments a_cover ON a_cover.id = gs.cover_attachment_id
    LEFT JOIN gallery_subscriptions my_sub ON my_sub.set_id = gs.id AND my_sub.user_id = ?
"#;

// ── Handlers ──────────────────────────────────────────────────────────────

/// GET /api/gallery — browse all sets, optional ?q= search
pub async fn list_gallery_sets(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(params): Query<GalleryQuery>,
) -> impl IntoResponse {
    let sets = if let Some(q) = &params.q {
        let pattern = format!("%{}%", q);
        sqlx::query_as::<_, GallerySetRow>(
            &format!("{} WHERE gs.name LIKE ? ORDER BY gs.created_at DESC", GALLERY_SET_SELECT),
        )
        .bind(&user.id)
        .bind(&pattern)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    } else {
        sqlx::query_as::<_, GallerySetRow>(
            &format!("{} ORDER BY gs.created_at DESC", GALLERY_SET_SELECT),
        )
        .bind(&user.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default()
    };

    Json(sets).into_response()
}

/// GET /api/gallery/mine — sets created by caller
pub async fn list_my_sets(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let sets = sqlx::query_as::<_, GallerySetRow>(
        &format!("{} WHERE gs.creator_id = ? ORDER BY gs.created_at DESC", GALLERY_SET_SELECT),
    )
    .bind(&user.id)
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(sets).into_response()
}

/// GET /api/gallery/subscribed — caller's subscribed sets WITH images
pub async fn list_subscribed(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    // First get the sets the user is subscribed to
    let sets = sqlx::query_as::<_, GallerySetRow>(
        &format!(
            "{} WHERE my_sub.user_id IS NOT NULL ORDER BY gs.name ASC",
            GALLERY_SET_SELECT,
        ),
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    // For each set, fetch images
    let mut results = Vec::new();
    for set in sets {
        let images = sqlx::query_as::<_, GallerySetImageRow>(
            r#"SELECT gsi.id, gsi.set_id, gsi.attachment_id, a.filename, gsi.name, gsi.position, gsi.created_at
               FROM gallery_set_images gsi
               JOIN attachments a ON a.id = gsi.attachment_id
               WHERE gsi.set_id = ?
               ORDER BY gsi.position ASC"#,
        )
        .bind(&set.id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        results.push(serde_json::json!({
            "id": set.id,
            "name": set.name,
            "description": set.description,
            "creatorId": set.creator_id,
            "creatorUsername": set.creator_username,
            "coverAttachmentId": set.cover_attachment_id,
            "coverFilename": set.cover_filename,
            "imageCount": set.image_count,
            "subscriberCount": set.subscriber_count,
            "subscribed": set.subscribed,
            "createdAt": set.created_at,
            "updatedAt": set.updated_at,
            "images": images,
        }));
    }

    Json(results).into_response()
}

/// POST /api/gallery — create a new gallery set
pub async fn create_gallery_set(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<CreateGallerySetRequest>,
) -> impl IntoResponse {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Name is required"})),
        )
            .into_response();
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

    // Validate all attachment IDs belong to the caller
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

    let set_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let description = body.description.unwrap_or_default();
    let cover_id = body.image_attachment_ids.first().cloned();

    // Create the set
    let result = sqlx::query(
        r#"INSERT INTO gallery_sets (id, name, description, creator_id, cover_attachment_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&set_id)
    .bind(&name)
    .bind(&description)
    .bind(&user.id)
    .bind(&cover_id)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to create gallery set: {:?}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to create gallery set"})),
        )
            .into_response();
    }

    // Insert images
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
        .bind(i as i64)
        .bind(&now)
        .execute(&state.db)
        .await
        .ok();
    }

    // Return the created set
    let set = sqlx::query_as::<_, GallerySetRow>(
        &format!("{} WHERE gs.id = ?", GALLERY_SET_SELECT),
    )
    .bind(&user.id)
    .bind(&set_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match set {
        Some(s) => (StatusCode::CREATED, Json(s)).into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// GET /api/gallery/:setId — single set with images
pub async fn get_gallery_set(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    axum::extract::Path(set_id): axum::extract::Path<String>,
) -> impl IntoResponse {
    let set = sqlx::query_as::<_, GallerySetRow>(
        &format!("{} WHERE gs.id = ?", GALLERY_SET_SELECT),
    )
    .bind(&user.id)
    .bind(&set_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let set = match set {
        Some(s) => s,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    let images = sqlx::query_as::<_, GallerySetImageRow>(
        r#"SELECT gsi.id, gsi.set_id, gsi.attachment_id, a.filename, gsi.name, gsi.position, gsi.created_at
           FROM gallery_set_images gsi
           JOIN attachments a ON a.id = gsi.attachment_id
           WHERE gsi.set_id = ?
           ORDER BY gsi.position ASC"#,
    )
    .bind(&set_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(serde_json::json!({
        "id": set.id,
        "name": set.name,
        "description": set.description,
        "creatorId": set.creator_id,
        "creatorUsername": set.creator_username,
        "coverAttachmentId": set.cover_attachment_id,
        "coverFilename": set.cover_filename,
        "imageCount": set.image_count,
        "subscriberCount": set.subscriber_count,
        "subscribed": set.subscribed,
        "createdAt": set.created_at,
        "updatedAt": set.updated_at,
        "images": images,
    }))
    .into_response()
}
