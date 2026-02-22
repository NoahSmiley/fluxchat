use axum::Router;
use flux_server::{config::Config, routes, ws, AppState};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::sync::Arc;

/// Create an in-memory SQLite pool with schema applied.
pub async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("Failed to create in-memory SQLite pool");

    // Enable foreign keys
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .unwrap();

    // Run schema
    let schema = include_str!("../../src/db/schema.sql");
    for statement in schema.split(';') {
        let trimmed = statement.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(&pool).await.unwrap();
        }
    }

    // Run essential migrations (columns added by db::init_pool)
    let migrations = [
        r#"ALTER TABLE "user" ADD COLUMN public_key TEXT"#,
        r#"ALTER TABLE "user" ADD COLUMN ring_style TEXT NOT NULL DEFAULT 'default'"#,
        r#"ALTER TABLE "user" ADD COLUMN ring_spin INTEGER NOT NULL DEFAULT 0"#,
        r#"ALTER TABLE "user" ADD COLUMN ring_pattern_seed INTEGER"#,
        r#"ALTER TABLE "user" ADD COLUMN banner_css TEXT"#,
        r#"ALTER TABLE "user" ADD COLUMN banner_pattern_seed INTEGER"#,
        r#"ALTER TABLE "user" ADD COLUMN steam_id TEXT"#,
        r#"ALTER TABLE "user" ADD COLUMN status TEXT NOT NULL DEFAULT 'online'"#,
        r#"ALTER TABLE "inventory" ADD COLUMN pattern_seed INTEGER"#,
        r#"ALTER TABLE "channels" ADD COLUMN is_room INTEGER NOT NULL DEFAULT 0"#,
        r#"ALTER TABLE "channels" ADD COLUMN is_persistent INTEGER NOT NULL DEFAULT 0"#,
        r#"ALTER TABLE "channels" ADD COLUMN creator_id TEXT"#,
        r#"ALTER TABLE "channels" ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0"#,
    ];

    for migration in &migrations {
        sqlx::query(migration).execute(&pool).await.ok();
    }

    // Create listening_sessions and session_queue tables (from db/mod.rs migrations)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "listening_sessions" (
            id TEXT PRIMARY KEY,
            voice_channel_id TEXT NOT NULL,
            host_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            current_track_uri TEXT,
            current_track_position_ms INTEGER DEFAULT 0,
            is_playing INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "session_queue" (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES "listening_sessions"(id) ON DELETE CASCADE,
            track_uri TEXT NOT NULL,
            track_name TEXT NOT NULL,
            track_artist TEXT NOT NULL,
            track_album TEXT,
            track_image_url TEXT,
            track_duration_ms INTEGER NOT NULL,
            added_by_user_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'spotify'
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    // Create unique index for account upsert
    sqlx::query(r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_account_user_provider ON "account"(userId, providerId)"#)
        .execute(&pool)
        .await
        .ok();

    pool
}

/// Build a test Axum app with the given pool.
pub fn create_test_app(pool: SqlitePool) -> Router {
    let state = Arc::new(AppState {
        db: pool,
        config: Config {
            host: "127.0.0.1".into(),
            port: 0,
            database_path: ":memory:".into(),
            auth_secret: "test-secret".into(),
            livekit_api_key: "".into(),
            livekit_api_secret: "".into(),
            livekit_url: "ws://localhost:7880".into(),
            upload_dir: "/tmp/flux-test-uploads".into(),
            max_upload_bytes: 10_485_760,
        },
        gateway: Arc::new(ws::gateway::GatewayState::new()),
        spotify_auth_pending: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        youtube_url_cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
    });

    routes::build_router(state)
}

/// Create a test user directly in the database. Returns (user_id, session_token).
pub async fn create_test_user(
    pool: &SqlitePool,
    email: &str,
    username: &str,
    password: &str,
) -> (String, String) {
    let user_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Insert user
    sqlx::query(
        r#"INSERT INTO "user" (id, name, username, email, emailVerified, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, 0, ?, ?)"#,
    )
    .bind(&user_id)
    .bind(username)
    .bind(username)
    .bind(email)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();

    // Hash password and insert account
    let salt = argon2::password_hash::SaltString::generate(&mut rand::rngs::OsRng);
    let password_hash = argon2::Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .unwrap()
        .to_string();

    let account_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO "account" (id, userId, accountId, providerId, password, createdAt, updatedAt)
           VALUES (?, ?, ?, 'credential', ?, ?, ?)"#,
    )
    .bind(&account_id)
    .bind(&user_id)
    .bind(&user_id)
    .bind(&password_hash)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();

    // Create session
    let session_token = uuid::Uuid::new_v4().to_string();
    let session_id = uuid::Uuid::new_v4().to_string();
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();

    sqlx::query(
        r#"INSERT INTO "session" (id, userId, token, expiresAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&session_id)
    .bind(&user_id)
    .bind(&session_token)
    .bind(&expires_at)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();

    (user_id, session_token)
}

/// Seed the economy data (item catalog, cases, case_items) for testing.
pub async fn seed_economy(pool: &SqlitePool) {
    let now = chrono::Utc::now().to_rfc3339();

    // Insert a few catalog items
    let items = [
        ("item_badge_star", "Star Badge", "chat_badge", "common", "star"),
        ("item_name_fire", "Fire Name", "name_color", "uncommon", "linear-gradient(90deg, #ff4500, #ff8c00)"),
        ("item_ring_doppler", "Doppler Ring", "ring_style", "legendary", "doppler"),
        ("item_banner_sunset", "Sunset Banner", "profile_banner", "uncommon", "sunset"),
    ];

    for (id, name, item_type, rarity, css) in &items {
        sqlx::query(
            "INSERT INTO item_catalog (id, name, description, item_type, rarity, preview_css, tradeable, created_at) VALUES (?, ?, 'Test item', ?, ?, ?, 1, ?)",
        )
        .bind(id).bind(name).bind(item_type).bind(rarity).bind(css).bind(&now)
        .execute(pool)
        .await
        .unwrap();
    }

    // Insert a test case
    sqlx::query(
        "INSERT INTO cases (id, name, description, cost_coins, is_active, created_at) VALUES ('case_test', 'Test Case', 'A test case', 50, 1, ?)",
    )
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();

    // Insert case items (loot table)
    let case_items = [
        ("item_badge_star", 200),
        ("item_name_fire", 150),
        ("item_ring_doppler", 40),
        ("item_banner_sunset", 100),
    ];

    for (item_id, weight) in &case_items {
        let ci_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO case_items (id, case_id, item_id, weight) VALUES (?, 'case_test', ?, ?)",
        )
        .bind(&ci_id).bind(item_id).bind(weight)
        .execute(pool)
        .await
        .unwrap();
    }
}

