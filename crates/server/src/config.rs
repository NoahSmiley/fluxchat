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
    pub upload_dir: String,
    pub max_upload_bytes: u64,
    pub room_cleanup_delay_secs: u64,
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
            upload_dir: env::var("UPLOAD_DIR").unwrap_or_else(|_| "./uploads".into()),
            max_upload_bytes: env::var("MAX_UPLOAD_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1_073_741_824), // 1GB
            room_cleanup_delay_secs: env::var("ROOM_CLEANUP_DELAY_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(120),
        }
    }
}
