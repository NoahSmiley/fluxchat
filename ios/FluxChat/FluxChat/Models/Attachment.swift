import Foundation

struct Attachment: Codable, Identifiable {
    let id: String
    let messageId: String?
    let uploaderId: String?
    let filename: String
    let contentType: String
    let size: Int
    let createdAt: String?

    var fileURL: String {
        "\(Config.apiBase)/files/\(id)/\(filename)"
    }
}
