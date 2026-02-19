import Foundation

enum ChannelType: String, Codable {
    case text
    case voice
    case game
    case category
}

struct Channel: Codable, Identifiable {
    let id: String
    let serverId: String
    let name: String
    let type: ChannelType
    let bitrate: Int?
    let parentId: String?
    let position: Int
    let createdAt: String
}
