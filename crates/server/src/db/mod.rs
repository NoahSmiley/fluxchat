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

    tracing::info!("Database initialized at {}", database_path);
    Ok(pool)
}
