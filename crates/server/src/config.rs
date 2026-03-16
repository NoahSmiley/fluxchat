use std::env;

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_path: String,
    pub auth_secret: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    pub livekit_url: String,
    pub livekit_cloud_api_key: Option<String>,
    pub livekit_cloud_api_secret: Option<String>,
    pub livekit_cloud_url: Option<String>,
    pub upload_dir: String,
    pub max_upload_bytes: u64,
    pub room_cleanup_delay_secs: u64,
    pub athion_url: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3001),
            database_path: env::var("DATABASE_PATH").unwrap_or_else(|_| "./flux.db".into()),
            auth_secret: env::var("BETTER_AUTH_SECRET")
                .expect("BETTER_AUTH_SECRET must be set"),
            livekit_api_key: env::var("LIVEKIT_API_KEY").unwrap_or_default(),
            livekit_api_secret: env::var("LIVEKIT_API_SECRET").unwrap_or_default(),
            livekit_url: env::var("LIVEKIT_URL")
                .unwrap_or_else(|_| "ws://localhost:7880".into()),
            livekit_cloud_api_key: env::var("LIVEKIT_CLOUD_API_KEY").ok().filter(|s| !s.is_empty()),
            livekit_cloud_api_secret: env::var("LIVEKIT_CLOUD_API_SECRET").ok().filter(|s| !s.is_empty()),
            livekit_cloud_url: env::var("LIVEKIT_CLOUD_URL").ok().filter(|s| !s.is_empty()),
            upload_dir: env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()),
            max_upload_bytes: env::var("MAX_UPLOAD_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1_073_741_824), // 1GB
            room_cleanup_delay_secs: env::var("ROOM_CLEANUP_DELAY_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(120),
            athion_url: env::var("ATHION_URL")
                .unwrap_or_else(|_| "https://www.athion.me".into()),
        }
    }

    /// Returns true when both cloud AND self-hosted LiveKit credentials are configured.
    /// Audio goes through cloud (Krisp), screen share stays on self-hosted.
    pub fn is_hybrid_livekit(&self) -> bool {
        self.livekit_cloud_api_key.is_some()
            && self.livekit_cloud_api_secret.is_some()
            && self.livekit_cloud_url.is_some()
            && !self.livekit_api_key.is_empty()
            && !self.livekit_api_secret.is_empty()
    }

    /// Returns (api_key, api_secret, url) — cloud credentials if all three are set, otherwise self-hosted.
    pub fn effective_livekit(&self) -> (&str, &str, &str) {
        match (&self.livekit_cloud_api_key, &self.livekit_cloud_api_secret, &self.livekit_cloud_url) {
            (Some(key), Some(secret), Some(url)) => (key, secret, url),
            _ => (&self.livekit_api_key, &self.livekit_api_secret, &self.livekit_url),
        }
    }
}
