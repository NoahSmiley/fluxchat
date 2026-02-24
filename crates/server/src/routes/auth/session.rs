use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::{SessionResponse, SessionUser, SignInRequest};
use crate::AppState;

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

/// Extract session token from headers (Authorization or cookie).
fn extract_token(headers: &HeaderMap) -> Option<String> {
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

    token_from_header.or(token_from_cookie)
}

/// POST /api/auth/sign-out
pub async fn sign_out(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(token) = extract_token(&headers) {
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
    let token = match extract_token(&headers) {
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
