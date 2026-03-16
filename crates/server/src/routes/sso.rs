use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::models::{SessionResponse, SessionUser};
use crate::ws::events::ServerEvent;
use crate::AppState;

// ── Request / Response types ──

#[derive(Deserialize)]
struct AthionInitiateResponse {
    code: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SsoInitiateResponse {
    code: String,
    expires_at: String,
    login_url: String,
}

#[derive(Deserialize)]
pub struct SsoPollRequest {
    code: String,
}

#[derive(Deserialize)]
struct AthionPollResponse {
    status: String,
    token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AthionMeResponse {
    email: String,
    display_name: String,
}

// ── Handlers ──

/// POST /api/auth/sso/initiate
/// Calls Athion to generate a one-time auth code, returns it with a login URL.
pub async fn sso_initiate(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/auth/ide/initiate", state.config.athion_url))
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Athion SSO initiate failed: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Authentication service unavailable"})),
            )
                .into_response();
        }
    };

    if !res.status().is_success() {
        return (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"error": "Authentication service returned an error"})),
        )
            .into_response();
    }

    let body: AthionInitiateResponse = match res.json().await {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("Failed to parse Athion initiate response: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Invalid response from authentication service"})),
            )
                .into_response();
        }
    };

    let login_url = format!(
        "{}/auth/ide-login?code={}&app=flux",
        state.config.athion_url, body.code
    );

    (
        StatusCode::OK,
        Json(SsoInitiateResponse {
            code: body.code,
            expires_at: body.expires_at,
            login_url,
        }),
    )
        .into_response()
}

