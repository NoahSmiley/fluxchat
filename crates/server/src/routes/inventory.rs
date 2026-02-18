use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use std::collections::HashMap;
use std::sync::Arc;

use crate::models::AuthUser;
use crate::AppState;

/// GET /api/inventory
pub async fn get_inventory(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let type_filter = params.get("type").cloned();
    let rarity_filter = params.get("rarity").cloned();

    let mut query = String::from(
        r#"SELECT i.id, i.user_id, i.item_id, cat.name, cat.rarity, cat.item_type, cat.image_url,
                  i.obtained_from, i.equipped, i.obtained_at,
                  cat.preview_css, cat.card_series, cat.card_number, cat.is_holographic, i.pattern_seed
           FROM inventory i
           INNER JOIN item_catalog cat ON cat.id = i.item_id
           WHERE i.user_id = ?"#,
    );

    let mut binds: Vec<String> = vec![user.id.clone()];

    if let Some(ref t) = type_filter {
        query.push_str(" AND cat.item_type = ?");
        binds.push(t.clone());
    }
    if let Some(ref r) = rarity_filter {
        query.push_str(" AND cat.rarity = ?");
        binds.push(r.clone());
    }

    query.push_str(" ORDER BY i.obtained_at DESC");

    // Build the query with dynamic binds
    let mut sql_query = sqlx::query_as::<_, (String, String, String, String, String, String, Option<String>, Option<String>, bool, String, Option<String>, Option<String>, Option<String>, i64, Option<i64>)>(&query);
    for b in &binds {
        sql_query = sql_query.bind(b);
    }

    let items = sql_query
        .fetch_all(&state.db)
        .await
        .unwrap_or_default();

    let result: Vec<serde_json::Value> = items
        .into_iter()
        .map(|(id, user_id, item_id, name, rarity, item_type, image_url, obtained_from, equipped, obtained_at, preview_css, card_series, card_number, is_holo, pattern_seed)| {
            serde_json::json!({
                "id": id,
                "userId": user_id,
                "catalogItemId": item_id,
                "name": name,
                "rarity": rarity,
                "type": item_type,
                "imageUrl": image_url,
                "acquiredVia": obtained_from,
                "equipped": equipped,
                "createdAt": obtained_at,
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

/// GET /api/users/:userId/inventory
pub async fn get_user_inventory(
    State(state): State<Arc<AppState>>,
    _user: AuthUser,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let items = sqlx::query_as::<_, (String, String, String, String, String, String, Option<String>, Option<String>, bool, String, Option<String>, Option<String>, Option<String>, i64, Option<i64>)>(
        r#"SELECT i.id, i.user_id, i.item_id, cat.name, cat.rarity, cat.item_type, cat.image_url,
                  i.obtained_from, i.equipped, i.obtained_at,
                  cat.preview_css, cat.card_series, cat.card_number, cat.is_holographic, i.pattern_seed
           FROM inventory i
           INNER JOIN item_catalog cat ON cat.id = i.item_id
           WHERE i.user_id = ?
           ORDER BY i.obtained_at DESC"#,
    )
    .bind(&user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let result: Vec<serde_json::Value> = items
        .into_iter()
        .map(|(id, uid, item_id, name, rarity, item_type, image_url, obtained_from, equipped, obtained_at, preview_css, card_series, card_number, is_holo, pattern_seed)| {
            serde_json::json!({
                "id": id,
                "userId": uid,
                "catalogItemId": item_id,
                "name": name,
                "rarity": rarity,
                "type": item_type,
                "imageUrl": image_url,
                "acquiredVia": obtained_from,
                "equipped": equipped,
                "createdAt": obtained_at,
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

/// PATCH /api/inventory/:itemId
pub async fn equip_item(
    State(state): State<Arc<AppState>>,
    user: AuthUser,
    Path(item_id): Path<String>,
) -> impl IntoResponse {
    // Verify user owns this item and get catalog info
    let item = sqlx::query_as::<_, (String, String, bool, String, Option<String>, Option<i64>)>(
        r#"SELECT i.id, i.user_id, i.equipped, cat.item_type, cat.preview_css, i.pattern_seed
           FROM inventory i
           INNER JOIN item_catalog cat ON cat.id = i.item_id
           WHERE i.id = ?"#,
    )
    .bind(&item_id)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    let (id, owner_id, equipped, item_type, preview_css, pattern_seed) = match item {
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

    let new_equipped = !equipped;

    if item_type == "ring_style" {
        if new_equipped {
            // Unequip any other ring_style items this user has equipped
            let _ = sqlx::query(
                r#"UPDATE inventory SET equipped = 0
                   WHERE user_id = ? AND equipped = 1 AND id != ?
                   AND item_id IN (SELECT id FROM item_catalog WHERE item_type = 'ring_style')"#,
            )
            .bind(&user.id)
            .bind(&id)
            .execute(&state.db)
            .await;

            // Equip this ring
            let _ = sqlx::query("UPDATE inventory SET equipped = 1 WHERE id = ?")
                .bind(&id)
                .execute(&state.db)
                .await;

            // Sync ring style + pattern seed to user profile
            let ring_style = preview_css.as_deref().unwrap_or("default");
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                r#"UPDATE "user" SET ring_style = ?, ring_pattern_seed = ?, updatedAt = ? WHERE id = ?"#,
            )
            .bind(ring_style)
            .bind(pattern_seed)
            .bind(&now)
            .bind(&user.id)
            .execute(&state.db)
            .await;

            // Broadcast profile update so all clients see the ring change
            state
                .gateway
                .broadcast_all(
                    &crate::ws::events::ServerEvent::ProfileUpdate {
                        user_id: user.id.clone(),
                        username: None,
                        image: None,
                        ring_style: Some(ring_style.to_string()),
                        ring_spin: None,
                        ring_pattern_seed: Some(pattern_seed),
                        banner_css: None,
                        banner_pattern_seed: None,
                    },
                    None,
                )
                .await;
        } else {
            // Unequipping ring — revert to default
            let _ = sqlx::query("UPDATE inventory SET equipped = 0 WHERE id = ?")
                .bind(&id)
                .execute(&state.db)
                .await;

            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                r#"UPDATE "user" SET ring_style = 'default', ring_pattern_seed = NULL, updatedAt = ? WHERE id = ?"#,
            )
            .bind(&now)
            .bind(&user.id)
            .execute(&state.db)
            .await;

            state
                .gateway
                .broadcast_all(
                    &crate::ws::events::ServerEvent::ProfileUpdate {
                        user_id: user.id.clone(),
                        username: None,
                        image: None,
                        ring_style: Some("default".to_string()),
                        ring_spin: None,
                        ring_pattern_seed: Some(None),
                        banner_css: None,
                        banner_pattern_seed: None,
                    },
                    None,
                )
                .await;
        }
    } else if item_type == "profile_banner" {
        if new_equipped {
            // Unequip any other banner items this user has equipped
            let _ = sqlx::query(
                r#"UPDATE inventory SET equipped = 0
                   WHERE user_id = ? AND equipped = 1 AND id != ?
                   AND item_id IN (SELECT id FROM item_catalog WHERE item_type = 'profile_banner')"#,
            )
            .bind(&user.id)
            .bind(&id)
            .execute(&state.db)
            .await;

            // Equip this banner
            let _ = sqlx::query("UPDATE inventory SET equipped = 1 WHERE id = ?")
                .bind(&id)
                .execute(&state.db)
                .await;

            // Sync banner to user profile
            let banner_css = preview_css.as_deref();
            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                r#"UPDATE "user" SET banner_css = ?, banner_pattern_seed = ?, updatedAt = ? WHERE id = ?"#,
            )
            .bind(banner_css)
            .bind(pattern_seed)
            .bind(&now)
            .bind(&user.id)
            .execute(&state.db)
            .await;

            // Broadcast profile update
            state
                .gateway
                .broadcast_all(
                    &crate::ws::events::ServerEvent::ProfileUpdate {
                        user_id: user.id.clone(),
                        username: None,
                        image: None,
                        ring_style: None,
                        ring_spin: None,
                        ring_pattern_seed: None,
                        banner_css: Some(banner_css.map(|s| s.to_string())),
                        banner_pattern_seed: Some(pattern_seed),
                    },
                    None,
                )
                .await;
        } else {
            // Unequipping banner — clear it
            let _ = sqlx::query("UPDATE inventory SET equipped = 0 WHERE id = ?")
                .bind(&id)
                .execute(&state.db)
                .await;

            let now = chrono::Utc::now().to_rfc3339();
            let _ = sqlx::query(
                r#"UPDATE "user" SET banner_css = NULL, banner_pattern_seed = NULL, updatedAt = ? WHERE id = ?"#,
            )
            .bind(&now)
            .bind(&user.id)
            .execute(&state.db)
            .await;

            state
                .gateway
                .broadcast_all(
                    &crate::ws::events::ServerEvent::ProfileUpdate {
                        user_id: user.id.clone(),
                        username: None,
                        image: None,
                        ring_style: None,
                        ring_spin: None,
                        ring_pattern_seed: None,
                        banner_css: Some(None),
                        banner_pattern_seed: Some(None),
                    },
                    None,
                )
                .await;
        }
    } else {
        // Non-ring/non-banner items: simple toggle
        let _ = sqlx::query("UPDATE inventory SET equipped = ? WHERE id = ?")
            .bind(new_equipped)
            .bind(&id)
            .execute(&state.db)
            .await;
    }

    Json(serde_json::json!({
        "id": id,
        "equipped": new_equipped,
    }))
    .into_response()
}
