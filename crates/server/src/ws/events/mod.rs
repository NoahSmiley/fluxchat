mod server_event;

pub use server_event::ServerEvent;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityInfo {
    pub name: String,
    #[serde(rename = "activityType")]
    pub activity_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "albumArt")]
    pub album_art: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "durationMs")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "progressMs")]
    pub progress_ms: Option<i64>,
}

// ── Client → Server Events ──

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    SendMessage {
        #[serde(rename = "channelId")]
        channel_id: String,
        content: String,
        #[serde(default, rename = "attachmentIds")]
        attachment_ids: Vec<String>,
    },
    EditMessage {
        #[serde(rename = "messageId")]
        message_id: String,
        content: String,
    },
    TypingStart {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    TypingStop {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    JoinChannel {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    LeaveChannel {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    VoiceStateUpdate {
        #[serde(rename = "channelId")]
        channel_id: String,
        action: String,
    },
    AddReaction {
        #[serde(rename = "messageId")]
        message_id: String,
        emoji: String,
    },
    RemoveReaction {
        #[serde(rename = "messageId")]
        message_id: String,
        emoji: String,
    },
    SendDm {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
        ciphertext: String,
        #[serde(rename = "mlsEpoch")]
        mls_epoch: i64,
    },
    DeleteMessage {
        #[serde(rename = "messageId")]
        message_id: String,
    },
    JoinDm {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    LeaveDm {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    UpdateActivity {
        activity: Option<ActivityInfo>,
    },
    ShareServerKey {
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        #[serde(rename = "encryptedKey")]
        encrypted_key: String,
    },
    RequestServerKey {
        #[serde(rename = "serverId")]
        server_id: String,
    },
    SpotifyPlaybackControl {
        #[serde(rename = "sessionId")]
        session_id: String,
        action: String,
        #[serde(rename = "trackUri")]
        track_uri: Option<String>,
        #[serde(rename = "positionMs")]
        position_ms: Option<i64>,
        #[serde(default = "default_source_str")]
        source: String,
    },
    VoiceDrinkUpdate {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "drinkCount")]
        drink_count: i32,
    },
    UpdateStatus {
        status: String,
    },
    PlaySound {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "soundId")]
        sound_id: String,
    },
    RoomKnock {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    Ping,
}

fn default_source_str() -> String {
    "spotify".to_string()
}
