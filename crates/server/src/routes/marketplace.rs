use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateListingRequest {
    pub inventory_id: String,
    pub price: i64,
}

/// GET /api/marketplace
pub async fn list_marketplace(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let search = params.get("search").cloned();
    let rarity = params.get("rarity").cloned();
    let item_type = params.get("type").cloned();
    let sort = params.get("sort").cloned().unwrap_or_else(|| "newest".to_string());

    let mut query = String::from(
        r#"SELECT ml.id, ml.seller_id, ml.inventory_id, ml.price_coins, ml.status, ml.created_at,
                  cat.name, cat.rarity, cat.item_type, cat.image_url,
                  u.username as seller_username,
                  cat.preview_css, cat.card_series, cat.card_number, cat.is_holographic, i.pattern_seed
           FROM marketplace_listings ml
           INNER JOIN inventory i ON i.id = ml.inventory_id
           INNER JOIN item_catalog cat ON cat.id = i.item_id
           INNER JOIN "user" u ON u.id = ml.seller_id
           WHERE ml.status = 'active'"#,
    );

    let mut binds: Vec<String> = Vec::new();

    if let Some(ref s) = search {
        query.push_str(" AND cat.name LIKE ?");
        binds.push(format!("%{}%", s));
    }
    if let Some(ref r) = rarity {
        query.push_str(" AND cat.rarity = ?");
        binds.push(r.clone());
    }
    if let Some(ref t) = item_type {
        query.push_str(" AND cat.item_type = ?");
        binds.push(t.clone());
    }

    match sort.as_str() {
        "price_asc" => query.push_str(" ORDER BY ml.price_coins ASC"),
        "price_desc" => query.push_str(" ORDER BY ml.price_coins DESC"),
        _ => query.push_str(" ORDER BY ml.created_at DESC"),
    }

    let mut sql_query = sqlx::query_as::<_, (String, String, String, i64, String, String, String, String, String, Option<String>, String, Option<String>, Option<String>, Option<String>, i64, Option<i64>)>(&query);
    for b in &binds {
        sql_query = sql_query.bind(b);
    }

    let listings = sql_query
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let result: Vec<serde_json::Value> = listings
        .into_iter()
        .map(|(id, seller_id, inventory_id, price, status, created_at, name, rarity, item_type, image_url, seller_username, preview_css, card_series, card_number, is_holo, pattern_seed)| {
            serde_json::json!({
                "id": id,
                "sellerId": seller_id,
                "sellerUsername": seller_username,
                "inventoryId": inventory_id,
                "price": price,
                "status": status,
                "name": name,
                "rarity": rarity,
                "type": item_type,
                "imageUrl": image_url,
                "createdAt": created_at,
                "previewCss": preview_css,
                "cardSeries": card_series,
                "cardNumber": card_number,
                "isHolographic": is_holo != 0,
                "patternSeed": pattern_seed,
            })
        })
        .collect();

    Json(result).into_response()
}

/// POST /api/marketplace
pub async fn create_listing(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<CreateListingRequest>,
) -> impl IntoResponse {
    if body.price <= 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Price must be positive"})),
        )
            .into_response();
    }

    // Verify ownership
    let item = sqlx::query_as::<_, (String, String, bool)>(
        "SELECT id, user_id, equipped FROM inventory WHERE id = ?",
    )
    .bind(&body.inventory_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (inv_id, owner_id, equipped) = match item {
        Some(i) => i,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Item not found"})),
            )
                .into_response()
        }
    };

    if owner_id != user.id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "You do not own this item"})),
        )
            .into_response();
    }

    if equipped {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Cannot list an equipped item. Unequip it first."})),
        )
            .into_response();
    }

    // Check not in active trade
    let in_trade = sqlx::query_scalar::<_, i64>(
        r#"SELECT COUNT(*) FROM trade_items ti
           INNER JOIN trades t ON t.id = ti.trade_id
           WHERE ti.inventory_id = ? AND t.status = 'pending'"#,
    )
    .bind(&inv_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if in_trade > 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Item is in an active trade"})),
        )
            .into_response();
    }

    // Check not already listed
    let already_listed = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM marketplace_listings WHERE inventory_id = ? AND status = 'active'",
    )
    .bind(&inv_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    if already_listed > 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Item is already listed on the marketplace"})),
        )
            .into_response();
    }

    let listing_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query(
        "INSERT INTO marketplace_listings (id, seller_id, inventory_id, price_coins, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
    )
    .bind(&listing_id)
    .bind(&user.id)
    .bind(&inv_id)
    .bind(body.price)
    .bind(&now)
    .execute(&state.db)
    .await;

    (StatusCode::CREATED, Json(serde_json::json!({
        "id": listing_id,
        "sellerId": user.id,
        "inventoryId": inv_id,
        "price": body.price,
        "status": "active",
        "createdAt": now,
    })))
    .into_response()
}

