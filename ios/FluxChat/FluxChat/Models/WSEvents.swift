import Foundation

// MARK: - Activity Info

struct ActivityInfo: Codable {
    let name: String
    let activityType: String
    let artist: String?
    let albumArt: String?
    let durationMs: Int?
    let progressMs: Int?
}

// MARK: - Client -> Server Events

enum WSClientEvent {
    case sendMessage(channelId: String, ciphertext: String, mlsEpoch: Int, attachmentIds: [String]?)
    case editMessage(messageId: String, ciphertext: String)
    case deleteMessage(messageId: String)
    case typingStart(channelId: String)
    case typingStop(channelId: String)
    case joinChannel(channelId: String)
    case leaveChannel(channelId: String)
    case voiceStateUpdate(channelId: String, action: String)
    case voiceDrinkUpdate(channelId: String, drinkCount: Int)
    case addReaction(messageId: String, emoji: String)
    case removeReaction(messageId: String, emoji: String)
    case joinDM(dmChannelId: String)
    case leaveDM(dmChannelId: String)
    case sendDM(dmChannelId: String, ciphertext: String, mlsEpoch: Int)
    case updateActivity(activity: ActivityInfo?)
    case shareServerKey(serverId: String, userId: String, encryptedKey: String)
    case requestServerKey(serverId: String)
    case ping
}

extension WSClientEvent: Encodable {

    private enum CodingKeys: String, CodingKey {
        case type
        case channelId
        case ciphertext
        case mlsEpoch
        case attachmentIds
        case messageId
        case emoji
        case action
        case drinkCount
        case dmChannelId
        case activity
        case serverId
        case userId
        case encryptedKey
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .sendMessage(let channelId, let ciphertext, let mlsEpoch, let attachmentIds):
            try container.encode("send_message", forKey: .type)
            try container.encode(channelId, forKey: .channelId)
            try container.encode(ciphertext, forKey: .ciphertext)
            try container.encode(mlsEpoch, forKey: .mlsEpoch)
            try container.encodeIfPresent(attachmentIds, forKey: .attachmentIds)

        case .editMessage(let messageId, let ciphertext):
            try container.encode("edit_message", forKey: .type)
            try container.encode(messageId, forKey: .messageId)
            try container.encode(ciphertext, forKey: .ciphertext)

        case .deleteMessage(let messageId):
            try container.encode("delete_message", forKey: .type)
            try container.encode(messageId, forKey: .messageId)

        case .typingStart(let channelId):
            try container.encode("typing_start", forKey: .type)
            try container.encode(channelId, forKey: .channelId)

        case .typingStop(let channelId):
            try container.encode("typing_stop", forKey: .type)
            try container.encode(channelId, forKey: .channelId)

        case .joinChannel(let channelId):
            try container.encode("join_channel", forKey: .type)
            try container.encode(channelId, forKey: .channelId)

        case .leaveChannel(let channelId):
            try container.encode("leave_channel", forKey: .type)
            try container.encode(channelId, forKey: .channelId)

        case .voiceStateUpdate(let channelId, let action):
            try container.encode("voice_state_update", forKey: .type)
            try container.encode(channelId, forKey: .channelId)
            try container.encode(action, forKey: .action)

        case .voiceDrinkUpdate(let channelId, let drinkCount):
            try container.encode("voice_drink_update", forKey: .type)
            try container.encode(channelId, forKey: .channelId)
            try container.encode(drinkCount, forKey: .drinkCount)

        case .addReaction(let messageId, let emoji):
            try container.encode("add_reaction", forKey: .type)
            try container.encode(messageId, forKey: .messageId)
            try container.encode(emoji, forKey: .emoji)

        case .removeReaction(let messageId, let emoji):
            try container.encode("remove_reaction", forKey: .type)
            try container.encode(messageId, forKey: .messageId)
            try container.encode(emoji, forKey: .emoji)

