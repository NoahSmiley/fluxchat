use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub user: SessionUser,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SessionUser {
    pub id: String,
    pub email: String,
    pub username: String,
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub invite_code: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ServerWithRole {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub invite_code: String,
    pub created_at: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub server_id: String,
    pub name: String,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub channel_type: String,
    pub bitrate: Option<i64>,
    pub parent_id: Option<String>,
    pub position: i64,
    pub is_room: i64,
    pub is_persistent: i64,
    pub creator_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub channel_id: String,
    pub sender_id: String,
    pub content: String,
    pub created_at: String,
    pub edited_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Reaction {
    pub id: String,
    pub message_id: String,
    pub user_id: String,
    pub emoji: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemberWithUser {
    pub user_id: String,
    pub server_id: String,
    pub role: String,
    pub joined_at: String,
    pub username: String,
    pub image: Option<String>,
    pub ring_style: String,
    pub ring_spin: bool,
    pub steam_id: Option<String>,
    pub ring_pattern_seed: Option<i64>,
    pub banner_css: Option<String>,
    pub banner_pattern_seed: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DmChannelResponse {
    pub id: String,
    pub other_user: DmOtherUser,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct DmOtherUser {
    pub id: String,
    pub username: String,
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DmMessage {
    pub id: String,
    pub dm_channel_id: String,
    pub sender_id: String,
    pub ciphertext: String,
    pub mls_epoch: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceParticipant {
    pub user_id: String,
    pub username: String,
    #[serde(default)]
    pub drink_count: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    pub bitrate: Option<i64>,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub is_room: bool,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub bitrate: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderItem {
    pub id: String,
    pub parent_id: Option<String>,
    pub position: i64,
}

#[derive(Debug, Deserialize)]
pub struct ReorderChannelsRequest {
    pub items: Vec<ReorderItem>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WhitelistEntry {
    pub id: String,
    pub email: String,
    pub added_by: String,
    pub added_at: String,
}

#[derive(Debug, Deserialize)]
pub struct AddWhitelistRequest {
    pub emails: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct SignUpRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub username: String,
}

#[derive(Debug, Deserialize)]
pub struct SignInRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDmRequest {
    pub user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTokenRequest {
    pub channel_id: String,
    pub viewer: Option<bool>,
}

/// Deserializer that keeps JSON null as Some(Value::Null) instead of None.
/// This lets us distinguish "field missing" (None) from "field set to null" (Some(Null)).
fn nullable_value<'de, D>(deserializer: D) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(serde_json::Value::deserialize(deserializer)?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
    pub username: Option<String>,
    #[serde(default, deserialize_with = "nullable_value")]
    pub image: Option<serde_json::Value>,
    pub ring_style: Option<String>,
    pub ring_spin: Option<bool>,
    #[serde(default, deserialize_with = "nullable_value")]
    pub steam_id: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub message_id: Option<String>,
    pub uploader_id: String,
    pub filename: String,
    pub content_type: String,
    pub size: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub domain: Option<String>,
    pub fetched_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPublicKeyRequest {
    pub public_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreServerKeyRequest {
    pub encrypted_key: String,
    pub sender_id: String,
}

// Spotify
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyCallbackRequest {
    pub code: String,
    pub code_verifier: String,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyAccountInfo {
    pub linked: bool,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSession {
    pub id: String,
    pub voice_channel_id: String,
    pub host_user_id: String,
    pub current_track_uri: Option<String>,
    pub current_track_position_ms: i64,
    pub is_playing: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub id: String,
    pub session_id: String,
    pub track_uri: String,
    pub track_name: String,
    pub track_artist: String,
    pub track_album: Option<String>,
    pub track_image_url: Option<String>,
    pub track_duration_ms: i64,
    pub added_by_user_id: String,
    pub position: i64,
    pub created_at: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddToQueueRequest {
    pub track_uri: String,
    pub track_name: String,
    pub track_artist: String,
    pub track_album: Option<String>,
    pub track_image_url: Option<String>,
    pub track_duration_ms: i64,
    #[serde(default = "default_source")]
    pub source: String,
}

fn default_source() -> String {
    "spotify".to_string()
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub username: String,
}

// ── Economy models ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub item_type: String,
    pub rarity: String,
    pub image_url: Option<String>,
    pub preview_css: Option<String>,
    pub card_series: Option<String>,
    pub card_number: Option<String>,
    pub is_holographic: i64,
    pub tradeable: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CaseRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub image_url: Option<String>,
    pub cost_coins: i64,
    pub is_active: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CaseItemRow {
    pub case_id: String,
    pub item_id: String,
    pub weight: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemRow {
    pub id: String,
    pub user_id: String,
    pub item_id: String,
    pub equipped: i64,
    pub obtained_from: Option<String>,
    pub obtained_at: String,
    pub source_case_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItemFull {
    pub id: String,
    pub user_id: String,
    pub item_id: String,
    pub equipped: i64,
    pub obtained_from: Option<String>,
    pub obtained_at: String,
    pub source_case_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub item_type: String,
    pub rarity: String,
    pub image_url: Option<String>,
    pub preview_css: Option<String>,
    pub card_series: Option<String>,
    pub card_number: Option<String>,
    pub is_holographic: i64,
    pub tradeable: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TradeRow {
    pub id: String,
    pub sender_id: String,
    pub receiver_id: String,
    pub sender_coins: i64,
    pub receiver_coins: i64,
    pub status: String,
    pub message: Option<String>,
    pub created_at: String,
    pub expires_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TradeItemRow {
    pub id: String,
    pub trade_id: String,
    pub inventory_id: String,
    pub side: String,
    pub name: String,
    pub description: Option<String>,
    pub item_type: String,
    pub rarity: String,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceListingRow {
    pub id: String,
    pub seller_id: String,
    pub inventory_id: String,
    pub price_coins: i64,
    pub status: String,
    pub created_at: String,
    pub sold_at: Option<String>,
    pub buyer_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceListingFull {
    pub id: String,
    pub seller_id: String,
    pub inventory_id: String,
    pub price_coins: i64,
    pub status: String,
    pub created_at: String,
    pub sold_at: Option<String>,
    pub buyer_id: Option<String>,
    pub name: String,
    pub rarity: String,
    pub image_url: Option<String>,
    pub seller_username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WalletRow {
    pub user_id: String,
    pub coins: i64,
    pub lifetime_earned: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CoinRewardRow {
    pub id: String,
    pub user_id: String,
    pub amount: i64,
    pub reason: Option<String>,
    pub created_at: String,
}

// ── Economy request models ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTradeRequest {
    pub receiver_id: String,
    pub offered_item_ids: Vec<String>,
    pub requested_item_ids: Vec<String>,
    pub sender_coins: i64,
    pub receiver_coins: i64,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateListingRequest {
    pub inventory_id: String,
    pub price_coins: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CraftRequest {
    pub inventory_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquipItemRequest {
    pub equipped: bool,
}
