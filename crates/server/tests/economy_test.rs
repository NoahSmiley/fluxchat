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

#[tokio::test]
async fn get_wallet_creates_with_starting_balance() {
    let (server, _pool, _user_id, token) = setup().await;

    let (h, v) = auth_header(&token);
    let res = server.get("/api/economy/wallet").add_header(h, v).await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["balance"], 100); // starting balance
    assert_eq!(body["lifetimeEarned"], 100);
}

#[tokio::test]
async fn get_wallet_returns_existing() {
    let (server, pool, user_id, token) = setup().await;

    // Pre-create wallet
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 500, 500)")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (h, v) = auth_header(&token);
    let res = server.get("/api/economy/wallet").add_header(h, v).await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["balance"], 500);
}

#[tokio::test]
async fn grant_coins_updates_balance() {
    let (server, pool, user_id, token) = setup().await;

    // Create wallet first
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 100, 100)")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/economy/grant")
        .add_header(h, v)
        .json(&json!({ "amount": 500 }))
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["granted"], 500);
    assert_eq!(body["newBalance"], 600);
}

#[tokio::test]
async fn list_cases() {
    let (server, _pool, _user_id, token) = setup().await;

    let (h, v) = auth_header(&token);
    let res = server.get("/api/cases").add_header(h, v).await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert!(!body.is_empty());
    assert_eq!(body[0]["name"], "Test Case");
}

#[tokio::test]
async fn get_case_detail_with_loot_table() {
    let (server, _pool, _user_id, token) = setup().await;

    let (h, v) = auth_header(&token);
    let res = server.get("/api/cases/case_test").add_header(h, v).await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["name"], "Test Case");
    assert_eq!(body["price"], 50);
    let items = body["items"].as_array().unwrap();
    assert_eq!(items.len(), 4);
}

#[tokio::test]
async fn open_case_deducts_coins_and_adds_item() {
    let (server, pool, user_id, token) = setup().await;

    // Give user enough coins
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 200, 200)")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/cases/case_test/open")
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["newBalance"], 150); // 200 - 50
    assert!(body["name"].as_str().is_some());
    assert!(body["rarity"].as_str().is_some());

    // Verify inventory has 1 item
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM inventory WHERE user_id = ?",
    )
    .bind(&user_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn open_case_insufficient_coins() {
    let (server, pool, user_id, token) = setup().await;

    // Give user fewer coins than case costs
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 10, 10)")
        .bind(&user_id)
        .execute(&pool)
        .await
        .unwrap();

    let (h, v) = auth_header(&token);
    let res = server
        .post("/api/cases/case_test/open")
        .add_header(h, v)
        .await;

    res.assert_status(StatusCode::BAD_REQUEST);
    let body: serde_json::Value = res.json();
    assert_eq!(body["error"], "Insufficient coins");
}

#[tokio::test]
async fn get_inventory() {
    let (server, pool, user_id, token) = setup().await;

    // Add an item to inventory
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO inventory (id, user_id, item_id, obtained_from, equipped, obtained_at) VALUES (?, ?, 'item_badge_star', 'test', 0, ?)",
    )
    .bind(&uuid::Uuid::new_v4().to_string())
    .bind(&user_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let (h, v) = auth_header(&token);
    let res = server.get("/api/inventory").add_header(h, v).await;

    res.assert_status_ok();
    let body: Vec<serde_json::Value> = res.json();
    assert_eq!(body.len(), 1);
    assert_eq!(body[0]["name"], "Star Badge");
}

