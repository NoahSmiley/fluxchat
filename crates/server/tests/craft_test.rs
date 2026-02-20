mod common;

use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum_test::TestServer;
use serde_json::json;

fn auth_header(token: &str) -> (HeaderName, HeaderValue) {
    (
        HeaderName::from_static("authorization"),
        format!("Bearer {}", token).parse().unwrap(),
    )
}

async fn setup() -> (TestServer, sqlx::SqlitePool, String, String) {
    let pool = common::setup_test_db().await;
    common::seed_economy(&pool).await;
    let app = common::create_test_app(pool.clone());
    let server = TestServer::new(app).unwrap();
    let (user_id, token) =
        common::create_test_user(&pool, "alice@test.com", "alice", "pass123").await;
    (server, pool, user_id, token)
}

/// Insert N inventory items of a given catalog item for a user, returning the inventory IDs.
async fn give_items(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    item_id: &str,
    count: usize,
) -> Vec<String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut ids = Vec::new();
    for _ in 0..count {
        let inv_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO inventory (id, user_id, item_id, equipped, obtained_from, obtained_at) VALUES (?, ?, ?, 0, 'test', ?)",
        )
        .bind(&inv_id)
        .bind(user_id)
        .bind(item_id)
        .bind(&now)
        .execute(pool)
        .await
        .unwrap();
        ids.push(inv_id);
    }
    ids
}

#[tokio::test]
async fn craft_5_common_produces_uncommon() {
    let (server, pool, user_id, token) = setup().await;

    // Give user 5 common items (item_badge_star is common)
    let inv_ids = give_items(&pool, &user_id, "item_badge_star", 5).await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": inv_ids }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["rarity"], "uncommon");
    assert!(body["id"].as_str().is_some());
    assert_eq!(body["acquiredVia"], "crafted");
}

#[tokio::test]
async fn craft_wrong_count_returns_400() {
    let (server, pool, user_id, token) = setup().await;

    let inv_ids = give_items(&pool, &user_id, "item_badge_star", 3).await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": inv_ids }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Exactly 5 items are required for crafting");
}

#[tokio::test]
async fn craft_duplicate_items_returns_400() {
    let (server, pool, user_id, token) = setup().await;

    let inv_ids = give_items(&pool, &user_id, "item_badge_star", 1).await;
    let dup_id = inv_ids[0].clone();
    let five_dupes = vec![dup_id.clone(), dup_id.clone(), dup_id.clone(), dup_id.clone(), dup_id];

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": five_dupes }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "All 5 items must be different");
}

#[tokio::test]
async fn craft_mixed_rarity_returns_400() {
    let (server, pool, user_id, token) = setup().await;

    // 4 common + 1 uncommon
    let mut inv_ids = give_items(&pool, &user_id, "item_badge_star", 4).await;
    let uncommon_ids = give_items(&pool, &user_id, "item_name_fire", 1).await;
    inv_ids.push(uncommon_ids[0].clone());

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": inv_ids }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "All 5 items must be the same rarity");
}

#[tokio::test]
async fn craft_not_owned_returns_403() {
    let (server, pool, _user_id, _token) = setup().await;

    // Create a different user and give items to them
    let (other_id, _other_token) =
        common::create_test_user(&pool, "other@test.com", "other", "pass123").await;
    let inv_ids = give_items(&pool, &other_id, "item_badge_star", 5).await;

    // First user tries to craft with other user's items
    let (first_id, first_token) =
        common::create_test_user(&pool, "crafter@test.com", "crafter", "pass123").await;
    let _ = first_id;

    let (h, v) = auth_header(&first_token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": inv_ids }))
        .await;

    res.assert_status(StatusCode::FORBIDDEN);
    let body: serde_json::Value = res.json();
    assert!(body["error"].as_str().unwrap().contains("do not own"));
}

#[tokio::test]
async fn craft_nonexistent_item_returns_404() {
    let (server, _pool, _user_id, token) = setup().await;

    let fake_ids: Vec<String> = (0..5).map(|_| uuid::Uuid::new_v4().to_string()).collect();

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": fake_ids }))
        .await;

    res.assert_status(StatusCode::NOT_FOUND);
    let body: serde_json::Value = res.json();
    assert!(body["error"].as_str().unwrap().contains("not found"));
}

#[tokio::test]
async fn craft_max_rarity_returns_400() {
    let (server, pool, user_id, token) = setup().await;

    let now = chrono::Utc::now().to_rfc3339();

    // Add an ultra_rare catalog item (none exist by default)
    sqlx::query(
        "INSERT INTO item_catalog (id, name, description, item_type, rarity, tradeable, created_at) VALUES ('item_ultra', 'Ultra Item', 'Test', 'chat_badge', 'ultra_rare', 1, ?)",
    )
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Give user 5 ultra_rare inventory items
    let inv_ids = give_items(&pool, &user_id, "item_ultra", 5).await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": inv_ids }))
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(
        body["error"],
        "Items are already at the highest rarity tier"
    );
}

#[tokio::test]
async fn craft_verifies_items_deleted() {
    let (server, pool, user_id, token) = setup().await;

    let inv_ids = give_items(&pool, &user_id, "item_badge_star", 5).await;

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/craft")
        .add_header(h, v)
        .json(&json!({ "inventoryIds": inv_ids }))
        .await;

    res.assert_status_ok();

    // Verify the original 5 items are gone
    for inv_id in &inv_ids {
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM inventory WHERE id = ?",
        )
        .bind(inv_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "Item {} should have been deleted", inv_id);
    }

    // Verify user now has exactly 1 item (the crafted result)
    let total = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM inventory WHERE user_id = ?",
    )
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(total, 1);
}