        case .joinDM(let dmChannelId):
            try container.encode("join_dm", forKey: .type)
            try container.encode(dmChannelId, forKey: .dmChannelId)

        case .leaveDM(let dmChannelId):
            try container.encode("leave_dm", forKey: .type)
            try container.encode(dmChannelId, forKey: .dmChannelId)

        case .sendDM(let dmChannelId, let ciphertext, let mlsEpoch):
            try container.encode("send_dm", forKey: .type)
            try container.encode(dmChannelId, forKey: .dmChannelId)
            try container.encode(ciphertext, forKey: .ciphertext)
            try container.encode(mlsEpoch, forKey: .mlsEpoch)

        case .updateActivity(let activity):
            try container.encode("update_activity", forKey: .type)
            try container.encodeIfPresent(activity, forKey: .activity)

        case .shareServerKey(let serverId, let userId, let encryptedKey):
            try container.encode("share_server_key", forKey: .type)
            try container.encode(serverId, forKey: .serverId)
            try container.encode(userId, forKey: .userId)
            try container.encode(encryptedKey, forKey: .encryptedKey)

        case .requestServerKey(let serverId):
            try container.encode("request_server_key", forKey: .type)
            try container.encode(serverId, forKey: .serverId)

        case .ping:
            try container.encode("ping", forKey: .type)
        }
    }
}

// MARK: - Server -> Client Event Payloads

struct ServerMessage: Codable {
    let message: Message
    let attachments: [Attachment]?
}

struct MessageEdit: Codable {
    let messageId: String
    let ciphertext: String
    let editedAt: String
}

struct MessageDelete: Codable {
    let messageId: String
    let channelId: String
}

struct TypingEvent: Codable {
    let channelId: String
    let userId: String
    let active: Bool
}

struct PresenceEvent: Codable {
    let userId: String
    let status: String
}

struct VoiceStateEvent: Codable {
    let channelId: String
    let participants: [VoiceParticipant]
}

struct VoiceParticipant: Codable, Identifiable {
    var id: String { userId }

    let userId: String
    let username: String
    let drinkCount: Int

    private enum CodingKeys: String, CodingKey {
        case userId, username, drinkCount
    }
}

struct ReactionEvent: Codable {
    let messageId: String
    let userId: String
    let emoji: String
}

struct DMMessageEvent: Codable {
    let message: DMMessage
}

struct MemberJoinedEvent: Codable {
    let serverId: String
    let userId: String
    let username: String
    let image: String?
    let role: String
    let ringStyle: String?
    let ringSpin: Bool?
    let ringPatternSeed: Int?
    let bannerCss: String?
    let bannerPatternSeed: Int?
}

struct MemberLeftEvent: Codable {
    let serverId: String
    let userId: String
}

struct MemberRoleUpdatedEvent: Codable {
    let serverId: String
    let userId: String
    let role: String
}

struct ChannelUpdateEvent: Codable {
    let channelId: String
    let bitrate: Int?
}

struct ProfileUpdateEvent: Codable {
    let userId: String
    let username: String
    let image: String?
    let ringStyle: String?
    let ringSpin: Bool?
    let ringPatternSeed: Int?
    let bannerCss: String?
    let bannerPatternSeed: Int?
}

struct ActivityUpdateEvent: Codable {
    let userId: String
    let activity: ActivityInfo?
}

struct ServerUpdatedEvent: Codable {
    let serverId: String
    let name: String
}

struct ServerKeySharedEvent: Codable {
    let serverId: String
    let encryptedKey: String
    let senderId: String
}

struct ServerKeyRequestedEvent: Codable {
    let serverId: String
    let userId: String
}

// MARK: - Server -> Client Events

