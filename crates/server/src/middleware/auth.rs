use axum::{
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

impl FromRequestParts<Arc<AppState>> for AuthUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        // Try Authorization: Bearer <token> first, then fall back to cookie
        let token_from_header = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(|t| t.to_string());

        let token_from_cookie = parts
            .headers
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
            Some(ref t) if !t.is_empty() => t.as_str(),
            _ => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({"error": "Not authenticated"})),
                )
                    .into_response())
            }
        };

        let row = sqlx::query_as::<_, (String, String, String)>(
            r#"SELECT u.id, u.username, s.expiresAt
               FROM "session" s
               JOIN "user" u ON u.id = s.userId
               WHERE s.token = ?"#,
        )
        .bind(token)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": "Database error"})),
            )
                .into_response()
        })?;

        let (user_id, username, expires_at) = match row {
            Some(r) => r,
            None => {
                return Err((
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({"error": "Invalid session"})),
                )
                    .into_response())
            }
        };

        let now = chrono::Utc::now().to_rfc3339();
        if expires_at < now {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({"error": "Session expired"})),
            )
                .into_response());
        }

        Ok(AuthUser {
            id: user_id,
            username,
        })
    }
}
