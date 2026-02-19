import Foundation

struct UploadResponse: Codable {
    let id: String
    let uploaderId: String?
    let filename: String
    let contentType: String
    let size: Int
    let createdAt: String?
}

enum FileAPI {

    /// Upload a file via multipart/form-data.
    static func upload(
        data: Data,
        filename: String,
        contentType: String
    ) async throws -> UploadResponse {
        try await APIClient.shared.upload(
            "/upload",
            fileData: data,
            filename: filename,
            contentType: contentType
        )
    }

    /// Build the full URL for a previously uploaded file.
    static func fileURL(id: String, filename: String) -> URL {
        let encoded = filename.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? filename
        return URL(string: "\(Config.apiBase)/files/\(id)/\(encoded)")!
    }
}
