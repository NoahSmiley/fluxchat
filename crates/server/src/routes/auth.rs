use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use argon2::PasswordHasher;
use crate::models::{SessionResponse, SessionUser, SignInRequest, SignUpRequest};
use crate::ws::events::ServerEvent;
use crate::AppState;

/// POST /api/auth/sign-up/email
pub async fn sign_up(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignUpRequest>,
) -> impl IntoResponse {
    let email = body.email.trim().to_lowercase();
    let username = body.username.trim().to_string();
    let name = body.name.trim().to_string();

    // Whitelist gate: only whitelisted emails can register
    // Bypass: allow the first user to register without being whitelisted (bootstrapping)
    let user_count = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM "user""#,
    )
    .fetch_one(&state.db)
    .await
    .unwrap_or(1); // default to 1 so whitelist is enforced on error

    if user_count > 0 {
        let whitelisted = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM email_whitelist WHERE email = ?"#,
        )
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if whitelisted == 0 {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "Email not authorized"})),
            )
                .into_response();
        }
    }

    if username.len() < 2 || username.len() > 32 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Username must be 2-32 characters"})),
        )
            .into_response();
    }

    // Check if email already exists
    let exists = sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM "user" WHERE email = ?"#)
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    if exists > 0 {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "Email already registered"})),
        )
            .into_response();
    }

    // Check if username already exists
    let exists =
        sqlx::query_scalar::<_, i64>(r#"SELECT COUNT(*) FROM "user" WHERE username = ?"#)
            .bind(&username)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);

    if exists > 0 {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({"error": "Username already taken"})),
        )
            .into_response();
    }

    // Hash password
    let salt = argon2::password_hash::SaltString::generate(&mut rand::rngs::OsRng);
    let password_hash = match argon2::Argon2::default().hash_password(body.password.as_bytes(), &salt) {
        Ok(h) => h.to_string(),
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Failed to hash password"})),
            )
                .into_response()
        }
    };

    let user_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Insert user
    let result = sqlx::query(
        r#"INSERT INTO "user" (id, name, username, email, emailVerified, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 0, ?, ?)"#,
    )
    .bind(&user_id)
    .bind(&name)
    .bind(&username)
    .bind(&email)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    if result.is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Failed to create user"})),
        )
            .into_response();
    }

    // Insert account
    let account_id = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        r#"INSERT INTO "account" (id, userId, accountId, providerId, password, createdAt, updatedAt)
           VALUES (?, ?, ?, 'credential', ?, ?, ?)"#,
    )
    .bind(&account_id)
    .bind(&user_id)
    .bind(&user_id)
    .bind(&password_hash)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await;

    // Create session
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

    // Auto-create server on first registration, or join existing server
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
        // First user: create the default server + channels
        let sid = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, 'FluxChat', ?, 'none', ?)",
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

    // Broadcast member_joined to all connected clients
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

    // Set cookie header
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
            image: None,
        },
        token: Some(session_token),
    };

    (StatusCode::OK, headers, Json(body)).into_response()
}

/// POST /api/auth/sign-in/email
pub async fn sign_in(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignInRequest>,
) -> impl IntoResponse {
    use argon2::PasswordVerifier;

    let email = body.email.trim().to_lowercase();

    // Look up user
    let user = sqlx::query_as::<_, (String, String, String, Option<String>, String, bool)>(
        r#"SELECT id, email, username, image, ring_style, ring_spin FROM "user" WHERE email = ?"#,
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (user_id, user_email, username, image, _ring_style, _ring_spin) = match user {
        Some(u) => u,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "Invalid credentials"})),
            )
                .into_response()
        }
    };

    // Look up account password
    let stored_hash = sqlx::query_scalar::<_, String>(
        r#"SELECT password FROM "account" WHERE userId = ? AND providerId = 'credential'"#,
    )
    .bind(&user_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let stored_hash = match stored_hash {
        Some(h) => h,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "Invalid credentials"})),
            )
                .into_response()
        }
    };

    // Verify password
    let parsed_hash = match argon2::PasswordHash::new(&stored_hash) {
        Ok(h) => h,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Internal error"})),
            )
                .into_response()
        }
    };

    if argon2::Argon2::default()
        .verify_password(body.password.as_bytes(), &parsed_hash)
        .is_err()
    {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "Invalid credentials"})),
        )
            .into_response();
    }

    // Create session
    let session_token = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
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
            email: user_email,
            username,
            image,
        },
        token: Some(session_token),
    };

    (StatusCode::OK, headers, Json(body)).into_response()
}

/// POST /api/auth/sign-out
pub async fn sign_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let token_from_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.to_string());

    let token_from_cookie = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .filter_map(|c| {
            let c = c.trim();
            if c.starts_with("better-auth.session_token=") {
                Some(c.trim_start_matches("better-auth.session_token=").to_string())
            } else {
                None
            }
        })
        .next();

    let token = token_from_header.or(token_from_cookie);

    if let Some(token) = token {
        let _ = sqlx::query(r#"DELETE FROM "session" WHERE token = ?"#)
            .bind(&token)
            .execute(&state.db)
            .await;
    }

    // Clear cookie
    let cookie =
        "better-auth.session_token=; HttpOnly; SameSite=None; Path=/; Max-Age=0".to_string();

    let mut resp_headers = HeaderMap::new();
    resp_headers.insert("set-cookie", cookie.parse().unwrap());

    (StatusCode::OK, resp_headers, Json(serde_json::json!({}))).into_response()
}

/// GET /api/auth/get-session
pub async fn get_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Try Authorization: Bearer <token> first, then fall back to cookie
    let token_from_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| t.to_string());

    let token_from_cookie = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .filter_map(|c| {
            let c = c.trim();
            if c.starts_with("better-auth.session_token=") {
                Some(c.trim_start_matches("better-auth.session_token=").to_string())
            } else {
                None
            }
        })
        .next();

    let token = token_from_header.or(token_from_cookie);

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Json(serde_json::json!(null)).into_response(),
    };

    let row = sqlx::query_as::<_, (String, String, String, Option<String>, String, String, bool, String)>(
        r#"SELECT u.id, u.email, u.username, u.image, s.expiresAt, u.ring_style, u.ring_spin, u.status
           FROM "session" s
           JOIN "user" u ON u.id = s.userId
           WHERE s.token = ?"#,
    )
    .bind(&token)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match row {
        Some((id, email, username, image, expires_at, ring_style, ring_spin, status)) => {
            let now = chrono::Utc::now().to_rfc3339();
            if expires_at < now {
                return Json(serde_json::json!(null)).into_response();
            }
            Json(serde_json::json!({
                "user": {
                    "id": id,
                    "email": email,
                    "username": username,
                    "image": image,
                    "ringStyle": ring_style,
                    "ringSpin": ring_spin,
                    "status": status,
                }
            }))
            .into_response()
        }
        None => Json(serde_json::json!(null)).into_response(),
    }
}
