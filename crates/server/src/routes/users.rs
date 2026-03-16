use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{AuthUser, UpdateUserRequest};
use crate::AppState;

/// Resolve intro/exit sound attachment IDs to URLs for a user.
async fn resolve_sound_urls(db: &sqlx::SqlitePool, user_id: &str) -> (Option<String>, Option<String>) {
    let row = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, Option<String>)>(
        r#"SELECT u.intro_sound_attachment_id, a_intro.filename,
                  u.exit_sound_attachment_id, a_exit.filename
           FROM "user" u
           LEFT JOIN attachments a_intro ON a_intro.id = u.intro_sound_attachment_id
           LEFT JOIN attachments a_exit  ON a_exit.id  = u.exit_sound_attachment_id
           WHERE u.id = ?"#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    match row {
        Some((intro_id, intro_name, exit_id, exit_name)) => {
            let intro = intro_id.zip(intro_name).map(|(id, name)| format!("/files/{}/{}", id, name));
            let exit = exit_id.zip(exit_name).map(|(id, name)| format!("/files/{}/{}", id, name));
            (intro, exit)
        }
        None => (None, None),
    }
}

/// Handle a nullable attachment ID field: null clears it, string sets it (with ownership validation).
async fn handle_sound_field(
    db: &sqlx::SqlitePool,
    user_id: &str,
    column: &str,
    value: &serde_json::Value,
) -> Result<bool, (StatusCode, Json<serde_json::Value>)> {
    match value {
        serde_json::Value::Null => {
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(&format!(
                r#"UPDATE "user" SET {} = NULL, updatedAt = ? WHERE id = ?"#, column
            ))
            .bind(&now)
            .bind(user_id)
            .execute(db)
            .await;
            Ok(true)
        }
        serde_json::Value::String(att_id) => {
            let valid = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM attachments WHERE id = ? AND uploader_id = ?",
            )
            .bind(att_id)
            .bind(user_id)
            .fetch_one(db)
            .await
            .unwrap_or(0);

            if valid == 0 {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "Invalid attachment"})),
                ));
            }

            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(&format!(
                r#"UPDATE "user" SET {} = ?, updatedAt = ? WHERE id = ?"#, column
            ))
            .bind(att_id)
            .bind(&now)
            .bind(user_id)
            .execute(db)
            .await;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// GET /api/users/me
pub async fn get_me(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let profile = sqlx::query_as::<_, (String, String, String, Option<String>, String, bool, Option<String>, Option<i64>, Option<String>, Option<i64>, String)>(
        r#"SELECT id, username, email, image, ring_style, ring_spin, steam_id, ring_pattern_seed, banner_css, banner_pattern_seed, status FROM "user" WHERE id = ?"#,
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match profile {
        Some((id, username, email, image, ring_style, ring_spin, steam_id, ring_pattern_seed, banner_css, banner_pattern_seed, status)) => {
            let (intro_sound_url, exit_sound_url) = resolve_sound_urls(&state.db, &id).await;
            Json(serde_json::json!({
                "id": id,
                "username": username,
                "email": email,
                "image": image,
                "ringStyle": ring_style,
                "ringSpin": ring_spin,
                "steamId": steam_id,
                "ringPatternSeed": ring_pattern_seed,
                "bannerCss": banner_css,
                "bannerPatternSeed": banner_pattern_seed,
                "status": status,
                "introSoundUrl": intro_sound_url,
                "exitSoundUrl": exit_sound_url,
            }))
            .into_response()
        }
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
        let valid = [
            "default", "chroma", "pulse", "wave", "ember", "frost", "neon", "galaxy", "none",
        ];
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

    // Intro sound
    if let Some(ref val) = body.intro_sound_attachment_id {
        match handle_sound_field(&state.db, &user.id, "intro_sound_attachment_id", val).await {
            Ok(true) => has_updates = true,
            Err(e) => return e.into_response(),
            _ => {}
        }
    }

    // Exit sound
    if let Some(ref val) = body.exit_sound_attachment_id {
        match handle_sound_field(&state.db, &user.id, "exit_sound_attachment_id", val).await {
            Ok(true) => has_updates = true,
            Err(e) => return e.into_response(),
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
    let profile = sqlx::query_as::<_, (String, String, String, Option<String>, String, bool, Option<String>, Option<i64>, Option<String>, Option<i64>, String)>(
        r#"SELECT id, username, email, image, ring_style, ring_spin, steam_id, ring_pattern_seed, banner_css, banner_pattern_seed, status FROM "user" WHERE id = ?"#,
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match profile {
        Some((id, username, email, image, ring_style, ring_spin, steam_id, ring_pattern_seed, banner_css, banner_pattern_seed, status)) => {
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
                        ring_pattern_seed: None,
                        banner_css: None,
                        banner_pattern_seed: None,
                    },
                    None,
                )
                .await;

            let (intro_sound_url, exit_sound_url) = resolve_sound_urls(&state.db, &id).await;

            Json(serde_json::json!({
                "id": id,
                "username": username,
                "email": email,
                "image": image,
                "ringStyle": ring_style,
                "ringSpin": ring_spin,
                "steamId": steam_id,
                "ringPatternSeed": ring_pattern_seed,
                "bannerCss": banner_css,
                "bannerPatternSeed": banner_pattern_seed,
                "status": status,
                "introSoundUrl": intro_sound_url,
                "exitSoundUrl": exit_sound_url,
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
