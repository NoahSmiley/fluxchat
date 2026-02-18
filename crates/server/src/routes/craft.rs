use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use rand::Rng;
use serde::Deserialize;
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CraftRequest {
    pub inventory_ids: Vec<String>,
}

/// Rarity tier order for crafting upgrades
fn rarity_tier(rarity: &str) -> Option<u8> {
    match rarity {
        "common" => Some(0),
        "uncommon" => Some(1),
        "rare" => Some(2),
        "epic" => Some(3),
        "legendary" => Some(4),
        "ultra_rare" => Some(5),
        _ => None,
    }
}

fn tier_to_rarity(tier: u8) -> Option<&'static str> {
    match tier {
        0 => Some("common"),
        1 => Some("uncommon"),
        2 => Some("rare"),
        3 => Some("epic"),
        4 => Some("legendary"),
        5 => Some("ultra_rare"),
        _ => None,
    }
}

/// POST /api/craft
pub async fn craft_items(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Json(body): Json<CraftRequest>,
) -> impl IntoResponse {
    if body.inventory_ids.len() != 5 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Exactly 5 items are required for crafting"})),
        )
            .into_response();
    }

    // Check for duplicates
    let mut unique_ids = body.inventory_ids.clone();
    unique_ids.sort();
    unique_ids.dedup();
    if unique_ids.len() != 5 {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "All 5 items must be different"})),
        )
            .into_response();
    }

    // Fetch all items and verify ownership + same rarity
    let mut items_rarity: Option<String> = None;
    let mut catalog_ids: Vec<String> = Vec::new();

    for item_id in &body.inventory_ids {
        let item = sqlx::query_as::<_, (String, String, String)>(
            r#"SELECT i.id, i.user_id, cat.rarity
               FROM inventory i
               INNER JOIN item_catalog cat ON cat.id = i.item_id
               WHERE i.id = ?"#,
        )
        .bind(item_id)
        .fetch_optional(&state.db)
        .await
        .ok()
        .flatten();

        let (id, owner_id, rarity) = match item {
            Some(i) => i,
            None => {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({"error": format!("Item {} not found", item_id)})),
                )
                    .into_response()
            }
        };

        if owner_id != user.id {
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": format!("You do not own item {}", item_id)})),
            )
                .into_response();
        }

        match &items_rarity {
            Some(expected) if *expected != rarity => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({"error": "All 5 items must be the same rarity"})),
                )
                    .into_response()
            }
            None => items_rarity = Some(rarity.clone()),
            _ => {}
        }

        catalog_ids.push(id);
    }

    let current_rarity = items_rarity.unwrap();
    let current_tier = match rarity_tier(&current_rarity) {
        Some(t) => t,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Items have an invalid rarity for crafting"})),
            )
                .into_response()
        }
    };

    let next_tier = current_tier + 1;
    let next_rarity = match tier_to_rarity(next_tier) {
        Some(r) => r,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "Items are already at the highest rarity tier"})),
            )
                .into_response()
        }
    };

    // Find all catalog items of the next rarity tier
    let next_tier_items = sqlx::query_as::<_, (String, String, String, Option<String>)>(
        "SELECT id, name, item_type, image_url FROM item_catalog WHERE rarity = ?",
    )
    .bind(next_rarity)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if next_tier_items.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "No items available at the next rarity tier"})),
        )
            .into_response();
    }

    // Random selection from next tier
    let idx = {
        let mut rng = rand::thread_rng();
        rng.gen_range(0..next_tier_items.len())
    };
    let (catalog_id, item_name, item_type, item_image) = &next_tier_items[idx];

    // Delete the 5 input items
    for item_id in &body.inventory_ids {
        let _ = sqlx::query("DELETE FROM inventory WHERE id = ? AND user_id = ?")
            .bind(item_id)
            .bind(&user.id)
            .execute(&state.db)
            .await;
    }

    // Create new inventory entry (generate pattern_seed for doppler items: rings + banners)
    let inv_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let needs_pattern_seed = item_type == "ring_style" || (item_type == "profile_banner" && catalog_id.contains("doppler"));
    let pattern_seed: Option<i64> = if needs_pattern_seed {
        Some(rand::thread_rng().gen_range(0..1000))
    } else {
        None
    };

    let _ = sqlx::query(
        "INSERT INTO inventory (id, user_id, item_id, obtained_from, equipped, obtained_at, pattern_seed) VALUES (?, ?, ?, ?, 0, ?, ?)",
    )
    .bind(&inv_id)
    .bind(&user.id)
    .bind(catalog_id)
    .bind("crafted")
    .bind(&now)
    .bind(pattern_seed)
    .execute(&state.db)
    .await;

    // Get catalog metadata for response
    let catalog_meta = sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>, i64)>(
        "SELECT preview_css, card_series, card_number, is_holographic FROM item_catalog WHERE id = ?",
    )
    .bind(catalog_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (preview_css, card_series, card_number, is_holographic) = catalog_meta.unwrap_or((None, None, None, 0));

    Json(serde_json::json!({
        "id": inv_id,
        "userId": user.id,
        "catalogItemId": catalog_id,
        "name": item_name,
        "rarity": next_rarity,
        "type": item_type,
        "imageUrl": item_image,
        "previewCss": preview_css,
        "cardSeries": card_series,
        "cardNumber": card_number,
        "isHolographic": is_holographic != 0,
        "patternSeed": pattern_seed,
        "acquiredVia": "crafted",
        "equipped": false,
        "createdAt": now,
        "consumedItems": body.inventory_ids,
    }))
    .into_response()
}
