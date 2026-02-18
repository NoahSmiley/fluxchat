import Foundation

enum AuthAPI {

    // MARK: - Sign In

    static func signIn(email: String, password: String) async throws -> AuthResponse {
        struct Body: Encodable {
            let email: String
            let password: String
        }

        let response: AuthResponse = try await APIClient.shared.request(
            "POST",
            "/auth/sign-in/email",
            body: Body(email: email, password: password)
        )

        // Persist the session token
        KeychainHelper.set(Config.sessionTokenKey, value: response.token)

        return response
    }

    // MARK: - Sign Up

    static func signUp(
        email: String,
        password: String,
        name: String,
        username: String
    ) async throws -> AuthResponse {
        struct Body: Encodable {
            let email: String
            let password: String
            let name: String
            let username: String
        }

        let response: AuthResponse = try await APIClient.shared.request(
            "POST",
            "/auth/sign-up/email",
            body: Body(email: email, password: password, name: name, username: username)
        )

        // Persist the session token
        KeychainHelper.set(Config.sessionTokenKey, value: response.token)

        return response
    }

    // MARK: - Sign Out

    static func signOut() async throws {
        try await APIClient.shared.requestVoid("POST", "/auth/sign-out")
        KeychainHelper.delete(Config.sessionTokenKey)
    }

    // MARK: - Get Session

    static func getSession() async throws -> SessionResponse {
        try await APIClient.shared.request("GET", "/auth/get-session")
    }
}
