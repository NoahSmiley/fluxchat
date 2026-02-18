import Foundation

// MARK: - Link Preview Model

struct LinkPreview: Codable {
    let url: String
    let title: String?
    let description: String?
    let image: String?
    let domain: String?
}

enum MessageAPI {

    /// Fetch paginated messages for a channel.
    /// - Parameters:
    ///   - channelId: The channel to fetch messages from.
    ///   - cursor: Optional pagination cursor for older messages.
    ///   - limit: Number of messages per page (default 50).
    static func getMessages(
        channelId: String,
        cursor: String? = nil,
        limit: Int = 50
    ) async throws -> PaginatedMessages {
        var path = "/channels/\(channelId)/messages"
        var queryItems: [String] = []
        if let cursor {
            queryItems.append("cursor=\(cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor)")
        }
        if limit != 50 {
            queryItems.append("limit=\(limit)")
        }
        if !queryItems.isEmpty {
            path += "?" + queryItems.joined(separator: "&")
        }
        return try await APIClient.shared.request("GET", path)
    }

    /// Search messages in a channel by query string.
    static func searchMessages(
        channelId: String,
        query: String
    ) async throws -> PaginatedMessages {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await APIClient.shared.request(
            "GET",
            "/channels/\(channelId)/messages/search?q=\(encoded)"
        )
    }

    /// Fetch reactions for a list of message IDs.
    static func getReactions(messageIds: [String]) async throws -> [Reaction] {
        let ids = messageIds.joined(separator: ",")
        return try await APIClient.shared.request("GET", "/messages/reactions?ids=\(ids)")
    }

    /// Fetch a link preview for a given URL.
    static func getLinkPreview(url: String) async throws -> LinkPreview {
        let encoded = url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? url
        return try await APIClient.shared.request(
            "GET",
            "/link-preview?url=\(encoded)"
        )
    }
}