#[tokio::test]
async fn equip_unequip_item() {
    let (server, pool, user_id, token) = setup().await;

    let inv_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO inventory (id, user_id, item_id, obtained_from, equipped, obtained_at) VALUES (?, ?, 'item_badge_star', 'test', 0, ?)",
    )
    .bind(&inv_id)
    .bind(&user_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Equip
    let (h, v) = auth_header(&token);
    let res = server
        .patch(&format!("/api/inventory/{}", inv_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["equipped"], true);

    // Unequip
    let (h, v) = auth_header(&token);
    let res = server
        .patch(&format!("/api/inventory/{}", inv_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["equipped"], false);
}

#[tokio::test]
async fn create_and_accept_trade() {
    let (server, pool, user1_id, user1_token) = setup().await;

    let (user2_id, user2_token) =
        common::create_test_user(&pool, "bob@test.com", "bob", "pass123").await;

    // Give both users wallets and items
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 500, 500)")
        .bind(&user1_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 500, 500)")
        .bind(&user2_id)
        .execute(&pool)
        .await
        .unwrap();

    let item1_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO inventory (id, user_id, item_id, obtained_from, equipped, obtained_at) VALUES (?, ?, 'item_badge_star', 'test', 0, ?)",
    )
    .bind(&item1_id)
    .bind(&user1_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Create trade: user1 offers item to user2 for 100 coins
    let (h, v) = auth_header(&user1_token);
    let res = server
        .post("/api/trades")
        .add_header(h, v)
        .json(&json!({
            "receiverId": user2_id,
            "senderItemIds": [item1_id],
            "receiverItemIds": [],
            "senderCoins": 0,
            "receiverCoins": 100
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    let trade_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["status"], "pending");

    // Accept trade as user2
    let (h, v) = auth_header(&user2_token);
    let res = server
        .post(&format!("/api/trades/{}/accept", trade_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["status"], "accepted");

    // Verify item moved to user2
    let owner = sqlx::query_scalar::<_, String>(
        "SELECT user_id FROM inventory WHERE id = ?",
    )
    .bind(&item1_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner, user2_id);

    // Verify coins: user1 got +100, user2 lost -100
    let u1_coins = sqlx::query_scalar::<_, i64>(
        "SELECT coins FROM wallet WHERE user_id = ?",
    )
    .bind(&user1_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let u2_coins = sqlx::query_scalar::<_, i64>(
        "SELECT coins FROM wallet WHERE user_id = ?",
    )
    .bind(&user2_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(u1_coins, 600); // 500 + 100
    assert_eq!(u2_coins, 400); // 500 - 100
}

#[tokio::test]
async fn create_and_buy_marketplace_listing() {
    let (server, pool, seller_id, seller_token) = setup().await;

    let (buyer_id, buyer_token) =
        common::create_test_user(&pool, "buyer@test.com", "buyer", "pass123").await;

    let now = chrono::Utc::now().to_rfc3339();

    // Wallets
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 100, 100)")
        .bind(&seller_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 500, 500)")
        .bind(&buyer_id)
        .execute(&pool)
        .await
        .unwrap();

    // Seller's item
    let inv_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO inventory (id, user_id, item_id, obtained_from, equipped, obtained_at) VALUES (?, ?, 'item_badge_star', 'test', 0, ?)",
    )
    .bind(&inv_id)
    .bind(&seller_id)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Create listing
    let (h, v) = auth_header(&seller_token);
    let res = server
        .post("/api/marketplace")
        .add_header(h, v)
        .json(&json!({
            "inventoryId": inv_id,
            "price": 200
        }))
        .await;

    res.assert_status(StatusCode::CREATED);
    let body: serde_json::Value = res.json();
    let listing_id = body["id"].as_str().unwrap().to_string();

    // Buy listing
    let (h, v) = auth_header(&buyer_token);
    let res = server
        .post(&format!("/api/marketplace/{}/buy", listing_id))
        .add_header(h, v)
        .await;

    res.assert_status_ok();
    let body: serde_json::Value = res.json();
    assert_eq!(body["newBalance"], 300); // 500 - 200

    // Verify item moved to buyer
    let owner = sqlx::query_scalar::<_, String>(
        "SELECT user_id FROM inventory WHERE id = ?",
    )
    .bind(&inv_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(owner, buyer_id);

    // Verify seller got paid
    let seller_coins = sqlx::query_scalar::<_, i64>(
        "SELECT coins FROM wallet WHERE user_id = ?",
    )
    .bind(&seller_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(seller_coins, 300); // 100 + 200
}
