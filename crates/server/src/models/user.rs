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
pub struct SetPublicKeyRequest {
    pub public_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreServerKeyRequest {
    pub encrypted_key: String,
    pub sender_id: String,
}
