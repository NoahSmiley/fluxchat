use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTradeRequest {
    pub receiver_id: String,
    pub sender_item_ids: Vec<String>,
    pub receiver_item_ids: Vec<String>,
    #[serde(default)]
    pub sender_coins: i64,
    #[serde(default)]
    pub receiver_coins: i64,
}

/// GET /api/trades
pub async fn list_trades(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let trades = sqlx::query_as::<_, (String, String, String, i64, i64, String, String)>(
        r#"SELECT t.id, t.sender_id, t.receiver_id, t.sender_coins, t.receiver_coins, t.status, t.created_at
           FROM trades t
           WHERE (t.sender_id = ? OR t.receiver_id = ?) AND t.status = 'pending'
           ORDER BY t.created_at DESC"#,
    )
    .bind(&user.id)
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut result: Vec<serde_json::Value> = Vec::new();

    for (id, sender_id, receiver_id, sender_coins, receiver_coins, status, created_at) in trades {
        // Get items for this trade
        let sender_items = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, i64, Option<i64>)>(
            r#"SELECT ti.inventory_id, cat.name, cat.rarity, cat.item_type, cat.image_url,
                      cat.preview_css, cat.card_series, cat.card_number, cat.is_holographic, i.pattern_seed
               FROM trade_items ti
               INNER JOIN inventory i ON i.id = ti.inventory_id
               INNER JOIN item_catalog cat ON cat.id = i.item_id
               WHERE ti.trade_id = ? AND ti.side = 'sender'"#,
        )
        .bind(&id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let receiver_items = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, i64, Option<i64>)>(
            r#"SELECT ti.inventory_id, cat.name, cat.rarity, cat.item_type, cat.image_url,
                      cat.preview_css, cat.card_series, cat.card_number, cat.is_holographic, i.pattern_seed
               FROM trade_items ti
               INNER JOIN inventory i ON i.id = ti.inventory_id
               INNER JOIN item_catalog cat ON cat.id = i.item_id
               WHERE ti.trade_id = ? AND ti.side = 'receiver'"#,
        )
        .bind(&id)
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

        let s_items: Vec<serde_json::Value> = sender_items.into_iter().map(|(inv_id, name, rarity, item_type, image_url, preview_css, card_series, card_number, is_holo, pattern_seed)| {
            serde_json::json!({
                "inventoryId": inv_id,
                "name": name,
                "rarity": rarity,
                "type": item_type,
                "imageUrl": image_url,
                "previewCss": preview_css,
                "cardSeries": card_series,
                "cardNumber": card_number,
                "isHolographic": is_holo != 0,
                "patternSeed": pattern_seed,
            })
        }).collect();

        let r_items: Vec<serde_json::Value> = receiver_items.into_iter().map(|(inv_id, name, rarity, item_type, image_url, preview_css, card_series, card_number, is_holo, pattern_seed)| {
            serde_json::json!({
                "inventoryId": inv_id,
                "name": name,
                "rarity": rarity,
                "type": item_type,
                "imageUrl": image_url,
                "previewCss": preview_css,
                "cardSeries": card_series,
                "cardNumber": card_number,
                "isHolographic": is_holo != 0,
                "patternSeed": pattern_seed,
            })
        }).collect();

        result.push(serde_json::json!({
            "id": id,
            "senderId": sender_id,
            "receiverId": receiver_id,
            "senderCoins": sender_coins,
            "receiverCoins": receiver_coins,
            "senderItems": s_items,
            "receiverItems": r_items,
            "status": status,
            "createdAt": created_at,
        }));
    }

    Json(result).into_response()
}

