import Foundation

struct Message: Codable, Identifiable {
    let id: String
    let channelId: String
    let senderId: String
    let content: String
    let createdAt: String
    let editedAt: String?
    let attachments: [Attachment]?
}

struct PaginatedMessages: Codable {
    let items: [Message]
    let cursor: String?
    let hasMore: Bool
}
