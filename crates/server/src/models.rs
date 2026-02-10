use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub user: SessionUser,
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
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub channel_id: String,
    pub sender_id: String,
    pub ciphertext: String,
    pub mls_epoch: i64,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedResponse<T: Serialize> {
    pub items: Vec<T>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    pub bitrate: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelRequest {
    pub name: Option<String>,
    pub bitrate: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinServerRequest {
    pub invite_code: String,
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

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub username: Option<String>,
    pub image: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: String,
    pub username: String,
}
