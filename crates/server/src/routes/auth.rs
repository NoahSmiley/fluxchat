use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use argon2::PasswordHasher;
use crate::models::{SessionResponse, SessionUser, SignInRequest, SignUpRequest};
use crate::AppState;

/// POST /api/auth/sign-up/email
pub async fn sign_up(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SignUpRequest>,
) -> impl IntoResponse {
    let email = body.email.trim().to_lowercase();
    let username = body.username.trim().to_string();
    let name = body.name.trim().to_string();

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

    // Set cookie header
    let cookie = format!(
        "better-auth.session_token={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000",
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
    let user = sqlx::query_as::<_, (String, String, String, Option<String>)>(
        r#"SELECT id, email, username, image FROM "user" WHERE email = ?"#,
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (user_id, user_email, username, image) = match user {
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
        "better-auth.session_token={}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000",
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
    };

    (StatusCode::OK, headers, Json(body)).into_response()
}

/// POST /api/auth/sign-out
pub async fn sign_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let cookie_header = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = cookie_header
        .split(';')
        .filter_map(|c| {
            let c = c.trim();
            if c.starts_with("better-auth.session_token=") {
                Some(
                    c.trim_start_matches("better-auth.session_token=")
                        .to_string(),
                )
            } else {
                None
            }
        })
        .next();

    if let Some(token) = token {
        let _ = sqlx::query(r#"DELETE FROM "session" WHERE token = ?"#)
            .bind(&token)
            .execute(&state.db)
            .await;
    }

    // Clear cookie
    let cookie =
        "better-auth.session_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0".to_string();

    let mut resp_headers = HeaderMap::new();
    resp_headers.insert("set-cookie", cookie.parse().unwrap());

    (StatusCode::OK, resp_headers, Json(serde_json::json!({}))).into_response()
}

/// GET /api/auth/get-session
pub async fn get_session(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let cookie_header = headers
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let token = cookie_header
        .split(';')
        .filter_map(|c| {
            let c = c.trim();
            if c.starts_with("better-auth.session_token=") {
                Some(
                    c.trim_start_matches("better-auth.session_token=")
                        .to_string(),
                )
            } else {
                None
            }
        })
        .next();

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Json(serde_json::json!(null)).into_response(),
    };

    let row = sqlx::query_as::<_, (String, String, String, Option<String>, String)>(
        r#"SELECT u.id, u.email, u.username, u.image, s.expiresAt
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
        Some((id, email, username, image, expires_at)) => {
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
                }
            }))
            .into_response()
        }
        None => Json(serde_json::json!(null)).into_response(),
    }
}
