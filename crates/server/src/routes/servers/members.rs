use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, MemberWithUser, UpdateMemberRoleRequest};
use crate::AppState;

/// GET /api/servers/:serverId/members
pub async fn list_members(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    let membership = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if membership == 0 {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not a member of this server"})),
        )
            .into_response();
    }

    let members = sqlx::query_as::<_, MemberWithUser>(
        r#"SELECT m.user_id, m.server_id, m.role, m.joined_at, u.username, u.image, u.ring_style, u.ring_spin, u.steam_id, u.ring_pattern_seed, u.banner_css, u.banner_pattern_seed
           FROM memberships m
           INNER JOIN "user" u ON u.id = m.user_id
           WHERE m.server_id = ?"#,
    )
    .bind(&server_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(members).into_response()
}

/// PATCH /api/members/:userId/role
pub async fn update_member_role(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(target_user_id): Path<String>,
    Json(body): Json<UpdateMemberRoleRequest>,
) -> impl IntoResponse {
    let server = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM servers ORDER BY created_at ASC LIMIT 1",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let server_id = match server {
        Some((id,)) => id,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "No server found"})),
            )
                .into_response()
        }
    };

    let caller_role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match caller_role.as_deref() {
        Some("owner") | Some("admin") => {}
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Insufficient permissions"})),
            )
                .into_response()
        }
    }

    let target_info = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT role, role_updated_at FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&target_user_id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (target_role, role_updated_at) = match target_info {
        Some(info) => info,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Member not found"})),
            )
                .into_response()
        }
    };

    if target_role == "owner" {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Cannot change owner role"})),
        )
            .into_response();
    }

    if body.role != "admin" && body.role != "member" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Role must be 'admin' or 'member'"})),
        )
            .into_response();
    }

    // Demotion rules: admins can only demote other admins within 72 hours of their promotion
    if target_role == "admin" && body.role == "member" && caller_role.as_deref() == Some("admin") {
        if let Some(updated_at) = role_updated_at {
            if let Ok(promoted_at) = chrono::DateTime::parse_from_rfc3339(&updated_at) {
                let hours_since = (chrono::Utc::now() - promoted_at.with_timezone(&chrono::Utc))
                    .num_hours();
                if hours_since > 72 {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(serde_json::json!({"error": "Admins can only demote other admins within 72 hours of their promotion. Only the owner can demote after that."})),
                    )
                        .into_response();
                }
            }
        } else {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Only the owner can demote this admin"})),
            )
                .into_response();
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE memberships SET role = ?, role_updated_at = ? WHERE user_id = ? AND server_id = ?")
        .bind(&body.role)
        .bind(&now)
        .bind(&target_user_id)
        .bind(&server_id)
        .execute(&state.db)
        .await
        .ok();

    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::MemberRoleUpdated {
                server_id: server_id.clone(),
                user_id: target_user_id.clone(),
                role: body.role.clone(),
            },
            None,
        )
        .await;

    StatusCode::NO_CONTENT.into_response()
}
