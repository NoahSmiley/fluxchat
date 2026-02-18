use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

/// GET /api/economy/wallet
pub async fn get_wallet(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    // Try to fetch existing wallet
    let wallet = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT user_id, coins, lifetime_earned FROM wallet WHERE user_id = ?",
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match wallet {
        Some((user_id, coins, lifetime_earned)) => {
            Json(serde_json::json!({
                "userId": user_id,
                "balance": coins,
                "lifetimeEarned": lifetime_earned,
            }))
            .into_response()
        }
        None => {
            // Create wallet with 100 starting coins
            let starting_balance: i64 = 100;

            let result = sqlx::query(
                "INSERT INTO wallet (user_id, coins, lifetime_earned) VALUES (?, ?, ?)",
            )
            .bind(&user.id)
            .bind(starting_balance)
            .bind(starting_balance)
            .execute(&state.db)
            .await;

            if let Err(e) = result {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": format!("Failed to create wallet: {}", e)})),
                )
                    .into_response();
            }

            // Log the starting bonus
            let log_id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                "INSERT INTO coin_rewards_log (id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&log_id)
            .bind(&user.id)
            .bind(starting_balance)
            .bind("welcome_bonus")
            .bind(&now)
            .execute(&state.db)
            .await;

            Json(serde_json::json!({
                "userId": user.id,
                "balance": starting_balance,
                "lifetimeEarned": starting_balance,
            }))
            .into_response()
        }
    }
}

/// POST /api/economy/grant — Dev endpoint to add coins
pub async fn grant_coins(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let amount = body.get("amount").and_then(|v| v.as_i64()).unwrap_or(1000);

    let now = chrono::Utc::now().to_rfc3339();

    // Ensure wallet exists first
    let _ = sqlx::query(
        "INSERT OR IGNORE INTO wallet (user_id, coins, lifetime_earned) VALUES (?, 0, 0)",
    )
    .bind(&user.id)
    .execute(&state.db)
    .await;

    // Update wallet balance
    let result = sqlx::query(
        "UPDATE wallet SET coins = coins + ?, lifetime_earned = lifetime_earned + ? WHERE user_id = ?",
    )
    .bind(amount)
    .bind(amount.max(0))
    .bind(&user.id)
    .execute(&state.db)
    .await;

    if let Err(e) = result {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": format!("Failed to grant coins: {}", e)})),
        )
            .into_response();
    }

    // Log the grant
    let log_id = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO coin_rewards_log (id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&log_id)
    .bind(&user.id)
    .bind(amount)
    .bind("dev_grant")
    .bind(&now)
    .execute(&state.db)
    .await;

    // Get new balance
    let new_balance = sqlx::query_as::<_, (i64,)>(
        "SELECT coins FROM wallet WHERE user_id = ?",
    )
    .bind(&user.id)
    .fetch_one(&state.db)
    .await
    .map(|(b,)| b)
    .unwrap_or(0);

    Json(serde_json::json!({
        "granted": amount,
        "newBalance": new_balance,
    }))
    .into_response()
}

/// POST /api/economy/grant-item — Dev endpoint to grant a specific catalog item
pub async fn grant_item(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let item_id = match body.get("itemId").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "itemId required"})),
            )
                .into_response()
        }
    };
    let pattern_seed = body.get("patternSeed").and_then(|v| v.as_i64());

    // Verify item exists in catalog
    let exists = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM item_catalog WHERE id = ?",
    )
    .bind(&item_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    if exists.is_none() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Item not found in catalog"})),
        )
            .into_response();
    }

    let inv_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let _ = sqlx::query(
        "INSERT INTO inventory (id, user_id, item_id, obtained_from, equipped, obtained_at, pattern_seed) VALUES (?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&inv_id)
    .bind(&user.id)
    .bind(&item_id)
    .bind("dev_grant")
    .bind(&now)
    .bind(pattern_seed)
    .execute(&state.db)
    .await;

    Json(serde_json::json!({
        "id": inv_id,
        "itemId": item_id,
        "patternSeed": pattern_seed,
    }))
    .into_response()
}

/// DELETE /api/economy/clear-inventory — Dev endpoint to clear all inventory
pub async fn clear_inventory(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    // Also reset equipped ring on user profile
    let _ = sqlx::query(
        "UPDATE users SET ring_style = 'default', ring_pattern_seed = NULL WHERE id = ?",
    )
    .bind(&user.id)
    .execute(&state.db)
    .await;

    let _ = sqlx::query("DELETE FROM inventory WHERE user_id = ?")
        .bind(&user.id)
        .execute(&state.db)
        .await;

    Json(serde_json::json!({"cleared": true})).into_response()
}

/// GET /api/economy/history
pub async fn get_coin_history(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
) -> impl IntoResponse {
    let history = sqlx::query_as::<_, (String, String, i64, String, String)>(
        "SELECT id, user_id, amount, reason, created_at FROM coin_rewards_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let entries: Vec<serde_json::Value> = history
        .into_iter()
        .map(|(id, user_id, amount, reason, created_at)| {
            serde_json::json!({
                "id": id,
                "userId": user_id,
                "amount": amount,
                "reason": reason,
                "createdAt": created_at,
            })
        })
        .collect();

    Json(entries).into_response()
}
