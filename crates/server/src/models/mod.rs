mod message;
mod server;
mod user;

pub use message::*;
pub use server::*;
pub use user::*;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub username: String,
}

// Spotify
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyCallbackRequest {
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyAccountInfo {
    pub linked: bool,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSession {
    pub id: String,
    pub voice_channel_id: String,
    pub host_user_id: String,
    pub current_track_uri: Option<String>,
    pub current_track_position_ms: i64,
    pub is_playing: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub session_id: String,
    pub track_uri: String,
    pub track_name: String,
    pub track_artist: String,
    pub track_album: Option<String>,
    pub track_image_url: Option<String>,
    pub track_duration_ms: i64,
    pub added_by_user_id: String,
    pub position: i64,
    pub created_at: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToQueueRequest {
    pub track_uri: String,
    pub track_name: String,
    pub track_artist: String,
    pub track_album: Option<String>,
    pub track_image_url: Option<String>,
    pub track_duration_ms: i64,
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "spotify".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub domain: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhitelistEntry {
    pub id: String,
    pub email: String,
    pub added_by: String,
    pub added_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddWhitelistRequest {
    pub emails: Vec<String>,
}
