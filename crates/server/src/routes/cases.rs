use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use rand::Rng;
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

/// GET /api/cases
pub async fn list_cases(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
) -> impl IntoResponse {
    let cases = sqlx::query_as::<_, (String, String, Option<String>, i64, String)>(
        "SELECT id, name, image_url, cost_coins, created_at FROM cases WHERE is_active = 1 ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let result: Vec<serde_json::Value> = cases
        .into_iter()
        .map(|(id, name, image_url, price, created_at)| {
            serde_json::json!({
                "id": id,
                "name": name,
                "imageUrl": image_url,
                "price": price,
                "createdAt": created_at,
            })
        })
        .collect();

    Json(result).into_response()
}

/// GET /api/cases/:caseId
pub async fn get_case(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(case_id): Path<String>,
) -> impl IntoResponse {
    let case_row = sqlx::query_as::<_, (String, String, Option<String>, i64, i64, String)>(
        "SELECT id, name, image_url, cost_coins, is_active, created_at FROM cases WHERE id = ?",
    )
    .bind(&case_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (id, name, image_url, price, active, created_at) = match case_row {
        Some(c) => c,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Case not found"})),
            )
                .into_response()
        }
    };

    // Get case items joined with catalog
    let items = sqlx::query_as::<_, (String, String, String, String, String, Option<String>, i64, Option<String>, Option<String>, Option<String>, i64)>(
        r#"SELECT ci.id, ci.item_id, cat.name, cat.rarity, cat.item_type, cat.image_url, ci.weight,
                  cat.preview_css, cat.card_series, cat.card_number, cat.is_holographic
           FROM case_items ci
           INNER JOIN item_catalog cat ON cat.id = ci.item_id
           WHERE ci.case_id = ?
           ORDER BY ci.weight DESC"#,
    )
    .bind(&case_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let items_json: Vec<serde_json::Value> = items
        .into_iter()
        .map(|(ci_id, catalog_id, item_name, rarity, item_type, item_image, weight, preview_css, card_series, card_number, is_holo)| {
            serde_json::json!({
                "id": ci_id,
                "catalogItemId": catalog_id,
                "name": item_name,
                "rarity": rarity,
                "type": item_type,
                "imageUrl": item_image,
                "weight": weight,
                "previewCss": preview_css,
                "cardSeries": card_series,
                "cardNumber": card_number,
                "isHolographic": is_holo != 0,
            })
        })
        .collect();

    Json(serde_json::json!({
        "id": id,
        "name": name,
        "imageUrl": image_url,
        "price": price,
        "active": active != 0,
        "createdAt": created_at,
        "items": items_json,
    }))
    .into_response()
}

/// POST /api/cases/:caseId/open
pub async fn open_case(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(case_id): Path<String>,
) -> impl IntoResponse {
    // 1. Get the case
    let case_row = sqlx::query_as::<_, (String, String, i64, i64)>(
        "SELECT id, name, cost_coins, is_active FROM cases WHERE id = ?",
    )
    .bind(&case_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (_, case_name, price, active) = match case_row {
        Some(c) => c,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Case not found"})),
            )
                .into_response()
        }
    };

    if active == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Case is not active"})),
        )
            .into_response();
    }

    // 2. Check wallet balance
    let wallet = sqlx::query_as::<_, (i64,)>(
        "SELECT coins FROM wallet WHERE user_id = ?",
    )
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let balance = match wallet {
        Some((coins,)) => coins,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Wallet not found. Visit /api/economy/wallet first."})),
            )
                .into_response()
        }
    };

    if balance < price {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Insufficient coins"})),
        )
            .into_response();
    }

    // 3. Deduct cost from wallet
    let now = chrono::Utc::now().to_rfc3339();
    let new_balance = balance - price;

    let _ = sqlx::query("UPDATE wallet SET coins = ? WHERE user_id = ?")
        .bind(new_balance)
        .bind(&user.id)
        .execute(&state.db)
        .await;

    // 4. Weighted random selection from case_items
    let items = sqlx::query_as::<_, (String, String, String, String, Option<String>, i64)>(
        r#"SELECT ci.item_id, cat.name, cat.rarity, cat.item_type, cat.image_url, ci.weight
           FROM case_items ci
           INNER JOIN item_catalog cat ON cat.id = ci.item_id
           WHERE ci.case_id = ?"#,
    )
    .bind(&case_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if items.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "Case has no items"})),
        )
            .into_response();
    }

    let total_weight: i64 = items.iter().map(|i| i.5).sum();
    let roll = {
        let mut rng = rand::thread_rng();
        rng.gen_range(0..total_weight)
    };

    let mut cumulative: i64 = 0;
    let mut won_item: Option<(String, String, String, String, Option<String>)> = None;
    for (catalog_id, item_name, rarity, item_type, image_url, weight) in &items {
        cumulative += weight;
        if roll < cumulative {
            won_item = Some((
                catalog_id.clone(),
                item_name.clone(),
                rarity.clone(),
                item_type.clone(),
                image_url.clone(),
            ));
            break;
        }
    }

    let (catalog_id, item_name, item_rarity, item_type, item_image) = match won_item {
        Some(w) => w,
        None => {
            // Fallback to last item
            let last = items.last().unwrap();
            (last.0.clone(), last.1.clone(), last.2.clone(), last.3.clone(), last.4.clone())
        }
    };

    // 5. Create inventory entry (generate pattern_seed for doppler items: rings + banners)
    let inv_id = uuid::Uuid::new_v4().to_string();
    let needs_pattern_seed = item_type == "ring_style" || (item_type == "profile_banner" && catalog_id.contains("doppler"));
    let pattern_seed: Option<i64> = if needs_pattern_seed {
        Some(rand::thread_rng().gen_range(0..1000))
    } else {
        None
    };
    let _ = sqlx::query(
        "INSERT INTO inventory (id, user_id, item_id, obtained_from, equipped, obtained_at, source_case_id, pattern_seed) VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
    )
    .bind(&inv_id)
    .bind(&user.id)
    .bind(&catalog_id)
    .bind("case_opened")
    .bind(&now)
    .bind(&case_id)
    .bind(pattern_seed)
    .execute(&state.db)
    .await;

    // 6. Log coin deduction
    let log_id = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO coin_rewards_log (id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&log_id)
    .bind(&user.id)
    .bind(-price)
    .bind("case_opened")
    .bind(&now)
    .execute(&state.db)
    .await;

    // Broadcast case opened event
    state
        .gateway
        .broadcast_all(
            &crate::ws::events::ServerEvent::CaseOpened {
                user_id: user.id.clone(),
                username: user.username.clone(),
                item_name: item_name.clone(),
                item_rarity: item_rarity.clone(),
                case_name: case_name.clone(),
            },
            None,
        )
        .await;

    // Broadcast coin change to the user
    state
        .gateway
        .send_to_user(
            &user.id,
            &crate::ws::events::ServerEvent::CoinsEarned {
                user_id: user.id.clone(),
                amount: -price,
                reason: "case_opened".to_string(),
                new_balance,
            },
        )
        .await;

    // 7. Get catalog metadata for response
    let catalog_meta = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, i64)>(
        "SELECT preview_css, card_series, card_number, is_holographic FROM item_catalog WHERE id = ?",
    )
    .bind(&catalog_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (preview_css, card_series, card_number, is_holographic) = catalog_meta.unwrap_or((None, None, None, 0));

    // 8. Return the won item
    Json(serde_json::json!({
        "id": inv_id,
        "userId": user.id,
        "catalogItemId": catalog_id,
        "name": item_name,
        "rarity": item_rarity,
        "type": item_type,
        "imageUrl": item_image,
        "previewCss": preview_css,
        "cardSeries": card_series,
        "cardNumber": card_number,
        "isHolographic": is_holographic != 0,
        "patternSeed": pattern_seed,
        "acquiredVia": "case_opened",
        "equipped": false,
        "createdAt": now,
        "newBalance": new_balance,
    }))
    .into_response()
}
