import SwiftUI

@Observable
final class AuthState {

    // MARK: - Published State

    var user: User?
    var isLoading = true
    var error: String?

    var isAuthenticated: Bool { user != nil }

    // MARK: - Session Bootstrap

    /// Called once on app launch to restore a persisted session.
    func initialize() async {
        guard let token = KeychainHelper.get(Config.sessionTokenKey) else {
            await MainActor.run { isLoading = false }
            return
        }

        do {
            let session = try await AuthAPI.getSession()
            await MainActor.run {
                self.user = session.user
                self.isLoading = false
            }
        } catch {
            // Token expired or invalid -- wipe it so the user gets the login screen.
            KeychainHelper.delete(Config.sessionTokenKey)
            await MainActor.run {
                self.user = nil
                self.isLoading = false
            }
        }
    }

    // MARK: - Sign In

    func signIn(email: String, password: String) async {
        await MainActor.run {
            self.error = nil
            self.isLoading = true
        }

        do {
            let response = try await AuthAPI.signIn(email: email, password: password)
            await MainActor.run {
                self.user = response.user
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    // MARK: - Sign Up

    func signUp(email: String, password: String, username: String) async {
        await MainActor.run {
            self.error = nil
            self.isLoading = true
        }

        do {
            let response = try await AuthAPI.signUp(
                email: email,
                password: password,
                name: username,
                username: username
            )
            await MainActor.run {
                self.user = response.user
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    // MARK: - Sign Out

    func signOut() async {
        do {
            try await AuthAPI.signOut()
        } catch {
            // Best-effort; clear local state regardless.
            print("[AuthState] signOut error: \(error.localizedDescription)")
        }

        await MainActor.run {
            self.user = nil
            self.error = nil
        }
    }
}
