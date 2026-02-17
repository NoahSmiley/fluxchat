use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AddWhitelistRequest, AuthUser, WhitelistEntry};
use crate::AppState;

/// Check if the caller is an admin or owner of the default server
async fn require_admin(state: &AppState, user_id: &str) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT m.role FROM memberships m INNER JOIN servers s ON s.id = m.server_id WHERE m.user_id = ? ORDER BY s.created_at ASC LIMIT 1",
    )
    .bind(user_id)
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

/// GET /api/whitelist
pub async fn list_whitelist(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    if let Err(resp) = require_admin(&state, &user.id).await {
        return resp.into_response();
    }

    let entries = sqlx::query_as::<_, WhitelistEntry>(
        r#"SELECT id, email, added_by, added_at FROM email_whitelist ORDER BY added_at DESC"#,
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(entries).into_response()
}

/// POST /api/whitelist
pub async fn add_to_whitelist(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<AddWhitelistRequest>,
) -> impl IntoResponse {
    if let Err(resp) = require_admin(&state, &user.id).await {
        return resp.into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut added = Vec::new();

    for email in &body.emails {
        let email = email.trim().to_lowercase();
        if email.is_empty() {
            continue;
        }

        let id = uuid::Uuid::new_v4().to_string();
        let result = sqlx::query(
            r#"INSERT OR IGNORE INTO email_whitelist (id, email, added_by, added_at) VALUES (?, ?, ?, ?)"#,
        )
        .bind(&id)
        .bind(&email)
        .bind(&user.id)
        .bind(&now)
        .execute(&state.db)
        .await;

        if let Ok(r) = result {
            if r.rows_affected() > 0 {
                added.push(WhitelistEntry {
                    id,
                    email,
                    added_by: user.id.clone(),
                    added_at: now.clone(),
                });
            }
        }
    }

    (StatusCode::CREATED, Json(added)).into_response()
}

/// DELETE /api/whitelist/:id
pub async fn remove_from_whitelist(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Err(resp) = require_admin(&state, &user.id).await {
        return resp.into_response();
    }

    sqlx::query("DELETE FROM email_whitelist WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await
        .ok();

    StatusCode::NO_CONTENT.into_response()
}
