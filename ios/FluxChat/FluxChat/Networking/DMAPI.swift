import Foundation

enum DMAPI {

    /// Fetch all DM channels for the current user.
    static func getDMChannels() async throws -> [DMChannel] {
        try await APIClient.shared.request("GET", "/dms")
    }

    /// Create (or retrieve) a DM channel with a specific user.
    static func createDM(userId: String) async throws -> DMChannel {
        struct Body: Encodable {
            let userId: String
        }

        return try await APIClient.shared.request(
            "POST",
            "/dms",
            body: Body(userId: userId)
        )
    }

    /// Fetch paginated messages for a DM channel.
    static func getDMMessages(
        dmChannelId: String,
        cursor: String? = nil
    ) async throws -> PaginatedDMMessages {
        var path = "/dms/\(dmChannelId)/messages"
        if let cursor {
            let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor
            path += "?cursor=\(encoded)"
        }
        return try await APIClient.shared.request("GET", path)
    }
}
