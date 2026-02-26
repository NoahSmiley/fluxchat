use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

use super::{require_server_admin, RoadmapItemRow, UpdateRoadmapItemRequest, VALID_STATUSES};

/// PATCH /api/servers/:serverId/roadmap/:itemId
/// Owner or admin only.
pub async fn update_roadmap_item(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, item_id)): Path<(String, String)>,
    Json(body): Json<UpdateRoadmapItemRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_server_admin(&state, &user.id, &server_id).await {
        return resp.into_response();
    }

    // Fetch existing item
    let existing = sqlx::query_as::<_, RoadmapItemRow>(
        "SELECT * FROM roadmap_items WHERE id = ? AND server_id = ?",
    )
    .bind(&item_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let existing = match existing {
        Some(e) => e,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Roadmap item not found"})),
            )
                .into_response();
        }
    };

    let title = body
        .title
        .as_deref()
        .map(|t| t.trim())
        .unwrap_or(&existing.title)
        .to_string();
    if title.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Title cannot be empty"})),
        )
            .into_response();
    }

    let status = body.status.as_deref().unwrap_or(&existing.status);
    if !VALID_STATUSES.contains(&status) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid status"})),
        )
            .into_response();
    }

    let description = body
        .description
        .as_deref()
        .unwrap_or(&existing.description)
        .to_string();
    let category = if body.category.is_some() {
        body.category.as_deref()
    } else {
        existing.category.as_deref()
    };
    let now = chrono::Utc::now().to_rfc3339();

    let result = sqlx::query(
        "UPDATE roadmap_items SET title = ?, description = ?, status = ?, category = ?, updated_at = ? WHERE id = ? AND server_id = ?",
    )
    .bind(&title)
    .bind(&description)
    .bind(status)
    .bind(category)
    .bind(&now)
    .bind(&item_id)
    .bind(&server_id)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to update roadmap item: {:?}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to update roadmap item"})),
        )
            .into_response();
    }

    let item = sqlx::query_as::<_, RoadmapItemRow>(
        "SELECT * FROM roadmap_items WHERE id = ?",
    )
    .bind(&item_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match item {
        Some(i) => Json(i).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// DELETE /api/servers/:serverId/roadmap/:itemId
/// Owner or admin only.
pub async fn delete_roadmap_item(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, item_id)): Path<(String, String)>,
) -> impl IntoResponse {
    if let Err(resp) = require_server_admin(&state, &user.id, &server_id).await {
        return resp.into_response();
    }

    sqlx::query("DELETE FROM roadmap_items WHERE id = ? AND server_id = ?")
        .bind(&item_id)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();

    StatusCode::NO_CONTENT.into_response()
}
