mod manage;

pub use manage::*;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

// ── Request / response types ──────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapItemRow {
    pub id: String,
    pub server_id: String,
    pub title: String,
    pub description: String,
    pub status: String,
    pub category: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoadmapItemRequest {
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoadmapItemRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub status: Option<String>,
    pub category: Option<String>,
}

// ── Per-server admin check ────────────────────────────────────────────────

pub(super) async fn require_server_admin(
    state: &AppState,
    user_id: &str,
    server_id: &str,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(user_id)
    .bind(server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match role.as_deref() {
        Some("owner") | Some("admin") => Ok(()),
        _ => Err((
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Insufficient permissions"})),
        )),
    }
}

const VALID_STATUSES: &[&str] = &["planned", "in-progress", "done", "bug"];

// ── Handlers ──────────────────────────────────────────────────────────────

/// GET /api/servers/:serverId/roadmap
/// Any server member can list roadmap items.
pub async fn list_roadmap_items(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    // Verify caller is a member
    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0)
        > 0;

    if !is_member {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not a member of this server"})),
        )
            .into_response();
    }

    let items = sqlx::query_as::<_, RoadmapItemRow>(
        "SELECT * FROM roadmap_items WHERE server_id = ? ORDER BY created_at ASC",
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(items).into_response()
}

/// POST /api/servers/:serverId/roadmap
/// Owner or admin only.
pub async fn create_roadmap_item(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Json(body): Json<CreateRoadmapItemRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_server_admin(&state, &user.id, &server_id).await {
        return resp.into_response();
    }

    let title = body.title.trim().to_string();
    if title.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Title is required"})),
        )
            .into_response();
    }

    let status = body.status.as_deref().unwrap_or("planned");
    if !VALID_STATUSES.contains(&status) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Invalid status"})),
        )
            .into_response();
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let description = body.description.as_deref().unwrap_or("").to_string();

    let result = sqlx::query(
        r#"INSERT INTO roadmap_items
           (id, server_id, title, description, status, category, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&id)
    .bind(&server_id)
    .bind(&title)
    .bind(&description)
    .bind(status)
    .bind(&body.category)
    .bind(&user.id)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        tracing::error!("Failed to create roadmap item: {:?}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to create roadmap item"})),
        )
            .into_response();
    }

    let item = sqlx::query_as::<_, RoadmapItemRow>(
        "SELECT * FROM roadmap_items WHERE id = ?",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match item {
        Some(i) => (StatusCode::CREATED, Json(i)).into_response(),
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
