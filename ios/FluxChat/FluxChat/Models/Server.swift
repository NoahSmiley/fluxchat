import Foundation

struct Server: Codable, Identifiable {
    let id: String
    let name: String
    let ownerId: String
    let inviteCode: String
    let createdAt: String
    let role: String? // "owner", "admin", "member"
}
