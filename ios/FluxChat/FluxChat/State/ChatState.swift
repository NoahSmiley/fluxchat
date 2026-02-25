import CryptoKit
import SwiftUI

/// Manages all chat-related state: servers, channels, messages, typing indicators,
/// presence, reactions, DMs, and member lists. Acts as the central hub for
/// real-time data flowing from the WebSocket via EventRouter, as well as
/// data fetched from REST endpoints.
@Observable
final class ChatState {

    // MARK: - Server Data

    var servers: [Server] = []
    var selectedServerId: String?
    var channelsByServer: [String: [Channel]] = [:]   // serverId -> channels
    var membersByServer: [String: [Member]] = [:]     // serverId -> members

    // MARK: - Active Channel

    var selectedChannelId: String?
    var messages: [Message] = []        // current channel messages
    var hasMoreMessages = false
    var messageCursor: String?
    var isLoadingMessages = false

    // MARK: - Reactions: messageId -> [(emoji, [userId])]

    var reactions: [String: [(emoji: String, userIds: [String])]] = [:]

    // MARK: - Typing

    var typingUsers: [String: Set<String>] = [:]  // channelId -> userIds

    // MARK: - Presence

    var onlineUsers: Set<String> = []
    var activities: [String: ActivityInfo] = [:]

    // MARK: - Voice State from WS

    var channelParticipants: [String: [VoiceParticipant]] = [:]

    // MARK: - Unread

    var unreadChannels: Set<String> = []

    // MARK: - DMs

    var showingDMs = false
    var dmChannels: [DMChannel] = []
    var selectedDMChannelId: String?
    var dmMessages: [DMMessage] = []
    var dmHasMore = false
    var dmCursor: String?

    // MARK: - Per-Channel Message Cache

    /// Stores messages, cursor, hasMore, and reactions per channel so switching
    /// back to a previously viewed channel is instant.
    private var channelMessageCache: [String: ChannelCache] = [:]

    private struct ChannelCache {
        var messages: [Message]
        var cursor: String?
        var hasMore: Bool
        var reactions: [String: [(emoji: String, userIds: [String])]]
    }

    // MARK: - WebSocket Reference

    /// Set by MainView after auth so ChatState can send client events.
    var ws: FluxWebSocket?

    // =========================================================================
    // MARK: - Server & Channel Loading
    // =========================================================================

    /// Fetch all servers, then load channels and members for each.
    func loadServers() async {
        do {
            let fetched = try await ServerAPI.getServers()
            await MainActor.run { self.servers = fetched }

            // Load channels + members for each server in parallel
            await withTaskGroup(of: Void.self) { group in
                for server in fetched {
                    group.addTask { [weak self] in
                        await self?.loadChannels(serverId: server.id)
                        await self?.loadMembers(serverId: server.id)
                    }
                }
            }

            // Auto-select first server if none selected
            if selectedServerId == nil, let first = fetched.first {
                await selectServer(first.id)
            }
        } catch {
            print("[ChatState] loadServers error: \(error.localizedDescription)")
        }
    }

    func loadChannels(serverId: String) async {
        do {
            let channels = try await ServerAPI.getChannels(serverId: serverId)
            await MainActor.run {
                self.channelsByServer[serverId] = channels.sorted { $0.position < $1.position }
            }
        } catch {
            print("[ChatState] loadChannels error: \(error.localizedDescription)")
        }
    }

    func loadMembers(serverId: String) async {
        do {
            let members = try await ServerAPI.getMembers(serverId: serverId)
            await MainActor.run {
                self.membersByServer[serverId] = members
            }
        } catch {
            print("[ChatState] loadMembers error: \(error.localizedDescription)")
        }
    }

    func selectServer(_ serverId: String) async {
        guard serverId != selectedServerId else { return }

        // Save current channel state to cache
        saveCurrentChannelToCache()

        await MainActor.run {
            self.selectedServerId = serverId
            self.selectedChannelId = nil
            self.messages = []
            self.reactions = [:]
            self.hasMoreMessages = false
            self.messageCursor = nil
        }
    }