/// POST /api/marketplace/:id/buy
pub async fn buy_listing(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(listing_id): Path<String>,
) -> impl IntoResponse {
    let listing = sqlx::query_as::<_, (String, String, String, i64, String)>(
        "SELECT id, seller_id, inventory_id, price_coins, status FROM marketplace_listings WHERE id = ?",
    )
    .bind(&listing_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (id, seller_id, inventory_id, price, status) = match listing {
        Some(l) => l,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Listing not found"})),
            )
                .into_response()
        }
    };

    if status != "active" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Listing is no longer active"})),
        )
            .into_response();
    }

    if seller_id == user.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Cannot buy your own listing"})),
        )
            .into_response();
    }

    // Check buyer has enough coins
    let buyer_balance = sqlx::query_as::<_, (i64,)>(
        "SELECT coins FROM wallet WHERE user_id = ?",
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let buyer_balance = match buyer_balance {
        Some((coins,)) => coins,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Wallet not found"})),
            )
                .into_response()
        }
    };

    if buyer_balance < price {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Insufficient coins"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Deduct from buyer
    let new_buyer_balance = buyer_balance - price;
    let _ = sqlx::query("UPDATE wallet SET coins = ? WHERE user_id = ?")
        .bind(new_buyer_balance)
        .bind(&user.id)
        .execute(&state.db)
        .await;

    // Credit seller
    let _ = sqlx::query("UPDATE wallet SET coins = coins + ? WHERE user_id = ?")
        .bind(price)
        .bind(&seller_id)
        .execute(&state.db)
        .await;

    // Transfer item to buyer
    let _ = sqlx::query("UPDATE inventory SET user_id = ?, equipped = 0 WHERE id = ?")
        .bind(&user.id)
        .bind(&inventory_id)
        .execute(&state.db)
        .await;

    // Update listing status
    let _ = sqlx::query("UPDATE marketplace_listings SET status = 'sold', buyer_id = ?, sold_at = ? WHERE id = ?")
        .bind(&user.id)
        .bind(&now)
        .bind(&id)
        .execute(&state.db)
        .await;

    // Log coin transactions
    let log_id1 = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO coin_rewards_log (id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&log_id1)
    .bind(&user.id)
    .bind(-price)
    .bind("marketplace_purchase")
    .bind(&now)
    .execute(&state.db)
    .await;

    let log_id2 = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO coin_rewards_log (id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&log_id2)
    .bind(&seller_id)
    .bind(price)
    .bind("marketplace_sale")
    .bind(&now)
    .execute(&state.db)
    .await;

    // Notify buyer of coin change
    state
        .gateway
        .send_to_user(
            &user.id,
            &crate::ws::events::ServerEvent::CoinsEarned {
                user_id: user.id.clone(),
                amount: -price,
                reason: "marketplace_purchase".to_string(),
                new_balance: new_buyer_balance,
            },
        )
        .await;

    // Get seller's new balance to notify them
    let seller_new_balance = sqlx::query_scalar::<_, i64>(
        "SELECT coins FROM wallet WHERE user_id = ?",
    )
    .bind(&seller_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or(0);

    state
        .gateway
        .send_to_user(
            &seller_id,
            &crate::ws::events::ServerEvent::CoinsEarned {
                user_id: seller_id.clone(),
                amount: price,
                reason: "marketplace_sale".to_string(),
                new_balance: seller_new_balance,
            },
        )
        .await;

    Json(serde_json::json!({
        "id": id,
        "status": "sold",
        "buyerId": user.id,
        "newBalance": new_buyer_balance,
    }))
    .into_response()
}

/// DELETE /api/marketplace/:id
pub async fn cancel_listing(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(listing_id): Path<String>,
) -> impl IntoResponse {
    let listing = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, seller_id, status FROM marketplace_listings WHERE id = ?",
    )
    .bind(&listing_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (id, seller_id, status) = match listing {
        Some(l) => l,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Listing not found"})),
            )
                .into_response()
        }
    };

    if seller_id != user.id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Only the seller can cancel a listing"})),
        )
            .into_response();
    }

    if status != "active" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Listing is not active"})),
        )
            .into_response();
    }

    let _ = sqlx::query("UPDATE marketplace_listings SET status = 'cancelled' WHERE id = ?")
        .bind(&id)
        .execute(&state.db)
        .await;

    StatusCode::NO_CONTENT.into_response()
}
