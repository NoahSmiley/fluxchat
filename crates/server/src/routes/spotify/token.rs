use serde::Deserialize;

pub const SPOTIFY_TOKEN_URL: &str = "https://accounts.spotify.com/api/token";

#[derive(Deserialize)]
pub struct SpotifyTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: i64,
    #[serde(default)]
    pub scope: String,
}

#[derive(Deserialize)]
pub struct SpotifyProfile {
    pub display_name: Option<String>,
}

pub async fn get_valid_token(db: &sqlx::SqlitePool, user_id: &str) -> Result<String, String> {
    let row = sqlx::query_as::<_, (String, String)>(
        r#"SELECT accessToken, COALESCE(accessTokenExpiresAt, '') FROM "account"
           WHERE userId = ? AND providerId = 'spotify'"#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|_| "Database error".to_string())?
    .ok_or_else(|| "Spotify not linked".to_string())?;

    let (token, expires_at) = row;

    let now = chrono::Utc::now();
    let is_expired = if expires_at.is_empty() {
        true
    } else {
        chrono::DateTime::parse_from_rfc3339(&expires_at)
            .map(|e| now > e - chrono::Duration::minutes(5))
            .unwrap_or(true)
    };

    if is_expired {
        refresh_user_token(db, user_id).await?;
        let new_token = sqlx::query_scalar::<_, String>(
            r#"SELECT accessToken FROM "account" WHERE userId = ? AND providerId = 'spotify'"#,
        )
        .bind(user_id)
        .fetch_one(db)
        .await
        .map_err(|_| "Failed to fetch refreshed token".to_string())?;
        Ok(new_token)
    } else {
        Ok(token)
    }
}

async fn refresh_user_token(db: &sqlx::SqlitePool, user_id: &str) -> Result<(), String> {
    let refresh_token = sqlx::query_scalar::<_, String>(
        r#"SELECT refreshToken FROM "account" WHERE userId = ? AND providerId = 'spotify'"#,
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(|_| "Database error".to_string())?
    .ok_or_else(|| "No refresh token".to_string())?;

    let client_id =
        std::env::var("SPOTIFY_CLIENT_ID").map_err(|_| "No SPOTIFY_CLIENT_ID".to_string())?;

    let client = reqwest::Client::new();
    let res = client
        .post(SPOTIFY_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        tracing::error!("Spotify token refresh failed ({}): {}", status, body);
        return Err(format!("Token refresh failed ({})", status));
    }

    let token_data: SpotifyTokenResponse =
        res.json().await.map_err(|_| "Parse error".to_string())?;

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(token_data.expires_in);
    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query(
        r#"UPDATE "account" SET
           accessToken = ?,
           refreshToken = COALESCE(?, refreshToken),
           accessTokenExpiresAt = ?,
           updatedAt = ?
           WHERE userId = ? AND providerId = 'spotify'"#,
    )
    .bind(&token_data.access_token)
    .bind(&token_data.refresh_token)
    .bind(expires_at.to_rfc3339())
    .bind(&now)
    .bind(user_id)
    .execute(db)
    .await;

    Ok(())
}
