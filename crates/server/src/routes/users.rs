use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, UpdateUserRequest};
use crate::AppState;

/// GET /api/users/me
pub async fn get_me(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let profile = sqlx::query_as::<_, (String, String, String, Option<String>, String, bool, Option<String>)>(
        r#"SELECT id, username, email, image, ring_style, ring_spin, steam_id FROM "user" WHERE id = ?"#,
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match profile {
        Some((id, username, email, image, ring_style, ring_spin, steam_id)) => Json(serde_json::json!({
            "id": id,
            "username": username,
            "email": email,
            "image": image,
            "ringStyle": ring_style,
            "ringSpin": ring_spin,
            "steamId": steam_id,
        }))
        .into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "User not found"})),
        )
            .into_response(),
    }
}

/// PATCH /api/users/me
pub async fn update_me(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<UpdateUserRequest>,
) -> impl IntoResponse {
    let mut has_updates = false;

    if let Some(ref username) = body.username {
        let trimmed = username.trim();
        if trimmed.len() < 2 || trimmed.len() > 32 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Username must be 2-32 characters"})),
            )
                .into_response();
        }

        let re = regex_lite::Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap();
        if !re.is_match(trimmed) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Username can only contain letters, numbers, hyphens, and underscores"})),
            )
                .into_response();
        }

        // Check uniqueness
        let existing = sqlx::query_as::<_, (String,)>(
            r#"SELECT id FROM "user" WHERE username = ?"#,
        )
        .bind(trimmed)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        if let Some((existing_id,)) = existing {
            if existing_id != user.id {
                return (
                    StatusCode::CONFLICT,
                    Json(serde_json::json!({"error": "Username already taken"})),
                )
                    .into_response();
            }
        }

        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query(
            r#"UPDATE "user" SET username = ?, name = ?, updatedAt = ? WHERE id = ?"#,
        )
        .bind(trimmed)
        .bind(trimmed)
        .bind(&now)
        .bind(&user.id)
        .execute(&state.db)
        .await;

        has_updates = true;
    }

    if let Some(ref image_val) = body.image {
        match image_val {
            serde_json::Value::Null => {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = sqlx::query(
                    r#"UPDATE "user" SET image = NULL, updatedAt = ? WHERE id = ?"#,
                )
                .bind(&now)
                .bind(&user.id)
                .execute(&state.db)
                .await;
                has_updates = true;
            }
            serde_json::Value::String(img) => {
                if img.len() > 5_000_000 {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(serde_json::json!({"error": "Image too large (max ~4MB)"})),
                    )
                        .into_response();
                }
                let now = chrono::Utc::now().to_rfc3339();
                let _ = sqlx::query(
                    r#"UPDATE "user" SET image = ?, updatedAt = ? WHERE id = ?"#,
                )
                .bind(img)
                .bind(&now)
                .bind(&user.id)
                .execute(&state.db)
                .await;
                has_updates = true;
            }
            _ => {}
        }
    }

    if let Some(ref ring_style) = body.ring_style {
        let valid = ["default", "chroma", "pulse", "wave", "ember", "frost", "neon", "galaxy", "none"];
        if !valid.contains(&ring_style.as_str()) {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Invalid ring style"})),
            )
                .into_response();
        }
        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query(
            r#"UPDATE "user" SET ring_style = ?, updatedAt = ? WHERE id = ?"#,
        )
        .bind(ring_style)
        .bind(&now)
        .bind(&user.id)
        .execute(&state.db)
        .await;
        has_updates = true;
    }

    if let Some(ring_spin) = body.ring_spin {
        let now = chrono::Utc::now().to_rfc3339();
        let _ = sqlx::query(
            r#"UPDATE "user" SET ring_spin = ?, updatedAt = ? WHERE id = ?"#,
        )
        .bind(ring_spin)
        .bind(&now)
        .bind(&user.id)
        .execute(&state.db)
        .await;
        has_updates = true;
    }

    if let Some(ref steam_val) = body.steam_id {
        match steam_val {
            serde_json::Value::Null => {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = sqlx::query(
                    r#"UPDATE "user" SET steam_id = NULL, updatedAt = ? WHERE id = ?"#,
                )
                .bind(&now)
                .bind(&user.id)
                .execute(&state.db)
                .await;
                has_updates = true;
            }
            serde_json::Value::String(sid) => {
                let trimmed = sid.trim();
                if !trimmed.is_empty() {
                    let now = chrono::Utc::now().to_rfc3339();
                    let _ = sqlx::query(
                        r#"UPDATE "user" SET steam_id = ?, updatedAt = ? WHERE id = ?"#,
                    )
                    .bind(trimmed)
                    .bind(&now)
                    .bind(&user.id)
                    .execute(&state.db)
                    .await;
                    has_updates = true;
                }
            }
            _ => {}
        }
    }

    if !has_updates {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "No fields to update"})),
        )
            .into_response();
    }

    // Return updated profile
    let profile = sqlx::query_as::<_, (String, String, String, Option<String>, String, bool, Option<String>)>(
        r#"SELECT id, username, email, image, ring_style, ring_spin, steam_id FROM "user" WHERE id = ?"#,
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match profile {
        Some((id, username, email, image, ring_style, ring_spin, steam_id)) => {
            // Broadcast profile update to all connected clients
            state
                .gateway
                .broadcast_all(
                    &crate::ws::events::ServerEvent::ProfileUpdate {
                        user_id: id.clone(),
                        username: body.username.as_ref().map(|u| u.trim().to_string()),
                        image: body.image.as_ref().map(|v| match v {
                            serde_json::Value::Null => None,
                            serde_json::Value::String(s) => Some(s.clone()),
                            _ => None,
                        }),
                        ring_style: body.ring_style.clone(),
                        ring_spin: body.ring_spin,
                    },
                    None,
                )
                .await;

            Json(serde_json::json!({
                "id": id,
                "username": username,
                "email": email,
                "image": image,
                "ringStyle": ring_style,
                "ringSpin": ring_spin,
                "steamId": steam_id,
            }))
            .into_response()
        }
        None => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to fetch updated profile"})),
        )
            .into_response(),
    }
}
