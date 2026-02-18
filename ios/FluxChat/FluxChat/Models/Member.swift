import Foundation

enum MemberRole: String, Codable {
    case owner
    case admin
    case member
}

struct Member: Codable, Identifiable {
    var id: String { userId }

    let userId: String
    let serverId: String?
    let role: MemberRole
    let joinedAt: String?
    let roleUpdatedAt: String?
    let username: String
    let image: String?
    let ringStyle: String?
    let ringSpin: Bool?
    let steamId: String?
    let ringPatternSeed: Int?
    let bannerCss: String?
    let bannerPatternSeed: Int?

    // Exclude the computed `id` from coding keys so the decoder
    // does not expect an "id" field in the JSON payload.
    private enum CodingKeys: String, CodingKey {
        case userId, serverId, role, joinedAt, roleUpdatedAt
        case username, image, ringStyle, ringSpin, steamId
        case ringPatternSeed, bannerCss, bannerPatternSeed
    }
}
