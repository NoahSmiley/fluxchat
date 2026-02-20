pub mod config;
pub mod db;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod ws;

use config::Config;
use std::sync::Arc;

pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub config: Config,
    pub gateway: Arc<ws::gateway::GatewayState>,
    pub spotify_auth_pending: tokio::sync::RwLock<std::collections::HashMap<String, (String, String)>>,
    pub youtube_url_cache: tokio::sync::RwLock<std::collections::HashMap<String, (String, std::time::Instant)>>,
}