    func selectChannel(_ channelId: String) async {
        guard channelId != selectedChannelId else { return }

        // Leave old channel on WS
        if let old = selectedChannelId {
            ws?.send(.leaveChannel(channelId: old))
        }

        // Save current channel state to cache
        saveCurrentChannelToCache()

        // Check if we have cached data for the new channel
        if let cached = channelMessageCache[channelId] {
            await MainActor.run {
                self.selectedChannelId = channelId
                self.messages = cached.messages
                self.messageCursor = cached.cursor
                self.hasMoreMessages = cached.hasMore
                self.reactions = cached.reactions
                self.unreadChannels.remove(channelId)
            }
        } else {
            await MainActor.run {
                self.selectedChannelId = channelId
                self.messages = []
                self.reactions = [:]
                self.hasMoreMessages = false
                self.messageCursor = nil
                self.unreadChannels.remove(channelId)
            }
            await loadMessages(channelId: channelId)
        }

        // Join new channel on WS
        ws?.send(.joinChannel(channelId: channelId))
    }

    // MARK: - Cache Helpers

    private func saveCurrentChannelToCache() {
        guard let channelId = selectedChannelId, !messages.isEmpty else { return }
        channelMessageCache[channelId] = ChannelCache(
            messages: messages,
            cursor: messageCursor,
            hasMore: hasMoreMessages,
            reactions: reactions
        )
    }

    // =========================================================================
    // MARK: - Messages
    // =========================================================================

    func loadMessages(channelId: String, cursor: String? = nil) async {
        guard !isLoadingMessages else { return }

        await MainActor.run { self.isLoadingMessages = true }

        do {
            let page = try await MessageAPI.getMessages(
                channelId: channelId,
                cursor: cursor,
                limit: Config.messagesPageSize
            )

            // Fetch reactions for these messages
            let messageIds = page.items.map(\.id)
            var reactionMap: [String: [(emoji: String, userIds: [String])]] = [:]
            if !messageIds.isEmpty {
                let rxns = try await MessageAPI.getReactions(messageIds: messageIds)
                reactionMap = Self.groupReactions(rxns)
            }

            await MainActor.run {
                if cursor == nil {
                    // Initial load: items come newest-first from API, reverse for display
                    self.messages = page.items.reversed()
                } else {
                    // Pagination: prepend older messages
                    self.messages = page.items.reversed() + self.messages
                }
                self.messageCursor = page.cursor
                self.hasMoreMessages = page.hasMore

                // Merge reactions
                for (msgId, groups) in reactionMap {
                    self.reactions[msgId] = groups
                }

                self.isLoadingMessages = false
            }
        } catch {
            print("[ChatState] loadMessages error: \(error.localizedDescription)")
            await MainActor.run { self.isLoadingMessages = false }
        }
    }

    func loadMoreMessages() async {
        guard hasMoreMessages, !isLoadingMessages, let channelId = selectedChannelId else { return }
        await loadMessages(channelId: channelId, cursor: messageCursor)
    }

    /// Send a plaintext message via WebSocket.
    func sendMessage(_ text: String, channelId: String, attachmentIds: [String] = []) async {
        let content = text.isEmpty && !attachmentIds.isEmpty ? " " : text
        guard !content.isEmpty else { return }
        ws?.send(.sendMessage(
            channelId: channelId,
            content: content,
            attachmentIds: attachmentIds.isEmpty ? nil : attachmentIds
        ))
    }

    func editMessage(_ messageId: String, newText: String) async {
        guard !newText.isEmpty else { return }
        ws?.send(.editMessage(messageId: messageId, content: newText))
    }

    func deleteMessage(_ messageId: String) {
        ws?.send(.deleteMessage(messageId: messageId))
    }

    /// Return the plaintext content for a channel message.
    func decryptedText(for message: Message) -> String {
        return message.content
    }

    // MARK: - Typing

    func startTyping(channelId: String) {
        ws?.send(.typingStart(channelId: channelId))
    }

    func stopTyping(channelId: String) {
        ws?.send(.typingStop(channelId: channelId))
    }

    // MARK: - Reactions

    func addReaction(messageId: String, emoji: String) {
        ws?.send(.addReaction(messageId: messageId, emoji: emoji))
    }

    func removeReaction(messageId: String, emoji: String) {
        ws?.send(.removeReaction(messageId: messageId, emoji: emoji))
    }

    // =========================================================================
    // MARK: - DMs
    // =========================================================================

    func loadDMChannels() async {
        do {
            let channels = try await DMAPI.getDMChannels()
            await MainActor.run {
                self.dmChannels = channels
            }
        } catch {
            print("[ChatState] loadDMChannels error: \(error.localizedDescription)")
        }
    }

