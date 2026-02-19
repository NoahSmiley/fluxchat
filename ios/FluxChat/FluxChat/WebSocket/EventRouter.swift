import Foundation

/// Routes incoming `WSServerEvent`s from the WebSocket to the appropriate
/// state objects. Start this once the user is authenticated and the WebSocket
/// is connected.
@Observable
final class EventRouter {

    private var routingTask: Task<Void, Never>?

    // MARK: - Public API

    /// Begin consuming events from the given `FluxWebSocket` and dispatching
    /// them to the provided state managers.
    ///
    /// Call this once from `ContentView` (or a coordinator) after the user has
    /// authenticated. The router keeps running until `stop()` is called or the
    /// event stream terminates.
    func start(ws: FluxWebSocket, chatState: ChatState, cryptoState: CryptoState, voiceState: VoiceState) {
        // Avoid duplicate consumers.
        routingTask?.cancel()

        routingTask = Task { [weak self] in
            for await event in ws.events {
                guard !Task.isCancelled else { break }
                await MainActor.run {
                    self?.route(event, chatState: chatState, cryptoState: cryptoState, voiceState: voiceState)
                }
            }
        }
    }

    /// Stop consuming events.
    func stop() {
        routingTask?.cancel()
        routingTask = nil
    }

    // MARK: - Routing

    private func route(
        _ event: WSServerEvent,
        chatState: ChatState,
        cryptoState: CryptoState,
        voiceState: VoiceState
    ) {
        switch event {
        // -- Chat / Messages ------------------------------------------------
        case .message(let payload):
            chatState.handleNewMessage(payload)

        case .messageEdit(let payload):
            chatState.handleMessageEdit(payload)

        case .messageDelete(let payload):
            chatState.handleMessageDelete(payload)

        case .typing(let payload):
            chatState.handleTyping(payload)

        case .reactionAdd(let payload):
            chatState.handleReactionAdd(payload)

        case .reactionRemove(let payload):
            chatState.handleReactionRemove(payload)

        case .dmMessage(let payload):
            chatState.handleDMMessage(payload)

        // -- Members --------------------------------------------------------
        case .memberJoined(let payload):
            chatState.handleMemberJoined(payload)

        case .memberLeft(let payload):
            chatState.handleMemberLeft(payload)

        case .memberRoleUpdated(let payload):
            chatState.handleMemberRoleUpdated(payload)

        // -- Server / Channel -----------------------------------------------
        case .channelUpdate(let payload):
            chatState.handleChannelUpdate(payload)

        case .serverUpdated(let payload):
            chatState.handleServerUpdated(payload)

        // -- Presence & Profiles --------------------------------------------
        case .presence(let payload):
            chatState.handlePresence(payload)

        case .profileUpdate(let payload):
            chatState.handleProfileUpdate(payload)

        case .activityUpdate(let payload):
            chatState.handleActivityUpdate(payload)

        // -- Voice ----------------------------------------------------------
        case .voiceState(let payload):
            chatState.handleVoiceState(payload)
            voiceState.handleVoiceState(payload)

        // -- Encryption / Key Exchange --------------------------------------
        case .serverKeyShared(let payload):
            cryptoState.handleKeyShared(payload)

        case .serverKeyRequested(let payload):
            cryptoState.handleKeyRequested(payload)

        // -- Errors & Unknown -----------------------------------------------
        case .error(let message):
            print("[EventRouter] Server error: \(message)")

        case .unknown(let raw):
            print("[EventRouter] Unknown event: \(raw)")
        }
    }

    deinit {
        routingTask?.cancel()
    }
}
