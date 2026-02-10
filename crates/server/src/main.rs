mod config;
mod db;
mod middleware;
mod models;
mod routes;
mod ws;

use config::Config;
use std::sync::Arc;
use tokio::net::TcpListener;
use axum::http::{HeaderName, Method};
use tower_http::cors::CorsLayer;

pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub config: Config,
    pub gateway: Arc<ws::gateway::GatewayState>,
}

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

    // Initialize database
    let pool = db::init_pool(&config.database_path)
        .await
        .expect("Failed to initialize database");

    let state = Arc::new(AppState {
        db: pool,
        config: config.clone(),
        gateway: Arc::new(ws::gateway::GatewayState::new()),
    });

    // Build router
    let app = routes::build_router(state.clone())
        .layer(
            CorsLayer::new()
                .allow_origin(tower_http::cors::AllowOrigin::mirror_request())
                .allow_methods([
                    Method::GET,
                    Method::POST,
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
