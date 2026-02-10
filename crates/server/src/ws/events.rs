use serde::{Deserialize, Serialize};

use crate::models::{DmMessage, Message, VoiceParticipant};

// ── Client → Server Events ──

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientEvent {
    SendMessage {
        #[serde(rename = "channelId")]
        channel_id: String,
        ciphertext: String,
        #[serde(rename = "mlsEpoch")]
        mls_epoch: i64,
    },
    EditMessage {
        #[serde(rename = "messageId")]
        message_id: String,
        ciphertext: String,
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
        action: String, // "join" | "leave"
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
    JoinDm {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    LeaveDm {
        #[serde(rename = "dmChannelId")]
        dm_channel_id: String,
    },
    Ping,
}

// ── Server → Client Events ──

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEvent {
    Message {
        message: Message,
    },
    MessageEdit {
        #[serde(rename = "messageId")]
        message_id: String,
        ciphertext: String,
        #[serde(rename = "editedAt")]
        edited_at: String,
    },
    Typing {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        active: bool,
    },
    Presence {
        #[serde(rename = "userId")]
        user_id: String,
        status: String, // "online" | "offline"
    },
    VoiceState {
        #[serde(rename = "channelId")]
        channel_id: String,
        participants: Vec<VoiceParticipant>,
    },
    ReactionAdd {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        emoji: String,
    },
    ReactionRemove {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        emoji: String,
    },
    DmMessage {
        message: DmMessage,
    },
    Error {
        message: String,
    },
}
