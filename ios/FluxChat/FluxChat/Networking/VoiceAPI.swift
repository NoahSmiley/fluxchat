import Foundation

struct VoiceTokenResponse: Codable {
    let token: String
    let url: String
}

enum VoiceAPI {

    /// Request a LiveKit token for a voice channel.
    /// - Parameters:
    ///   - channelId: The voice channel to join.
    ///   - viewer: If true, join as a viewer (receive-only).
    static func getToken(
        channelId: String,
        viewer: Bool = false
    ) async throws -> VoiceTokenResponse {
        struct Body: Encodable {
            let channelId: String
            let viewer: Bool
        }

        return try await APIClient.shared.request(
            "POST",
            "/voice/token",
            body: Body(channelId: channelId, viewer: viewer)
        )
    }
}