    func selectDM(_ dmChannelId: String) async {
        // Leave old DM
        if let old = selectedDMChannelId {
            ws?.send(.leaveDM(dmChannelId: old))
        }

        await MainActor.run {
            self.selectedDMChannelId = dmChannelId
            self.dmMessages = []
            self.dmHasMore = false
            self.dmCursor = nil
        }

        do {
            let page = try await DMAPI.getDMMessages(dmChannelId: dmChannelId)
            await MainActor.run {
                self.dmMessages = page.items.reversed()
                self.dmCursor = page.cursor
                self.dmHasMore = page.hasMore
            }
        } catch {
            print("[ChatState] selectDM error: \(error.localizedDescription)")
        }

        ws?.send(.joinDM(dmChannelId: dmChannelId))
    }

    func sendDM(_ plaintext: String, dmChannelId: String, key: SymmetricKey) async {
        do {
            let ciphertext = try MessageCrypto.encrypt(plaintext, key: key)
            ws?.send(.sendDM(dmChannelId: dmChannelId, ciphertext: ciphertext, mlsEpoch: 1))
        } catch {
            print("[ChatState] sendDM encrypt error: \(error.localizedDescription)")
        }
    }

    // =========================================================================
    // MARK: - WS Event Handlers (called by EventRouter)
    // =========================================================================

    func handleNewMessage(_ payload: ServerMessage) {
        // Merge attachments from the sibling field into the message
        let msg: Message
        if let attachments = payload.attachments, !attachments.isEmpty {
            msg = Message(
                id: payload.message.id,
                channelId: payload.message.channelId,
                senderId: payload.message.senderId,
                content: payload.message.content,
                createdAt: payload.message.createdAt,
                editedAt: payload.message.editedAt,
                attachments: attachments
            )
        } else {
            msg = payload.message
        }

        if msg.channelId == selectedChannelId {
            messages.append(msg)
        } else {
            unreadChannels.insert(msg.channelId)
            if var cache = channelMessageCache[msg.channelId] {
                cache.messages.append(msg)
                channelMessageCache[msg.channelId] = cache
            }
        }
    }

    func handleMessageEdit(_ edit: MessageEdit) {
        if let idx = messages.firstIndex(where: { $0.id == edit.messageId }) {
            let old = messages[idx]
            let updated = Message(
                id: old.id,
                channelId: old.channelId,
                senderId: old.senderId,
                content: edit.content,
                createdAt: old.createdAt,
                editedAt: edit.editedAt,
                attachments: old.attachments
            )
            messages[idx] = updated
        }
    }

    func handleMessageDelete(_ del: MessageDelete) {
        messages.removeAll { $0.id == del.messageId }
        reactions.removeValue(forKey: del.messageId)
    }