/// POST /api/trades
pub async fn create_trade(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<CreateTradeRequest>,
) -> impl IntoResponse {
    if body.receiver_id == user.id {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Cannot trade with yourself"})),
        )
            .into_response();
    }

    // Validate sender owns their items and they are not in active trade/listing
    for item_id in &body.sender_item_ids {
        let item = sqlx::query_as::<_, (String,)>(
            "SELECT user_id FROM inventory WHERE id = ?",
        )
        .bind(item_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        match item {
            Some((owner,)) if owner == user.id => {}
            Some(_) => {
                return (
                    StatusCode::FORBIDDEN,
                    Json(serde_json::json!({"error": format!("You do not own item {}", item_id)})),
                )
                    .into_response()
            }
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({"error": format!("Item {} not found", item_id)})),
                )
                    .into_response()
            }
        }

        // Check not in active trade
        let in_trade = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM trade_items ti
               INNER JOIN trades t ON t.id = ti.trade_id
               WHERE ti.inventory_id = ? AND t.status = 'pending'"#,
        )
        .bind(item_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if in_trade > 0 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Item {} is already in an active trade", item_id)})),
            )
                .into_response();
        }

        // Check not in active marketplace listing
        let in_listing = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM marketplace_listings WHERE inventory_id = ? AND status = 'active'",
        )
        .bind(item_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if in_listing > 0 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Item {} is listed on the marketplace", item_id)})),
            )
                .into_response();
        }
    }

    // Validate receiver owns their items and they are not in active trade/listing
    for item_id in &body.receiver_item_ids {
        let item = sqlx::query_as::<_, (String,)>(
            "SELECT user_id FROM inventory WHERE id = ?",
        )
        .bind(item_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        match item {
            Some((owner,)) if owner == body.receiver_id => {}
            Some(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": format!("Receiver does not own item {}", item_id)})),
                )
                    .into_response()
            }
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({"error": format!("Item {} not found", item_id)})),
                )
                    .into_response()
            }
        }

        let in_trade = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM trade_items ti
               INNER JOIN trades t ON t.id = ti.trade_id
               WHERE ti.inventory_id = ? AND t.status = 'pending'"#,
        )
        .bind(item_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if in_trade > 0 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Item {} is already in an active trade", item_id)})),
            )
                .into_response();
        }

        let in_listing = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM marketplace_listings WHERE inventory_id = ? AND status = 'active'",
        )
        .bind(item_id)
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

        if in_listing > 0 {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": format!("Item {} is listed on the marketplace", item_id)})),
            )
                .into_response();
        }
    }

    // Validate coin amounts (sender must have enough)
    if body.sender_coins > 0 {
        let balance = sqlx::query_scalar::<_, i64>(
            "SELECT coins FROM wallet WHERE user_id = ?",
        )
        .bind(&user.id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

        if balance < body.sender_coins {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Insufficient coins for trade offer"})),
            )
                .into_response();
        }
    }

    // Create the trade
    let trade_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Expire in 24 hours
    let expires_at = (chrono::Utc::now() + chrono::Duration::hours(24)).to_rfc3339();
    let _ = sqlx::query(
        "INSERT INTO trades (id, sender_id, receiver_id, sender_coins, receiver_coins, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
    )
    .bind(&trade_id)
    .bind(&user.id)
    .bind(&body.receiver_id)
    .bind(body.sender_coins)
    .bind(body.receiver_coins)
    .bind(&now)
    .bind(&expires_at)
    .execute(&state.db)
    .await;

    // Insert trade items
    for item_id in &body.sender_item_ids {
        let ti_id = uuid::Uuid::new_v4().to_string();
        let _ = sqlx::query(
            "INSERT INTO trade_items (id, trade_id, inventory_id, side) VALUES (?, ?, ?, 'sender')",
        )
        .bind(&ti_id)
        .bind(&trade_id)
        .bind(item_id)
        .execute(&state.db)
        .await;
    }

    for item_id in &body.receiver_item_ids {
        let ti_id = uuid::Uuid::new_v4().to_string();
        let _ = sqlx::query(
            "INSERT INTO trade_items (id, trade_id, inventory_id, side) VALUES (?, ?, ?, 'receiver')",
        )
        .bind(&ti_id)
        .bind(&trade_id)
        .bind(item_id)
        .execute(&state.db)
        .await;
    }

    // Notify receiver
    state
        .gateway
        .send_to_user(
            &body.receiver_id,
            &crate::ws::events::ServerEvent::TradeOfferReceived {
                trade_id: trade_id.clone(),
                sender_id: user.id.clone(),
                sender_username: user.username.clone(),
            },
        )
        .await;

    (StatusCode::CREATED, Json(serde_json::json!({
        "id": trade_id,
        "senderId": user.id,
        "receiverId": body.receiver_id,
        "senderCoins": body.sender_coins,
        "receiverCoins": body.receiver_coins,
        "status": "pending",
        "createdAt": now,
    })))
    .into_response()
}

