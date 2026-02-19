import Foundation

struct DMChannel: Codable, Identifiable {
    let id: String
    let otherUser: DMUser
    let createdAt: String
}

struct DMUser: Codable {
    let id: String
    let username: String
    let image: String?
}

struct DMMessage: Codable, Identifiable {
    let id: String
    let dmChannelId: String
    let senderId: String
    let ciphertext: String
    let mlsEpoch: Int
    let createdAt: String
}

struct PaginatedDMMessages: Codable {
    let items: [DMMessage]
    let cursor: String?
    let hasMore: Bool
}
