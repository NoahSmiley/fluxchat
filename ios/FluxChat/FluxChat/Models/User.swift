import Foundation

struct User: Codable, Identifiable {
    let id: String
    let username: String
    let email: String
    let image: String?
    let ringStyle: String?
    let ringSpin: Bool?
    let steamId: String?
    let ringPatternSeed: Int?
    let bannerCss: String?
    let bannerPatternSeed: Int?
}

struct AuthResponse: Codable {
    let user: User
    let token: String
}

struct SessionResponse: Codable {
    let user: User?
}
