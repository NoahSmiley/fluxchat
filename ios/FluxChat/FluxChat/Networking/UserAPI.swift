import Foundation

enum UserAPI {

    /// Update the current user's profile. Only non-nil fields are sent.
    /// PATCH /users/me  { username?, image? }
    static func updateProfile(
        username: String? = nil,
        image: String? = nil
    ) async throws -> User {
        // Build a dictionary with only the fields that are provided
        var body: [String: String] = [:]
        if let username { body["username"] = username }
        if let image { body["image"] = image }

        return try await APIClient.shared.request(
            "PATCH",
            "/users/me",
            body: body
        )
    }
}
