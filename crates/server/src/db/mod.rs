use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::path::Path;

pub async fn init_pool(database_path: &str) -> Result<SqlitePool, sqlx::Error> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(database_path).parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let database_url = format!("sqlite:{}?mode=rwc", database_path);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Enable WAL mode and foreign keys
    sqlx::query("PRAGMA journal_mode = WAL")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await?;

    // Run schema
    let schema = include_str!("schema.sql");

    // Split by semicolons and execute each statement
    // (SQLx doesn't support multi-statement queries directly)
    for statement in schema.split(';') {
        let trimmed = statement.trim();
        if !trimmed.is_empty() {
            sqlx::query(trimmed).execute(&pool).await?;
        }
    }

    // Migrations: add columns that may not exist in older databases
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN public_key TEXT"#)
        .execute(&pool)
        .await
        .ok();

    // Ring style + spin preferences
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN ring_style TEXT NOT NULL DEFAULT 'default'"#)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN ring_spin INTEGER NOT NULL DEFAULT 0"#)
        .execute(&pool)
        .await
        .ok();

    // Unique index for account upsert (userId + providerId)
    sqlx::query(r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_account_user_provider ON "account"(userId, providerId)"#)
        .execute(&pool)
        .await
        .ok();

    // Spotify: listening sessions
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

    // Spotify: queue items per session
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
            created_at TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    // Migration: add role_updated_at to memberships
    sqlx::query(r#"ALTER TABLE "memberships" ADD COLUMN role_updated_at TEXT"#)
        .execute(&pool)
        .await
        .ok();

    // Migration: add steam_id to users
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN steam_id TEXT"#)
        .execute(&pool)
        .await
        .ok();

    // Migration: create email_whitelist table
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "email_whitelist" (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            added_by TEXT NOT NULL REFERENCES "user"(id),
            added_at TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    tracing::info!("Database initialized at {}", database_path);
    Ok(pool)
}
