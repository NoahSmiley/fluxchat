use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, SetPublicKeyRequest, StoreServerKeyRequest};
use crate::AppState;

/// PUT /api/users/me/public-key
pub async fn set_public_key(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<SetPublicKeyRequest>,
) -> impl IntoResponse {
    let _ = sqlx::query(r#"UPDATE "user" SET public_key = ? WHERE id = ?"#)
        .bind(&body.public_key)
        .bind(&user.id)
        .execute(&state.db)
        .await;

    StatusCode::NO_CONTENT.into_response()
}

/// GET /api/users/:id/public-key
pub async fn get_public_key(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let result = sqlx::query_as::<_, (Option<String>,)>(
        r#"SELECT public_key FROM "user" WHERE id = ?"#,
    )
    .bind(&user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match result {
        Some((public_key,)) => {
            Json(serde_json::json!({ "publicKey": public_key })).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "User not found"})),
        )
            .into_response(),
    }
}

/// POST /api/servers/:id/keys — store my own wrapped group key
pub async fn store_server_key(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
    Json(body): Json<StoreServerKeyRequest>,
) -> impl IntoResponse {
    // Verify membership
    let is_member = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if is_member == 0 {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not a member"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO server_keys (server_id, user_id, encrypted_key, sender_id, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_id, user_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, sender_id = excluded.sender_id",
    )
    .bind(&server_id)
    .bind(&user.id)
    .bind(&body.encrypted_key)
    .bind(&body.sender_id)
    .bind(&now)
    .execute(&state.db)
    .await;

    StatusCode::NO_CONTENT.into_response()
}

/// GET /api/servers/:id/keys/me — get my wrapped group key
pub async fn get_my_server_key(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(server_id): Path<String>,
) -> impl IntoResponse {
    let result = sqlx::query_as::<_, (String, String)>(
        "SELECT encrypted_key, sender_id FROM server_keys WHERE server_id = ? AND user_id = ?",
    )
    .bind(&server_id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match result {
        Some((encrypted_key, sender_id)) => {
            Json(serde_json::json!({
                "encryptedKey": encrypted_key,
                "senderId": sender_id,
            }))
            .into_response()
        }
        None => Json(serde_json::json!(null)).into_response(),
    }
}

/// POST /api/servers/:id/keys/:userId — share wrapped key with another member
pub async fn share_server_key(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path((server_id, target_user_id)): Path<(String, String)>,
    Json(body): Json<StoreServerKeyRequest>,
) -> impl IntoResponse {
    // Verify both are members
    let my_membership = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&user.id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let target_membership = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM memberships WHERE user_id = ? AND server_id = ?",
    )
    .bind(&target_user_id)
    .bind(&server_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if my_membership == 0 || target_membership == 0 {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Not a member"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO server_keys (server_id, user_id, encrypted_key, sender_id, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_id, user_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, sender_id = excluded.sender_id",
    )
    .bind(&server_id)
    .bind(&target_user_id)
    .bind(&body.encrypted_key)
    .bind(&body.sender_id)
    .bind(&now)
    .execute(&state.db)
    .await;

    StatusCode::NO_CONTENT.into_response()
}
