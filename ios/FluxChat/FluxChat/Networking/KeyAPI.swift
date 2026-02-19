import Foundation

struct PublicKeyResponse: Codable {
    let publicKey: String
}

struct ServerKeyResponse: Codable {
    let encryptedKey: String
    let senderId: String
    let createdAt: String?
}

enum KeyAPI {

    /// Upload the current user's public key to the server.
    static func setPublicKey(_ publicKey: String) async throws {
        struct Body: Encodable {
            let publicKey: String
        }

        try await APIClient.shared.requestVoid(
            "PUT",
            "/users/me/public-key",
            body: Body(publicKey: publicKey)
        )
    }

    /// Fetch another user's public key.
    static func getPublicKey(userId: String) async throws -> PublicKeyResponse {
        try await APIClient.shared.request("GET", "/users/\(userId)/public-key")
    }

    /// Fetch the encrypted server group key stored for the current user.
    /// Returns nil if no key has been shared with this user yet.
    static func getMyServerKey(serverId: String) async throws -> ServerKeyResponse? {
        do {
            return try await APIClient.shared.request("GET", "/servers/\(serverId)/keys/me")
        } catch APIError.notFound {
            return nil
        }
    }

    /// Store a new encrypted server group key (typically done by the server creator).
    static func storeServerKey(
        serverId: String,
        encryptedKey: String,
        senderId: String
    ) async throws {
        struct Body: Encodable {
            let encryptedKey: String
            let senderId: String
        }

        try await APIClient.shared.requestVoid(
            "POST",
            "/servers/\(serverId)/keys",
            body: Body(encryptedKey: encryptedKey, senderId: senderId)
        )
    }

    /// Share the encrypted server group key with a specific user.
    static func shareServerKeyWith(
        serverId: String,
        userId: String,
        encryptedKey: String,
        senderId: String
    ) async throws {
        struct Body: Encodable {
            let encryptedKey: String
            let senderId: String
        }

        try await APIClient.shared.requestVoid(
            "POST",
            "/servers/\(serverId)/keys/\(userId)",
            body: Body(encryptedKey: encryptedKey, senderId: senderId)
        )
    }
}
