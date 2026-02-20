use serde::{Deserialize, Serialize};

use crate::models::{Attachment, Channel, DmMessage, Message, QueueItem, VoiceParticipant};

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
        action: String, // "play" | "pause" | "skip" | "seek"
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
        status: String, // "online" | "idle" | "dnd" | "invisible"
    },
    PlaySound {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "soundId")]
        sound_id: String,
    },
    Ping,
}

// ── Server → Client Events ──

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
        #[serde(rename = "imageAttachmentId", skip_serializing_if = "Option::is_none")]
        image_attachment_id: Option<String>,
        #[serde(rename = "imageFilename", skip_serializing_if = "Option::is_none")]
        image_filename: Option<String>,
        volume: f64,
        username: String,
    },
    // Room events
    RoomCreated {
        channel: Channel,
    },
    RoomDeleted {
        #[serde(rename = "channelId")]
        channel_id: String,
        #[serde(rename = "serverId")]
        server_id: String,
    },
    // Economy events
    CaseOpened {
        #[serde(rename = "userId")]
        user_id: String,
        username: String,
        #[serde(rename = "itemName")]
        item_name: String,
        #[serde(rename = "itemRarity")]
        item_rarity: String,
        #[serde(rename = "caseName")]
        case_name: String,
    },
    TradeOfferReceived {
        #[serde(rename = "tradeId")]
        trade_id: String,
        #[serde(rename = "senderId")]
        sender_id: String,
        #[serde(rename = "senderUsername")]
        sender_username: String,
    },
    TradeResolved {
        #[serde(rename = "tradeId")]
        trade_id: String,
        status: String,
    },
    CoinsEarned {
        #[serde(rename = "userId")]
        user_id: String,
        amount: i64,
        reason: String,
        #[serde(rename = "newBalance")]
        new_balance: i64,
    },
    Error {
        message: String,
    },
}

fn default_source_str() -> String {
    "spotify".to_string()
}
