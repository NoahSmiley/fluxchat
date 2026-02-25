use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::{AuthUser, LinkPreview};
use crate::AppState;

#[derive(Deserialize)]
pub struct LinkPreviewQuery {
    pub url: Option<String>,
}

/// GET /api/link-preview?url=...
pub async fn link_preview(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(query): Query<LinkPreviewQuery>,
) -> impl IntoResponse {
    let url = match query.url.as_deref() {
        Some(u) if !u.is_empty() => u.to_string(),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Missing url parameter"})),
            )
                .into_response()
        }
    };

    // Check cache (24h TTL)
    let cached = sqlx::query_as::<_, LinkPreview>(
        "SELECT * FROM link_previews WHERE url = ?",
    )
    .bind(&url)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if let Some(ref preview) = cached {
        let now = chrono::Utc::now();
        if let Ok(fetched) = chrono::DateTime::parse_from_rfc3339(&preview.fetched_at) {
            if now.signed_duration_since(fetched).num_hours() < 24 {
                return Json(serde_json::json!({
                    "url": preview.url,
                    "title": preview.title,
                    "description": preview.description,
                    "image": preview.image,
                    "domain": preview.domain,
                }))
                .into_response();
            }
        }
    }

    let domain = url::Url::parse(&url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()));

    // Try YouTube/Vimeo oEmbed first for reliable metadata
    let oembed_result = try_oembed(&url).await;

    let (title, description, image) = if let Some((ot, od, oi)) = oembed_result {
        (ot, od, oi)
    } else {
        // Generic OG tag fetch
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("Mozilla/5.0 (compatible; FluxBot/1.0)")
            .build()
            .unwrap_or_default();

        let response = match client.get(&url).send().await {
            Ok(r) => r,
            Err(_) => {
                return Json(serde_json::json!({
                    "url": url,
                    "title": serde_json::Value::Null,
                    "description": serde_json::Value::Null,
                    "image": serde_json::Value::Null,
                    "domain": domain,
                }))
                .into_response()
            }
        };

        // Read up to 512KB of body
        let body = match response.bytes().await {
            Ok(b) => {
                let limit = 512 * 1024;
                if b.len() > limit {
                    String::from_utf8_lossy(&b[..limit]).to_string()
                } else {
                    String::from_utf8_lossy(&b).to_string()
                }
            }
            Err(_) => String::new(),
        };

        let title = extract_og_tag(&body, "og:title")
            .or_else(|| extract_html_title(&body));
        let description = extract_og_tag(&body, "og:description");
        let image = extract_og_tag(&body, "og:image");
        (title, description, image)
    };

    let now = chrono::Utc::now().to_rfc3339();

    // Only cache if we got at least some data (avoid caching empty results)
    if title.is_some() || description.is_some() || image.is_some() {
        let _ = sqlx::query(
            r#"INSERT OR REPLACE INTO link_previews (url, title, description, image, domain, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&url)
        .bind(&title)
        .bind(&description)
        .bind(&image)
        .bind(&domain)
        .bind(&now)
        .execute(&state.db)
        .await;
    }

    Json(serde_json::json!({
        "url": url,
        "title": title,
        "description": description,
        "image": image,
        "domain": domain,
    }))
    .into_response()
}

fn extract_og_tag(html: &str, property: &str) -> Option<String> {
    // Match <meta property="og:title" content="..."> or <meta content="..." property="og:title">
    let pattern = format!(
        r#"<meta[^>]*property\s*=\s*["']{property}["'][^>]*content\s*=\s*["']([^"']*)["']"#,
    );
    if let Ok(re) = regex_lite::Regex::new(&pattern) {
        if let Some(caps) = re.captures(html) {
            return caps.get(1).map(|m| html_decode(m.as_str()));
        }
    }

    // Try reversed order: content before property
    let pattern2 = format!(
        r#"<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']{property}["']"#,
    );
    if let Ok(re) = regex_lite::Regex::new(&pattern2) {
        if let Some(caps) = re.captures(html) {
            return caps.get(1).map(|m| html_decode(m.as_str()));
        }
    }

    None
}

fn extract_html_title(html: &str) -> Option<String> {
    let re = regex_lite::Regex::new(r"<title[^>]*>([^<]+)</title>").ok()?;
    re.captures(html)
        .and_then(|caps| caps.get(1))
        .map(|m| html_decode(m.as_str().trim()))
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
}

/// Try oEmbed for YouTube and other supported providers.
/// Returns (title, description, image) if successful.
async fn try_oembed(url: &str) -> Option<(Option<String>, Option<String>, Option<String>)> {
    let oembed_url = if url.contains("youtube.com/watch") || url.contains("youtu.be/") || url.contains("youtube.com/shorts/") {
        format!("https://www.youtube.com/oembed?url={}&format=json", urlencoding::encode(url))
    } else {
        return None;
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .unwrap_or_default();

    let resp = client.get(&oembed_url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }

    let json: serde_json::Value = resp.json().await.ok()?;

    let title = json.get("title").and_then(|v| v.as_str()).map(|s| s.to_string());
    let author = json.get("author_name").and_then(|v| v.as_str()).map(|s| s.to_string());
    let thumbnail = json.get("thumbnail_url").and_then(|v| v.as_str()).map(|s| s.to_string());

    Some((title, author, thumbnail))
}
