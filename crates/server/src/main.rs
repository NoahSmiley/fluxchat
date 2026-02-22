use flux_server::{config::Config, db, routes, ws, AppState};
use std::sync::Arc;
use tokio::net::TcpListener;
use axum::http::{HeaderName, Method};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    // Load .env if present
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "flux_server=info".into()),
        )
        .init();

    let config = Config::from_env();

    // Create upload directory
    tokio::fs::create_dir_all(&config.upload_dir)
        .await
        .expect("Failed to create upload directory");

    // Initialize database
    let pool = db::init_pool(&config.database_path)
        .await
        .expect("Failed to initialize database");

    let state = Arc::new(AppState {
        db: pool,
        config: config.clone(),
        gateway: Arc::new(ws::gateway::GatewayState::new()),
        spotify_auth_pending: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        youtube_url_cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
    });

    // Clean up stale non-persistent rooms from previous server sessions
    // (in-memory cleanup timers are lost on restart, so empty temp rooms linger in the DB)
    let cleaned = sqlx::query("DELETE FROM channels WHERE is_room = 1 AND is_persistent = 0")
        .execute(&state.db)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    if cleaned > 0 {
        tracing::info!("Cleaned up {} stale temporary room(s)", cleaned);
    }

    // Check for yt-dlp
    match tokio::process::Command::new("yt-dlp").arg("--version").output().await {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout);
            tracing::info!("yt-dlp found: {}", version.trim());
        }
        _ => {
            tracing::warn!("yt-dlp not found on PATH — YouTube audio features will be unavailable");
        }
    }

    // Build router
    let app = routes::build_router(state.clone())
        .layer(
            CorsLayer::new()
                .allow_origin(tower_http::cors::AllowOrigin::mirror_request())
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::PATCH,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers([
                    HeaderName::from_static("content-type"),
                    HeaderName::from_static("cookie"),
                    HeaderName::from_static("authorization"),
                ])
                .allow_credentials(true),
        );

    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind");

    tracing::info!("Flux server running on {}", addr);

    axum::serve(listener, app)
        .await
        .expect("Server error");
}
