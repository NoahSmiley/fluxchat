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

    // Migration: rename messages.ciphertext → content (old E2EE schema)
    sqlx::query(r#"ALTER TABLE "messages" RENAME COLUMN ciphertext TO content"#)
        .execute(&pool)
        .await
        .ok();
    // Also rename dm_messages.ciphertext if it was already named that
    sqlx::query(r#"ALTER TABLE "dm_messages" RENAME COLUMN plaintext TO ciphertext"#)
        .execute(&pool)
        .await
        .ok();

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
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN ring_pattern_seed INTEGER"#)
        .execute(&pool)
        .await
        .ok();

    // Banner preferences (equipped banner)
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN banner_css TEXT"#)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN banner_pattern_seed INTEGER"#)
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

    // Migration: add source column to session_queue
    sqlx::query(
        r#"ALTER TABLE "session_queue" ADD COLUMN source TEXT NOT NULL DEFAULT 'spotify'"#,
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

    // Migration: add parent_id and position to channels (tree hierarchy)
    sqlx::query(r#"ALTER TABLE "channels" ADD COLUMN parent_id TEXT REFERENCES "channels"(id) ON DELETE CASCADE"#)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(r#"ALTER TABLE "channels" ADD COLUMN position INTEGER NOT NULL DEFAULT 0"#)
        .execute(&pool)
        .await
        .ok();

    // Migration: economy tables
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "wallet" (
            user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
            coins INTEGER NOT NULL DEFAULT 0,
            lifetime_earned INTEGER NOT NULL DEFAULT 0
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "item_catalog" (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            item_type TEXT NOT NULL,
            rarity TEXT NOT NULL,
            image_url TEXT,
            preview_css TEXT,
            card_series TEXT,
            card_number TEXT,
            is_holographic INTEGER NOT NULL DEFAULT 0,
            tradeable INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "cases" (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            image_url TEXT,
            cost_coins INTEGER NOT NULL DEFAULT 100,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "case_items" (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES "cases"(id) ON DELETE CASCADE,
            item_id TEXT NOT NULL REFERENCES "item_catalog"(id) ON DELETE CASCADE,
            weight INTEGER NOT NULL DEFAULT 100
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_case_items_case ON case_items(case_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "inventory" (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            item_id TEXT NOT NULL REFERENCES "item_catalog"(id) ON DELETE CASCADE,
            equipped INTEGER NOT NULL DEFAULT 0,
            obtained_from TEXT,
            obtained_at TEXT NOT NULL,
            source_case_id TEXT REFERENCES "cases"(id)
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_inventory_item ON inventory(item_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "trades" (
            id TEXT PRIMARY KEY,
            sender_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            receiver_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            sender_coins INTEGER NOT NULL DEFAULT 0,
            receiver_coins INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            message TEXT,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            resolved_at TEXT
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_trades_sender ON trades(sender_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_trades_receiver ON trades(receiver_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "trade_items" (
            id TEXT PRIMARY KEY,
            trade_id TEXT NOT NULL REFERENCES "trades"(id) ON DELETE CASCADE,
            inventory_id TEXT NOT NULL REFERENCES "inventory"(id),
            side TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_trade_items_trade ON trade_items(trade_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "marketplace_listings" (
            id TEXT PRIMARY KEY,
            seller_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            inventory_id TEXT NOT NULL REFERENCES "inventory"(id),
            price_coins INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            sold_at TEXT,
            buyer_id TEXT REFERENCES "user"(id)
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_marketplace_seller ON marketplace_listings(seller_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_marketplace_status ON marketplace_listings(status)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_marketplace_buyer ON marketplace_listings(buyer_id)"#)
        .execute(&pool)
        .await
        .ok();

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS "coin_rewards_log" (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            amount INTEGER NOT NULL,
            reason TEXT,
            created_at TEXT NOT NULL
        )"#,
    )
    .execute(&pool)
    .await
    .ok();

    sqlx::query(r#"CREATE INDEX IF NOT EXISTS idx_coin_rewards_user_time ON coin_rewards_log(user_id, created_at)"#)
        .execute(&pool)
        .await
        .ok();

    // Migration: add item_catalog visual columns (may already exist from schema)
    sqlx::query(r#"ALTER TABLE "item_catalog" ADD COLUMN preview_css TEXT"#)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(r#"ALTER TABLE "item_catalog" ADD COLUMN card_series TEXT"#)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(r#"ALTER TABLE "item_catalog" ADD COLUMN card_number TEXT"#)
        .execute(&pool)
        .await
        .ok();
    sqlx::query(r#"ALTER TABLE "item_catalog" ADD COLUMN is_holographic INTEGER NOT NULL DEFAULT 0"#)
        .execute(&pool)
        .await
        .ok();

    // Migration: add user status preference (online, idle, dnd, invisible)
    sqlx::query(r#"ALTER TABLE "user" ADD COLUMN status TEXT NOT NULL DEFAULT 'online'"#)
        .execute(&pool)
        .await
        .ok();

    // Migration: add pattern_seed to inventory (for Doppler ring patterns)
    sqlx::query(r#"ALTER TABLE "inventory" ADD COLUMN pattern_seed INTEGER"#)
        .execute(&pool)
        .await
        .ok();

    // Migration: ensure doppler banner catalog items + case loot entries exist
    {
        let now = chrono::Utc::now().to_rfc3339();
        for (id, name, desc, rarity, css) in [
            ("item_banner_doppler", "Doppler Banner", "Metallic purple, blue, and red finish. Rare patterns: Ruby, Sapphire", "legendary", "doppler"),
            ("item_banner_gamma_doppler", "Gamma Doppler Banner", "Metallic green, cyan, and blue finish. Rare patterns: Emerald, Diamond", "legendary", "gamma_doppler"),
            ("item_banner_wyrm_manuscript", "Wyrm Manuscript", "Ancient Celtic dragon illumination on aged parchment", "epic", "wyrm_manuscript"),
        ] {
            sqlx::query("INSERT OR IGNORE INTO item_catalog (id, name, description, item_type, rarity, preview_css, tradeable, created_at) VALUES (?, ?, ?, 'profile_banner', ?, ?, 1, ?)")
                .bind(id).bind(name).bind(desc).bind(rarity).bind(css).bind(&now)
                .execute(&pool).await.ok();
        }
        // Add to case loot tables if missing
        for (case_id, item_id, weight) in [
            ("case_starter", "item_banner_doppler", 40),
            ("case_starter", "item_banner_gamma_doppler", 40),
            ("case_premium", "item_banner_doppler", 60),
            ("case_premium", "item_banner_gamma_doppler", 60),
            ("case_starter", "item_banner_wyrm_manuscript", 50),
            ("case_premium", "item_banner_wyrm_manuscript", 70),
        ] {
            let exists = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM case_items WHERE case_id = ? AND item_id = ?"
            ).bind(case_id).bind(item_id).fetch_one(&pool).await.unwrap_or(0);
            if exists == 0 {
                let ci_id = uuid::Uuid::new_v4().to_string();
                sqlx::query("INSERT INTO case_items (id, case_id, item_id, weight) VALUES (?, ?, ?, ?)")
                    .bind(&ci_id).bind(case_id).bind(item_id).bind(weight)
                    .execute(&pool).await.ok();
            }
        }
    }

    // Seed economy data if item_catalog is empty or missing visual metadata
    let item_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM item_catalog")
        .fetch_one(&pool)
        .await
        .unwrap_or(0);

    let has_visual_data = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM item_catalog WHERE preview_css IS NOT NULL OR card_series IS NOT NULL"
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);

    if item_count == 0 || (item_count > 0 && has_visual_data == 0) {
        // Clear stale data and reseed
        if item_count > 0 {
            tracing::info!("Reseeding economy data (missing visual metadata)...");
            sqlx::query("DELETE FROM case_items").execute(&pool).await.ok();
            sqlx::query("DELETE FROM cases").execute(&pool).await.ok();
            sqlx::query("DELETE FROM item_catalog").execute(&pool).await.ok();
        }
        seed_economy(&pool).await;
    }

    tracing::info!("Database initialized at {}", database_path);
    Ok(pool)
}

async fn seed_economy(pool: &SqlitePool) {
    tracing::info!("Seeding economy data...");
    let now = chrono::Utc::now().to_rfc3339();

    // ── Ring Styles (Doppler finishes) ──
    let ring_items = [
        ("item_ring_doppler", "Doppler Ring", "Metallic purple, blue, and red finish. Rare patterns: Ruby, Sapphire", "ring_style", "legendary", "doppler"),
        ("item_ring_gamma_doppler", "Gamma Doppler Ring", "Metallic green, cyan, and blue finish. Rare patterns: Emerald, Diamond", "ring_style", "legendary", "gamma_doppler"),
    ];

    for (id, name, desc, itype, rarity, css) in &ring_items {
        sqlx::query("INSERT INTO item_catalog (id, name, description, item_type, rarity, preview_css, tradeable, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
            .bind(id).bind(name).bind(desc).bind(itype).bind(rarity).bind(css).bind(&now)
            .execute(pool).await.ok();
    }

    // ── Name Colors ──
    let name_colors = [
        ("item_name_fire", "Fire Name", "Red to orange gradient name", "name_color", "uncommon", "linear-gradient(90deg, #ff4500, #ff8c00)"),
        ("item_name_ice", "Ice Name", "Cool blue gradient name", "name_color", "uncommon", "linear-gradient(90deg, #00d4ff, #b8f0ff)"),
        ("item_name_rainbow", "Rainbow Name", "Full spectrum animated name", "name_color", "epic", "linear-gradient(90deg, #ff0000, #ff8000, #ffff00, #00ff00, #00ffff, #0080ff, #8000ff)"),
        ("item_name_gold", "Golden Name", "Shimmering gold text", "name_color", "rare", "linear-gradient(90deg, #ffd700, #ffed4a, #ffd700)"),
        ("item_name_toxic", "Toxic Name", "Green radioactive glow text", "name_color", "uncommon", "linear-gradient(90deg, #39ff14, #00ff88)"),
        ("item_name_phantom", "Phantom Name", "Ghostly translucent text", "name_color", "legendary", "linear-gradient(90deg, #8b5cf6, #d946ef, #8b5cf6)"),
    ];

    for (id, name, desc, itype, rarity, css) in &name_colors {
        sqlx::query("INSERT INTO item_catalog (id, name, description, item_type, rarity, preview_css, tradeable, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
            .bind(id).bind(name).bind(desc).bind(itype).bind(rarity).bind(css).bind(&now)
            .execute(pool).await.ok();
    }

    // ── Chat Badges ──
    let badges = [
        ("item_badge_diamond", "Diamond Badge", "Sparkling diamond icon", "chat_badge", "legendary", "diamond"),
        ("item_badge_skull", "Skull Badge", "Edgy skull icon", "chat_badge", "rare", "skull"),
        ("item_badge_crown", "Crown Badge", "Royal crown icon", "chat_badge", "epic", "crown"),
        ("item_badge_flame", "Flame Badge", "Fire emoji badge", "chat_badge", "uncommon", "flame"),
        ("item_badge_star", "Star Badge", "Gold star icon", "chat_badge", "common", "star"),
        ("item_badge_bolt", "Lightning Badge", "Electric bolt icon", "chat_badge", "uncommon", "bolt"),
    ];

    for (id, name, desc, itype, rarity, css) in &badges {
        sqlx::query("INSERT INTO item_catalog (id, name, description, item_type, rarity, preview_css, tradeable, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
            .bind(id).bind(name).bind(desc).bind(itype).bind(rarity).bind(css).bind(&now)
            .execute(pool).await.ok();
    }

    // ── Profile Banners ──
    let banners = [
        ("item_banner_sunset", "Sunset Banner", "Warm sunset gradient banner", "profile_banner", "uncommon", "sunset"),
        ("item_banner_aurora", "Aurora Banner", "Northern lights animation", "profile_banner", "epic", "aurora"),
        ("item_banner_cityscape", "Cityscape Banner", "Neon city skyline", "profile_banner", "rare", "cityscape"),
        ("item_banner_space", "Deep Space Banner", "Stars and nebula", "profile_banner", "rare", "space"),
        ("item_banner_doppler", "Doppler Banner", "Metallic purple, blue, and red finish. Rare patterns: Ruby, Sapphire", "profile_banner", "legendary", "doppler"),
        ("item_banner_gamma_doppler", "Gamma Doppler Banner", "Metallic green, cyan, and blue finish. Rare patterns: Emerald, Diamond", "profile_banner", "legendary", "gamma_doppler"),
        ("item_banner_wyrm_manuscript", "Wyrm Manuscript", "Ancient Celtic dragon illumination on aged parchment", "profile_banner", "epic", "wyrm_manuscript"),
    ];

    for (id, name, desc, itype, rarity, css) in &banners {
        sqlx::query("INSERT INTO item_catalog (id, name, description, item_type, rarity, preview_css, tradeable, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
            .bind(id).bind(name).bind(desc).bind(itype).bind(rarity).bind(css).bind(&now)
            .execute(pool).await.ok();
    }

    // ── Message Effects ──
    let effects = [
        ("item_effect_confetti", "Confetti Effect", "Confetti burst when sending messages", "message_effect", "rare", "confetti"),
        ("item_effect_fire", "Fire Effect", "Flames on sent messages", "message_effect", "epic", "fire"),
        ("item_effect_snow", "Snow Effect", "Snowflakes falling on messages", "message_effect", "uncommon", "snow"),
        ("item_effect_sparkle", "Sparkle Effect", "Glitter sparkles on messages", "message_effect", "common", "sparkle"),
    ];

    for (id, name, desc, itype, rarity, css) in &effects {
        sqlx::query("INSERT INTO item_catalog (id, name, description, item_type, rarity, preview_css, tradeable, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
            .bind(id).bind(name).bind(desc).bind(itype).bind(rarity).bind(css).bind(&now)
            .execute(pool).await.ok();
    }

    // ── Trading Cards: Founders Set ──
    let cards = [
        ("item_card_f01", "The Architect", "Founders Set #1 — The one who started it all", "trading_card", "rare", 1, false),
        ("item_card_f02", "The Coder", "Founders Set #2 — Lines of code into the night", "trading_card", "rare", 2, false),
        ("item_card_f03", "The Designer", "Founders Set #3 — Pixel perfect vision", "trading_card", "rare", 3, false),
        ("item_card_f04", "The Night Owl", "Founders Set #4 — 3 AM debugging sessions", "trading_card", "uncommon", 4, false),
        ("item_card_f05", "The First User", "Founders Set #5 — The brave early adopter", "trading_card", "uncommon", 5, false),
        ("item_card_f06", "The Bug Hunter", "Founders Set #6 — Found them all", "trading_card", "epic", 6, false),
        ("item_card_f07", "The Flux Logo", "Founders Set #7 — The iconic symbol", "trading_card", "legendary", 7, false),
        ("item_card_f08", "Server Zero", "Founders Set #8 — The first server ever created", "trading_card", "epic", 8, false),
        ("item_card_f09", "The Voice Call", "Founders Set #9 — First voice connection", "trading_card", "uncommon", 9, false),
        ("item_card_f10", "The Parlor", "Founders Set #10 — Where it all began", "trading_card", "ultra_rare", 10, false),
        ("item_card_f01_holo", "The Architect (Holo)", "Founders Set #1 — Holographic variant", "trading_card", "ultra_rare", 1, true),
        ("item_card_f07_holo", "The Flux Logo (Holo)", "Founders Set #7 — Holographic variant", "trading_card", "ultra_rare", 7, true),
    ];

    for (id, name, desc, itype, rarity, card_num, is_holo) in &cards {
        sqlx::query("INSERT INTO item_catalog (id, name, description, item_type, rarity, card_series, card_number, is_holographic, tradeable, created_at) VALUES (?, ?, ?, ?, ?, 'founders', ?, ?, 1, ?)")
            .bind(id).bind(name).bind(desc).bind(itype).bind(rarity).bind(card_num.to_string()).bind(*is_holo as i64).bind(&now)
            .execute(pool).await.ok();
    }

    // ── Cases ──
    let cases = [
        ("case_starter", "Starter Case", "A mix of common cosmetics to get you started", 50),
        ("case_premium", "Premium Case", "Higher chance of rare and epic items", 200),
        ("case_founders", "Founders Case", "Exclusive Founders Set trading cards", 150),
    ];

    for (id, name, desc, cost) in &cases {
        sqlx::query("INSERT INTO cases (id, name, description, cost_coins, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)")
            .bind(id).bind(name).bind(desc).bind(cost).bind(&now)
            .execute(pool).await.ok();
    }

    // ── Case Items (loot tables with weights) ──
    // Starter Case: mostly common/uncommon, some rare
    let starter_items = [
        ("item_name_fire", 150), ("item_name_ice", 150), ("item_name_toxic", 120),
        ("item_badge_star", 200), ("item_badge_flame", 150), ("item_badge_bolt", 150),
        ("item_effect_sparkle", 200), ("item_effect_snow", 150),
        ("item_ring_doppler", 40), ("item_ring_gamma_doppler", 40),
        ("item_badge_skull", 60), ("item_name_gold", 60),
        ("item_banner_sunset", 100),
        ("item_banner_doppler", 40), ("item_banner_gamma_doppler", 40),
        ("item_banner_wyrm_manuscript", 50),
    ];

    for (item_id, weight) in &starter_items {
        let ci_id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO case_items (id, case_id, item_id, weight) VALUES (?, 'case_starter', ?, ?)")
            .bind(&ci_id).bind(item_id).bind(weight)
            .execute(pool).await.ok();
    }

    // Premium Case: skewed toward rare+, includes epic/legendary
    let premium_items = [
        ("item_ring_doppler", 80), ("item_ring_gamma_doppler", 80),
        ("item_name_gold", 120), ("item_badge_skull", 120),
        ("item_banner_cityscape", 100), ("item_banner_space", 100),
        ("item_effect_confetti", 100),
        ("item_name_rainbow", 50), ("item_badge_crown", 50),
        ("item_banner_aurora", 40), ("item_effect_fire", 40),
        ("item_badge_diamond", 20), ("item_name_phantom", 20),
        ("item_banner_doppler", 60), ("item_banner_gamma_doppler", 60),
        ("item_banner_wyrm_manuscript", 70),
    ];

    for (item_id, weight) in &premium_items {
        let ci_id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO case_items (id, case_id, item_id, weight) VALUES (?, 'case_premium', ?, ?)")
            .bind(&ci_id).bind(item_id).bind(weight)
            .execute(pool).await.ok();
    }

    // Founders Case: trading cards only
    let founders_items = [
        ("item_card_f04", 200), ("item_card_f05", 200), ("item_card_f09", 200),
        ("item_card_f01", 100), ("item_card_f02", 100), ("item_card_f03", 100),
        ("item_card_f06", 50), ("item_card_f08", 50),
        ("item_card_f07", 20),
        ("item_card_f10", 10),
        ("item_card_f01_holo", 5), ("item_card_f07_holo", 5),
    ];

    for (item_id, weight) in &founders_items {
        let ci_id = uuid::Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO case_items (id, case_id, item_id, weight) VALUES (?, 'case_founders', ?, ?)")
            .bind(&ci_id).bind(item_id).bind(weight)
            .execute(pool).await.ok();
    }

    tracing::info!("Economy seeded: {} items, {} cases", ring_items.len() + name_colors.len() + badges.len() + banners.len() + effects.len() + cards.len(), cases.len());
}