enum WSServerEvent {
    case message(ServerMessage)
    case messageEdit(MessageEdit)
    case messageDelete(MessageDelete)
    case typing(TypingEvent)
    case presence(PresenceEvent)
    case voiceState(VoiceStateEvent)
    case reactionAdd(ReactionEvent)
    case reactionRemove(ReactionEvent)
    case dmMessage(DMMessageEvent)
    case memberJoined(MemberJoinedEvent)
    case memberLeft(MemberLeftEvent)
    case memberRoleUpdated(MemberRoleUpdatedEvent)
    case channelUpdate(ChannelUpdateEvent)
    case profileUpdate(ProfileUpdateEvent)
    case activityUpdate(ActivityUpdateEvent)
    case serverUpdated(ServerUpdatedEvent)
    case serverKeyShared(ServerKeySharedEvent)
    case serverKeyRequested(ServerKeyRequestedEvent)
    case error(String)
    case unknown(String)
}

extension WSServerEvent: Decodable {

    private enum CodingKeys: String, CodingKey {
        case type
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        // Use a single-value container backed by the same decoder
        // so each payload struct can pull its keys from the top level.
        let singleValue = try decoder.singleValueContainer()

        switch type {
        case "message":
            self = .message(try singleValue.decode(ServerMessage.self))

        case "message_edit":
            self = .messageEdit(try singleValue.decode(MessageEdit.self))

        case "message_delete":
            self = .messageDelete(try singleValue.decode(MessageDelete.self))

        case "typing":
            self = .typing(try singleValue.decode(TypingEvent.self))

        case "presence":
            self = .presence(try singleValue.decode(PresenceEvent.self))

        case "voice_state":
            self = .voiceState(try singleValue.decode(VoiceStateEvent.self))

        case "reaction_add":
            self = .reactionAdd(try singleValue.decode(ReactionEvent.self))

        case "reaction_remove":
            self = .reactionRemove(try singleValue.decode(ReactionEvent.self))

        case "dm_message":
            self = .dmMessage(try singleValue.decode(DMMessageEvent.self))

        case "member_joined":
            self = .memberJoined(try singleValue.decode(MemberJoinedEvent.self))

        case "member_left":
            self = .memberLeft(try singleValue.decode(MemberLeftEvent.self))

        case "member_role_updated":
            self = .memberRoleUpdated(try singleValue.decode(MemberRoleUpdatedEvent.self))

        case "channel_update":
            self = .channelUpdate(try singleValue.decode(ChannelUpdateEvent.self))

        case "profile_update":
            self = .profileUpdate(try singleValue.decode(ProfileUpdateEvent.self))

        case "activity_update":
            self = .activityUpdate(try singleValue.decode(ActivityUpdateEvent.self))

        case "server_updated":
            self = .serverUpdated(try singleValue.decode(ServerUpdatedEvent.self))

        case "server_key_shared":
            self = .serverKeyShared(try singleValue.decode(ServerKeySharedEvent.self))

        case "server_key_requested":
            self = .serverKeyRequested(try singleValue.decode(ServerKeyRequestedEvent.self))

        case "error":
            let message = try container.decode(String.self, forKey: .message)
            self = .error(message)

        default:
            // Capture raw JSON for any unrecognized event type so callers
            // can log or inspect it without crashing.
            if let rawData = try? JSONSerialization.data(
                withJSONObject: try decoder.singleValueContainer().decode([String: AnyCodable].self),
                options: [.sortedKeys]
            ), let rawString = String(data: rawData, encoding: .utf8) {
                self = .unknown(rawString)
            } else {
                self = .unknown("{\"type\":\"\(type)\"}")
            }
        }
    }
}

// MARK: - AnyCodable Helper

/// A type-erased Codable wrapper used to capture arbitrary JSON for unknown
/// WebSocket event types. This is intentionally limited to decoding -- we only
/// need it to round-trip unrecognized payloads into a raw JSON string.
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "AnyCodable could not decode value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(
                value,
                EncodingError.Context(
                    codingPath: container.codingPath,
                    debugDescription: "AnyCodable could not encode value"
                )
            )
        }
    }
}
