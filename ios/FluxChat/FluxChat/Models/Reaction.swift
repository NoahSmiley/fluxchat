import Foundation

struct Reaction: Codable, Identifiable {
    let id: String
    let messageId: String
    let userId: String
    let emoji: String
    let createdAt: String
}