/// POST /api/trades/:tradeId/accept
pub async fn accept_trade(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(trade_id): Path<String>,
) -> impl IntoResponse {
    let trade = sqlx::query_as::<_, (String, String, String, i64, i64, String)>(
        "SELECT id, sender_id, receiver_id, sender_coins, receiver_coins, status FROM trades WHERE id = ?",
    )
    .bind(&trade_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (id, sender_id, receiver_id, sender_coins, receiver_coins, status) = match trade {
        Some(t) => t,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Trade not found"})),
            )
                .into_response()
        }
    };

    if receiver_id != user.id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Only the receiver can accept a trade"})),
        )
            .into_response();
    }

    if status != "pending" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Trade is not pending"})),
        )
            .into_response();
    }

    // Validate coin balances
    if sender_coins > 0 {
        let sender_balance = sqlx::query_scalar::<_, i64>(
            "SELECT coins FROM wallet WHERE user_id = ?",
        )
        .bind(&sender_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

        if sender_balance < sender_coins {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Sender no longer has enough coins"})),
            )
                .into_response();
        }
    }

    if receiver_coins > 0 {
        let receiver_balance = sqlx::query_scalar::<_, i64>(
            "SELECT coins FROM wallet WHERE user_id = ?",
        )
        .bind(&receiver_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(0);

        if receiver_balance < receiver_coins {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "You do not have enough coins"})),
            )
                .into_response();
        }
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Swap items: sender items go to receiver
    let sender_item_ids = sqlx::query_as::<_, (String,)>(
        "SELECT inventory_id FROM trade_items WHERE trade_id = ? AND side = 'sender'",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for (inv_id,) in &sender_item_ids {
        let _ = sqlx::query("UPDATE inventory SET user_id = ?, equipped = 0 WHERE id = ?")
            .bind(&receiver_id)
            .bind(inv_id)
            .execute(&state.db)
            .await;
    }

    // Swap items: receiver items go to sender
    let receiver_item_ids = sqlx::query_as::<_, (String,)>(
        "SELECT inventory_id FROM trade_items WHERE trade_id = ? AND side = 'receiver'",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    for (inv_id,) in &receiver_item_ids {
        let _ = sqlx::query("UPDATE inventory SET user_id = ?, equipped = 0 WHERE id = ?")
            .bind(&sender_id)
            .bind(inv_id)
            .execute(&state.db)
            .await;
    }

    // Transfer coins
    if sender_coins > 0 {
        let _ = sqlx::query("UPDATE wallet SET coins = coins - ? WHERE user_id = ?")
            .bind(sender_coins)
            .bind(&sender_id)
            .execute(&state.db)
            .await;

        let _ = sqlx::query("UPDATE wallet SET coins = coins + ? WHERE user_id = ?")
            .bind(sender_coins)
            .bind(&receiver_id)
            .execute(&state.db)
            .await;
    }

    if receiver_coins > 0 {
        let _ = sqlx::query("UPDATE wallet SET coins = coins - ? WHERE user_id = ?")
            .bind(receiver_coins)
            .bind(&receiver_id)
            .execute(&state.db)
            .await;

        let _ = sqlx::query("UPDATE wallet SET coins = coins + ? WHERE user_id = ?")
            .bind(receiver_coins)
            .bind(&sender_id)
            .execute(&state.db)
            .await;
    }

    // Update trade status
    let _ = sqlx::query("UPDATE trades SET status = 'accepted', resolved_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&id)
        .execute(&state.db)
        .await;

    // Notify both parties
    state
        .gateway
        .send_to_user(
            &sender_id,
            &crate::ws::events::ServerEvent::TradeResolved {
                trade_id: id.clone(),
                status: "accepted".to_string(),
            },
        )
        .await;

    state
        .gateway
        .send_to_user(
            &receiver_id,
            &crate::ws::events::ServerEvent::TradeResolved {
                trade_id: id.clone(),
                status: "accepted".to_string(),
            },
        )
        .await;

    Json(serde_json::json!({
        "id": id,
        "status": "accepted",
    }))
    .into_response()
}

/// POST /api/trades/:tradeId/decline
pub async fn decline_trade(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(trade_id): Path<String>,
) -> impl IntoResponse {
    let trade = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT id, sender_id, receiver_id, status FROM trades WHERE id = ?",
    )
    .bind(&trade_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (id, sender_id, receiver_id, status) = match trade {
        Some(t) => t,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Trade not found"})),
            )
                .into_response()
        }
    };

    if receiver_id != user.id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Only the receiver can decline a trade"})),
        )
            .into_response();
    }

    if status != "pending" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Trade is not pending"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE trades SET status = 'declined', resolved_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&id)
        .execute(&state.db)
        .await;

    // Notify both parties
    state
        .gateway
        .send_to_user(
            &sender_id,
            &crate::ws::events::ServerEvent::TradeResolved {
                trade_id: id.clone(),
                status: "declined".to_string(),
            },
        )
        .await;

    state
        .gateway
        .send_to_user(
            &receiver_id,
            &crate::ws::events::ServerEvent::TradeResolved {
                trade_id: id.clone(),
                status: "declined".to_string(),
            },
        )
        .await;

    Json(serde_json::json!({
        "id": id,
        "status": "declined",
    }))
    .into_response()
}

/// POST /api/trades/:tradeId/cancel
pub async fn cancel_trade(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(trade_id): Path<String>,
) -> impl IntoResponse {
    let trade = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT id, sender_id, receiver_id, status FROM trades WHERE id = ?",
    )
    .bind(&trade_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (id, sender_id, receiver_id, status) = match trade {
        Some(t) => t,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Trade not found"})),
            )
                .into_response()
        }
    };

    if sender_id != user.id {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Only the sender can cancel a trade"})),
        )
            .into_response();
    }

    if status != "pending" {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Trade is not pending"})),
        )
            .into_response();
    }

    let now = chrono::Utc::now().to_rfc3339();
    let _ = sqlx::query("UPDATE trades SET status = 'cancelled', resolved_at = ? WHERE id = ?")
        .bind(&now)
        .bind(&id)
        .execute(&state.db)
        .await;

    // Notify both parties
    state
        .gateway
        .send_to_user(
            &sender_id,
            &crate::ws::events::ServerEvent::TradeResolved {
                trade_id: id.clone(),
                status: "cancelled".to_string(),
            },
        )
        .await;

    state
        .gateway
        .send_to_user(
            &receiver_id,
            &crate::ws::events::ServerEvent::TradeResolved {
                trade_id: id.clone(),
                status: "cancelled".to_string(),
            },
        )
        .await;

    Json(serde_json::json!({
        "id": id,
        "status": "cancelled",
    }))
    .into_response()
}