    func handleTyping(_ event: TypingEvent) {
        if event.active {
            typingUsers[event.channelId, default: []].insert(event.userId)
            // Auto-remove after 3 seconds
            let channelId = event.channelId
            let userId = event.userId
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(3))
                self.typingUsers[channelId]?.remove(userId)
            }
        } else {
            typingUsers[event.channelId]?.remove(event.userId)
        }
    }

    func handlePresence(_ event: PresenceEvent) {
        if event.status == "online" {
            onlineUsers.insert(event.userId)
        } else {
            onlineUsers.remove(event.userId)
        }
    }

    func handleVoiceState(_ event: VoiceStateEvent) {
        channelParticipants[event.channelId] = event.participants
    }

    func handleReactionAdd(_ event: ReactionEvent) {
        var groups = reactions[event.messageId] ?? []
        if let idx = groups.firstIndex(where: { $0.emoji == event.emoji }) {
            if !groups[idx].userIds.contains(event.userId) {
                groups[idx].userIds.append(event.userId)
            }
        } else {
            groups.append((emoji: event.emoji, userIds: [event.userId]))
        }
        reactions[event.messageId] = groups
    }

    func handleReactionRemove(_ event: ReactionEvent) {
        guard var groups = reactions[event.messageId] else { return }
        if let idx = groups.firstIndex(where: { $0.emoji == event.emoji }) {
            groups[idx].userIds.removeAll { $0 == event.userId }
            if groups[idx].userIds.isEmpty {
                groups.remove(at: idx)
            }
        }
        reactions[event.messageId] = groups.isEmpty ? nil : groups
    }

    func handleDMMessage(_ event: DMMessageEvent) {
        let msg = event.message
        if msg.dmChannelId == selectedDMChannelId {
            dmMessages.append(msg)
        }
        // TODO: mark DM channel as unread if not selected
    }

    func handleMemberJoined(_ event: MemberJoinedEvent) {
        let member = Member(
            userId: event.userId,
            serverId: event.serverId,
            role: MemberRole(rawValue: event.role) ?? .member,
            joinedAt: nil,
            roleUpdatedAt: nil,
            username: event.username,
            image: event.image,
            ringStyle: event.ringStyle,
            ringSpin: event.ringSpin,
            steamId: nil,
            ringPatternSeed: event.ringPatternSeed,
            bannerCss: event.bannerCss,
            bannerPatternSeed: event.bannerPatternSeed
        )
        membersByServer[event.serverId, default: []].append(member)
    }

    func handleMemberLeft(_ event: MemberLeftEvent) {
        membersByServer[event.serverId]?.removeAll { $0.userId == event.userId }
    }

    func handleMemberRoleUpdated(_ event: MemberRoleUpdatedEvent) {
        guard var members = membersByServer[event.serverId],
              let idx = members.firstIndex(where: { $0.userId == event.userId }) else { return }
        let old = members[idx]
        members[idx] = Member(
            userId: old.userId,
            serverId: old.serverId,
            role: MemberRole(rawValue: event.role) ?? old.role,
            joinedAt: old.joinedAt,
            roleUpdatedAt: nil,
            username: old.username,
            image: old.image,
            ringStyle: old.ringStyle,
            ringSpin: old.ringSpin,
            steamId: old.steamId,
            ringPatternSeed: old.ringPatternSeed,
            bannerCss: old.bannerCss,
            bannerPatternSeed: old.bannerPatternSeed
        )
        membersByServer[event.serverId] = members
    }

    func handleProfileUpdate(_ event: ProfileUpdateEvent) {
        // Update member data across all servers
        for serverId in membersByServer.keys {
            guard var members = membersByServer[serverId],
                  let idx = members.firstIndex(where: { $0.userId == event.userId }) else { continue }
            let old = members[idx]
            members[idx] = Member(
                userId: old.userId,
                serverId: old.serverId,
                role: old.role,
                joinedAt: old.joinedAt,
                roleUpdatedAt: old.roleUpdatedAt,
                username: event.username,
                image: event.image,
                ringStyle: event.ringStyle,
                ringSpin: event.ringSpin,
                steamId: old.steamId,
                ringPatternSeed: event.ringPatternSeed,
                bannerCss: event.bannerCss,
                bannerPatternSeed: event.bannerPatternSeed
            )
            membersByServer[serverId] = members
        }
    }

    func handleActivityUpdate(_ event: ActivityUpdateEvent) {
        activities[event.userId] = event.activity
    }

    func handleChannelUpdate(_ event: ChannelUpdateEvent) {
        // Update channel bitrate across all servers
        for serverId in channelsByServer.keys {
            guard var channels = channelsByServer[serverId],
                  let idx = channels.firstIndex(where: { $0.id == event.channelId }) else { continue }
            let old = channels[idx]
            channels[idx] = Channel(
                id: old.id,
                serverId: old.serverId,
                name: old.name,
                type: old.type,
                bitrate: event.bitrate ?? old.bitrate,
                parentId: old.parentId,
                position: old.position,
                createdAt: old.createdAt
            )
            channelsByServer[serverId] = channels
        }
    }

    func handleServerUpdated(_ event: ServerUpdatedEvent) {
        if let idx = servers.firstIndex(where: { $0.id == event.serverId }) {
            let old = servers[idx]
            servers[idx] = Server(
                id: old.id,
                name: event.name,
                ownerId: old.ownerId,
                inviteCode: old.inviteCode,
                createdAt: old.createdAt,
                role: old.role
            )
        }
    }

    // =========================================================================
    // MARK: - Helpers
    // =========================================================================

    /// Look up a member's username across all servers.
    func username(for userId: String) -> String {
        for members in membersByServer.values {
            if let member = members.first(where: { $0.userId == userId }) {
                return member.username
            }
        }
        return "Unknown"
    }

    /// Look up a member by userId in the current server.
    func member(for userId: String) -> Member? {
        guard let serverId = selectedServerId else { return nil }
        return membersByServer[serverId]?.first { $0.userId == userId }
    }

    /// Group a flat list of Reaction objects into a per-message dictionary.
    private static func groupReactions(
        _ reactions: [Reaction]
    ) -> [String: [(emoji: String, userIds: [String])]] {
        var result: [String: [(emoji: String, userIds: [String])]] = [:]
        for r in reactions {
            var groups = result[r.messageId] ?? []
            if let idx = groups.firstIndex(where: { $0.emoji == r.emoji }) {
                groups[idx].userIds.append(r.userId)
            } else {
                groups.append((emoji: r.emoji, userIds: [r.userId]))
            }
            result[r.messageId] = groups
        }
        return result
    }
}