use argon2::PasswordHasher;

/// Create a test server with owner membership and default channel.
pub async fn create_test_server(pool: &SqlitePool, owner_id: &str, name: &str) -> String {
    let server_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    sqlx::query("INSERT INTO servers (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&server_id).bind(name).bind(owner_id).bind(&uuid::Uuid::new_v4().to_string()).bind(&now)
        .execute(pool).await.unwrap();

    sqlx::query("INSERT INTO memberships (user_id, server_id, role, joined_at, role_updated_at) VALUES (?, ?, 'owner', ?, ?)")
        .bind(owner_id).bind(&server_id).bind(&now).bind(&now)
        .execute(pool).await.unwrap();

    sqlx::query("INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, 'general', 'text', 0, ?)")
        .bind(&uuid::Uuid::new_v4().to_string()).bind(&server_id).bind(&now)
        .execute(pool).await.unwrap();

    server_id
}

/// Create a voice channel in a server.
pub async fn create_voice_channel(pool: &SqlitePool, server_id: &str, name: &str) -> String {
    let channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, ?, 'voice', 99, ?)")
        .bind(&channel_id).bind(server_id).bind(name).bind(&now)
        .execute(pool).await.unwrap();
    channel_id
}

/// Create a text channel in a server.
pub async fn create_text_channel(pool: &SqlitePool, server_id: &str, name: &str) -> String {
    let channel_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO channels (id, server_id, name, type, position, created_at) VALUES (?, ?, ?, 'text', 99, ?)")
        .bind(&channel_id).bind(server_id).bind(name).bind(&now)
        .execute(pool).await.unwrap();
    channel_id
}

/// Add a member to a server with the given role.
pub async fn add_member(pool: &SqlitePool, user_id: &str, server_id: &str, role: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO memberships (user_id, server_id, role, joined_at, role_updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(user_id).bind(server_id).bind(role).bind(&now).bind(&now)
        .execute(pool).await.unwrap();
}

/// Create a test attachment record (no actual file on disk).
pub async fn create_test_attachment(pool: &SqlitePool, uploader_id: &str, filename: &str, content_type: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO attachments (id, message_id, uploader_id, filename, content_type, size, created_at) VALUES (?, NULL, ?, ?, ?, 1024, ?)")
        .bind(&id).bind(uploader_id).bind(filename).bind(content_type).bind(&now)
        .execute(pool).await.unwrap();
    id
}

/// Link a Spotify account for a user.
pub async fn link_spotify_account(pool: &SqlitePool, user_id: &str, display_name: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let expires = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
    let account_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO "account" (id, userId, accountId, providerId, accessToken, refreshToken, accessTokenExpiresAt, scope, createdAt, updatedAt)
           VALUES (?, ?, ?, 'spotify', 'test-access-token', 'test-refresh-token', ?, 'streaming', ?, ?)"#
    )
    .bind(&account_id).bind(user_id).bind(display_name).bind(&expires).bind(&now).bind(&now)
    .execute(pool).await.unwrap();
}
