use serde::Serialize;

use crate::models::{Attachment, Channel, DmMessage, Message, QueueItem, VoiceParticipant};

use super::ActivityInfo;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerEvent {
    Message {
        message: Message,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        attachments: Vec<Attachment>,
    },
    MessageEdit {
        #[serde(rename = "messageId")]
        message_id: String,
        content: String,
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
        status: String,
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
    MessageDelete {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    DmMessage {
        message: DmMessage,
    },
    MemberJoined {
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        username: String,
        image: Option<String>,
        role: String,
        #[serde(rename = "ringStyle")]
        ring_style: String,
        #[serde(rename = "ringSpin")]
        ring_spin: bool,
        #[serde(skip_serializing_if = "Option::is_none", rename = "ringPatternSeed")]
        ring_pattern_seed: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "bannerCss")]
        banner_css: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "bannerPatternSeed")]
        banner_pattern_seed: Option<i64>,
    },
    ChannelUpdate {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        bitrate: Option<i64>,
    },
    ProfileUpdate {
        #[serde(rename = "userId")]
        user_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        image: Option<Option<String>>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "ringStyle")]
        ring_style: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "ringSpin")]
        ring_spin: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "ringPatternSeed")]
        ring_pattern_seed: Option<Option<i64>>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "bannerCss")]
        banner_css: Option<Option<String>>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "bannerPatternSeed")]
        banner_pattern_seed: Option<Option<i64>>,
    },
    ActivityUpdate {
        #[serde(rename = "userId")]
        user_id: String,
        activity: Option<ActivityInfo>,
    },
    ServerUpdated {
        #[serde(rename = "serverId")]
        server_id: String,
        name: String,
    },
    ServerDeleted {
        #[serde(rename = "serverId")]
        server_id: String,
    },
    MemberRoleUpdated {
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        role: String,
    },
    MemberLeft {
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "userId")]
        user_id: String,
    },
    ServerKeyShared {
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "encryptedKey")]
        encrypted_key: String,
        #[serde(rename = "senderId")]
        sender_id: String,
    },
    ServerKeyRequested {
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "userId")]
        user_id: String,
    },
    SpotifyQueueUpdate {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "voiceChannelId")]
        voice_channel_id: String,
        #[serde(rename = "queueItem")]
        queue_item: QueueItem,
    },
    SpotifyPlaybackSync {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "voiceChannelId")]
        voice_channel_id: String,
        action: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "trackUri")]
        track_uri: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "positionMs")]
        position_ms: Option<i64>,
        source: String,
    },
    SpotifyQueueRemove {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "voiceChannelId")]
        voice_channel_id: String,
        #[serde(rename = "itemId")]
        item_id: String,
    },
    SpotifySessionEnded {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "voiceChannelId")]
        voice_channel_id: String,
    },
    SoundboardPlay {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "soundId")]
        sound_id: String,
        #[serde(rename = "audioAttachmentId")]
        audio_attachment_id: String,
        #[serde(rename = "audioFilename")]
        audio_filename: String,
        volume: f64,
        username: String,
    },
    RoomCreated {
        channel: Channel,
    },
    RoomDeleted {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "serverId")]
        server_id: String,
    },
    RoomLockToggled {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "serverId")]
        server_id: String,
        #[serde(rename = "isLocked")]
        is_locked: bool,
    },
    RoomKnock {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "userId")]
        user_id: String,
        username: String,
    },
    RoomKnockAccepted {
        #[serde(rename = "channelId")]
        channel_id: String,
    },
    RoomInvite {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "channelName")]
        channel_name: String,
        #[serde(rename = "inviterId")]
        inviter_id: String,
        #[serde(rename = "inviterUsername")]
        inviter_username: String,
        #[serde(rename = "serverId")]
        server_id: String,
    },
    RoomForceMove {
        #[serde(rename = "targetChannelId")]
        target_channel_id: String,
        #[serde(rename = "targetChannelName")]
        target_channel_name: String,
    },
    Error {
        message: String,
    },
}
