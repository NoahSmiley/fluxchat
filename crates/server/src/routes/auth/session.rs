use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::AppState;

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

            // Resolve intro/exit sound URLs
            let sound_row = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, Option<String>)>(
                r#"SELECT u.intro_sound_attachment_id, a_intro.filename,
                          u.exit_sound_attachment_id, a_exit.filename
                   FROM "user" u
                   LEFT JOIN attachments a_intro ON a_intro.id = u.intro_sound_attachment_id
                   LEFT JOIN attachments a_exit  ON a_exit.id  = u.exit_sound_attachment_id
                   WHERE u.id = ?"#,
            )
            .bind(&id)
            .fetch_optional(&state.db)
            .await
            .ok()
            .flatten();

            let (intro_sound_url, exit_sound_url) = match sound_row {
                Some((intro_id, intro_name, exit_id, exit_name)) => (
                    intro_id.zip(intro_name).map(|(i, n)| format!("/files/{}/{}", i, n)),
                    exit_id.zip(exit_name).map(|(i, n)| format!("/files/{}/{}", i, n)),
                ),
                None => (None, None),
            };

            Json(serde_json::json!({
                "user": {
                    "id": id,
                    "email": email,
                    "username": username,
                    "image": image,
                    "ringStyle": ring_style,
                    "ringSpin": ring_spin,
                    "status": status,
                    "introSoundUrl": intro_sound_url,
                    "exitSoundUrl": exit_sound_url,
                }
            }))
            .into_response()
        }
        None => Json(serde_json::json!(null)).into_response(),
    }
}
