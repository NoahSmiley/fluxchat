mod channels;
mod members;
mod rooms;

pub use channels::*;
pub use members::*;
pub use rooms::*;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, Server, ServerWithRole, UpdateServerRequest};
use crate::AppState;

/// GET /api/servers
pub async fn list_servers(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let servers = sqlx::query_as::<_, ServerWithRole>(
        r#"SELECT s.id, s.name, s.owner_id, s.invite_code, s.created_at, m.role
           FROM memberships m
           INNER JOIN servers s ON s.id = m.server_id
           WHERE m.user_id = ?"#,
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    Json(servers).into_response()
}

/// GET /api/servers/:serverId
pub async fn get_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    let membership = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let role = match membership {
        Some(r) => r,
        None => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not a member of this server"})),
            )
                .into_response()
        }
    };

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    match server {
        Some(s) => Json(ServerWithRole {
            id: s.id,
            name: s.name,
            owner_id: s.owner_id,
            invite_code: s.invite_code,
            created_at: s.created_at,
            role,
        })
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Server not found"})),
        )
            .into_response(),
    }
}

/// PATCH /api/servers/:serverId
pub async fn update_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Json(body): Json<UpdateServerRequest>,
) -> impl IntoResponse {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match role.as_deref() {
        Some("owner") | Some("admin") => {}
        _ => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Insufficient permissions"})),
            )
                .into_response();
        }
    }

    let server = sqlx::query_as::<_, Server>("SELECT * FROM servers WHERE id = ?")
        .bind(&server_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

    let server = match server {
        Some(s) => s,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Server not found"})),
            )
                .into_response()
        }
    };

    let new_name = if let Some(ref name) = body.name {
        if let Err(e) = flux_shared::validation::validate_server_name(name) {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response();
        }
        name.trim().to_string()
    } else {
        server.name.clone()
    };

    let _ = sqlx::query("UPDATE servers SET name = ? WHERE id = ?")
        .bind(&new_name)
        .bind(&server_id)
        .execute(&state.db)
        .await;

    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::ServerUpdated {
                server_id: server_id.clone(),
                name: new_name.clone(),
            },
            None,
        )
        .await;

    let updated = Server {
        id: server.id,
        name: new_name,
        owner_id: server.owner_id,
        invite_code: server.invite_code,
        created_at: server.created_at,
    };

    Json(updated).into_response()
}

/// DELETE /api/servers/:serverId/members/me
pub async fn leave_server(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    let role = sqlx::query_scalar::<_, String>(
        "SELECT role FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match role.as_deref() {
        None => {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Not a member of this server"})),
            )
                .into_response()
        }
        Some("owner") => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Server owner cannot leave. Delete the server instead."})),
            )
                .into_response()
        }
        _ => {}
    }

    let _ = sqlx::query("DELETE FROM memberships WHERE user_id = ? AND server_id = ?")
        .bind(&user.id)
        .bind(&server_id)
        .execute(&state.db)
        .await;

    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::MemberLeft {
                server_id: server_id.clone(),
                user_id: user.id.clone(),
            },
            None,
        )
        .await;

    StatusCode::NO_CONTENT.into_response()
}