/// POST /api/auth/sso/poll
/// Polls Athion for auth completion. On success, validates the Athion JWT,
/// provisions/matches the local user, and returns a Flux session token.
pub async fn sso_poll(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SsoPollRequest>,
) -> impl IntoResponse {
    let client = reqwest::Client::new();

    // Poll Athion
    let res = client
        .post(format!("{}/api/auth/ide/poll", state.config.athion_url))
        .json(&serde_json::json!({ "code": body.code }))
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Athion SSO poll failed: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Authentication service unavailable"})),
            )
                .into_response();
        }
    };

    let poll_text = res.text().await.unwrap_or_default();
    tracing::info!("Athion poll raw response: {}", poll_text);

    let poll: AthionPollResponse = match serde_json::from_str(&poll_text) {
        Ok(b) => b,
        Err(e) => {
            tracing::error!("Failed to parse Athion poll response: {} — raw: {}", e, poll_text);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Invalid response from authentication service"})),
            )
                .into_response();
        }
    };

    // Still pending or expired — pass through
    if poll.status != "complete" {
        tracing::info!("Athion poll status: {}", poll.status);
        return Json(serde_json::json!({ "status": poll.status })).into_response();
    }

    let athion_token = match poll.token {
        Some(t) => t,
        None => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Auth completed but no token received"})),
            )
                .into_response();
        }
    };

    // Validate the Athion JWT by calling /api/auth/ide/me
    tracing::info!("Athion poll complete, validating token via /ide/me");
    let me_res = client
        .get(format!("{}/api/auth/ide/me", state.config.athion_url))
        .header("Authorization", format!("Bearer {}", athion_token))
        .send()
        .await;

    let me_res = match me_res {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            let status = r.status();
            let body = r.text().await.unwrap_or_default();
            tracing::error!("Athion /ide/me returned {} — body: {}", status, body);
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "Failed to validate authentication"})),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!("Athion /ide/me request failed: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Authentication service unavailable"})),
            )
                .into_response();
        }
    };

    let athion_user: AthionMeResponse = match me_res.json().await {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("Failed to parse Athion /ide/me response: {}", e);
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": "Invalid response from authentication service"})),
            )
                .into_response();
        }
    };

    let email = athion_user.email.trim().to_lowercase();
    let display_name = athion_user.display_name.trim().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Find existing user by email
    let existing = sqlx::query_as::<_, (String, String, Option<String>)>(
        r#"SELECT id, username, image FROM "user" WHERE LOWER(email) = ?"#,
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (user_id, username, image) = if let Some((id, uname, img)) = existing {
        // Existing user — ensure they have an athion account record
        let has_athion = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM "account" WHERE userId = ? AND providerId = 'athion'"#,
        )
        .bind(&id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if has_athion == 0 {
            let account_id = uuid::Uuid::new_v4().to_string();
            let _ = sqlx::query(
                r#"INSERT INTO "account" (id, userId, accountId, providerId, createdAt, updatedAt)
                   VALUES (?, ?, ?, 'athion', ?, ?)"#,
            )
            .bind(&account_id)
            .bind(&id)
            .bind(&email)
            .bind(&now)
            .bind(&now)
            .execute(&state.db)
            .await;
        }

        (id, uname, img)
    } else {
        // New user — provision
        let username = sanitize_username(&display_name, &state.db).await;
        let user_id = uuid::Uuid::new_v4().to_string();

        let _ = sqlx::query(
            r#"INSERT INTO "user" (id, name, username, email, emailVerified, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, 1, ?, ?)"#,
        )
        .bind(&user_id)
        .bind(&display_name)
        .bind(&username)
        .bind(&email)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await;

        // Create athion account record
        let account_id = uuid::Uuid::new_v4().to_string();
        let _ = sqlx::query(
            r#"INSERT INTO "account" (id, userId, accountId, providerId, createdAt, updatedAt)
               VALUES (?, ?, ?, 'athion', ?, ?)"#,
        )
        .bind(&account_id)
        .bind(&user_id)
        .bind(&email)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await;

        // Auto-join default server (or create one if first user)
        let existing_server = sqlx::query_scalar::<_, String>(
            "SELECT id FROM servers ORDER BY created_at ASC LIMIT 1",
        )
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let (server_id, role) = if let Some(id) = existing_server {
            (id, "member")
        } else {
            let sid = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, 'flux', ?, 'none', ?)",
            )
            .bind(&sid)
            .bind(&user_id)
            .bind(&now)
            .execute(&state.db)
            .await
            .ok();

            sqlx::query(
                "INSERT INTO channels (id, server_id, name, type, parent_id, position, created_at) VALUES (?, ?, 'general', 'text', NULL, 0, ?)",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(&sid)
            .bind(&now)
            .execute(&state.db)
            .await
            .ok();

            sqlx::query(
                "INSERT INTO channels (id, server_id, name, type, parent_id, position, is_room, created_at) VALUES (?, ?, 'Lobby', 'voice', NULL, 1, 1, ?)",
            )
            .bind(uuid::Uuid::new_v4().to_string())
            .bind(&sid)
            .bind(&now)
            .execute(&state.db)
            .await
            .ok();

            (sid, "owner")
        };

        sqlx::query(
            "INSERT OR IGNORE INTO memberships (user_id, server_id, role, joined_at, role_updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&user_id)
        .bind(&server_id)
        .bind(role)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .ok();

        state.gateway.broadcast_all(
            &ServerEvent::MemberJoined {
                server_id: server_id.clone(),
                user_id: user_id.clone(),
                username: username.clone(),
                image: None,
                role: role.to_string(),
                ring_style: "default".to_string(),
                ring_spin: false,
                ring_pattern_seed: None,
                banner_css: None,
                banner_pattern_seed: None,
            },
            None,
        ).await;

        (user_id, username, None)
    };

    // Create Flux session
    let session_token = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();

    let _ = sqlx::query(
        r#"INSERT INTO "session" (id, userId, token, expiresAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&session_id)
    .bind(&user_id)
    .bind(&session_token)
    .bind(&expires_at)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    let cookie = format!(
        "better-auth.session_token={}; HttpOnly; SameSite=None; Path=/; Max-Age=2592000",
        session_token
    );

    let mut headers = HeaderMap::new();
    headers.insert("set-cookie", cookie.parse().unwrap());

    let body = SessionResponse {
        user: SessionUser {
            id: user_id,
            email,
            username,
            image,
        },
        token: Some(session_token),
    };

    (StatusCode::OK, headers, Json(body)).into_response()
}

// ── Helpers ──

/// Sanitize a display name into a valid Flux username (2-32 chars, alphanumeric + hyphens/underscores).
/// Handles collisions by appending -1, -2, etc.
async fn sanitize_username(display_name: &str, db: &sqlx::SqlitePool) -> String {
    let mut base: String = display_name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    if base.len() > 32 {
        base.truncate(32);
    }
    if base.len() < 2 {
        base = format!("user-{}", &uuid::Uuid::new_v4().to_string()[..6]);
    }

    // Check uniqueness
    let taken = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM "user" WHERE username = ?"#,
    )
    .bind(&base)
    .fetch_one(db)
    .await
    .unwrap_or(0);

    if taken == 0 {
        return base;
    }

    // Try appending numbers
    for i in 1..100 {
        let candidate = format!("{}-{}", base, i);
        if candidate.len() > 32 {
            break;
        }
        let taken = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM "user" WHERE username = ?"#,
        )
        .bind(&candidate)
        .fetch_one(db)
        .await
        .unwrap_or(0);

        if taken == 0 {
            return candidate;
        }
    }

    // Fallback: UUID-based username
    format!("user-{}", &uuid::Uuid::new_v4().to_string()[..8])
}
