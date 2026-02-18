import AVFoundation
import LiveKit
import SwiftUI

/// Manages the LiveKit voice connection, local audio controls, and
/// participant state for the currently joined voice channel.
@Observable
final class VoiceState {

    // MARK: - Connection State

    var room: Room?
    var isConnected = false
    var currentChannelId: String?
    var currentChannelName: String?
    var isMuted = false
    var isDeafened = false

    /// Participant list sourced from WebSocket voice_state events.
    var participants: [VoiceParticipant] = []

    /// Tracks which participants are currently speaking, keyed by userId.
    var speakingUsers: Set<String> = []

    /// Errors surfaced to the UI.
    var error: String?

    // MARK: - WebSocket Reference

    var ws: FluxWebSocket?

    // MARK: - Private

    private var roomDelegate: RoomDelegateHandler?

    // =========================================================================
    // MARK: - Join / Leave
    // =========================================================================

    func joinVoice(channelId: String, channelName: String? = nil) async throws {
        if isConnected {
            await leaveVoice()
        }

        error = nil

        // Configure audio session for voice chat
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
        } catch {
            print("[VoiceState] Audio session error: \(error.localizedDescription)")
        }

        let tokenResponse = try await VoiceAPI.getToken(channelId: channelId)

        let newRoom = Room()
        let delegate = RoomDelegateHandler(voiceState: self)
        newRoom.add(delegate: delegate)

        try await newRoom.connect(url: tokenResponse.url, token: tokenResponse.token)
        try await newRoom.localParticipant.setMicrophone(enabled: true)

        ws?.send(.voiceStateUpdate(channelId: channelId, action: "join"))

        await MainActor.run {
            self.room = newRoom
            self.roomDelegate = delegate
            self.isConnected = true
            self.currentChannelId = channelId
            self.currentChannelName = channelName
            self.isMuted = false
            self.isDeafened = false
        }
    }

    func leaveVoice() async {
        if let room {
            await room.disconnect()
        }

        if let channelId = currentChannelId {
            ws?.send(.voiceStateUpdate(channelId: channelId, action: "leave"))
        }

        await MainActor.run {
            self.room = nil
            self.roomDelegate = nil
            self.isConnected = false
            self.currentChannelId = nil
            self.currentChannelName = nil
            self.isMuted = false
            self.isDeafened = false
            self.participants = []
            self.speakingUsers = []
            self.error = nil
        }
    }

    // =========================================================================
    // MARK: - Audio Controls
    // =========================================================================

    func toggleMute() {
        isMuted.toggle()
        Task {
            try? await room?.localParticipant.setMicrophone(enabled: !isMuted)
        }
    }

    func toggleDeafen() {
        isDeafened.toggle()

        // Mute/unmute all remote audio track publications
        if let room {
            for (_, participant) in room.remoteParticipants {
                for publication in participant.audioTracks {
                    if let remotePub = publication as? RemoteTrackPublication {
                        Task { try? await remotePub.set(enabled: !isDeafened) }
                    }
                }
            }
        }

        if isDeafened && !isMuted {
            toggleMute()
        }

        if !isDeafened && isMuted {
            toggleMute()
        }
    }

    // =========================================================================
    // MARK: - WS Event Handler
    // =========================================================================

    func handleVoiceState(_ event: VoiceStateEvent) {
        if event.channelId == currentChannelId {
            participants = event.participants
        }
    }
}

// MARK: - LiveKit Room Delegate

private final class RoomDelegateHandler: RoomDelegate {
    private weak var voiceState: VoiceState?

    init(voiceState: VoiceState) {
        self.voiceState = voiceState
    }

    nonisolated func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) {
        Task { @MainActor [weak self] in
            guard let self, let voiceState = self.voiceState else { return }
            voiceState.speakingUsers = Set(participants.compactMap { $0.identity?.stringValue })
        }
    }

    nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        Task { @MainActor [weak self] in
            guard let self, let voiceState = self.voiceState else { return }
            voiceState.isConnected = false
            voiceState.error = error?.localizedDescription ?? "Disconnected from voice"
        }
    }
}
