import CryptoKit
import SwiftUI

/// Manages end-to-end encryption state: identity key pair, server group keys,
/// DM key derivation, and key exchange over WebSocket.
@Observable
final class CryptoState {

    // MARK: - Key Pair

    var privateKey: P256.KeyAgreement.PrivateKey?
    var publicKeyBase64: String?

    // MARK: - Server Group Keys: serverId -> decrypted symmetric key

    var serverKeys: [String: SymmetricKey] = [:]

    // MARK: - DM Keys: dmChannelId -> derived symmetric key

    var dmKeys: [String: SymmetricKey] = [:]

    // MARK: - WebSocket Reference

    var ws: FluxWebSocket?

    // =========================================================================
    // MARK: - Initialization
    // =========================================================================

    /// Load or generate the identity key pair, export and upload the public key.
    func initialize() async {
        // Load existing key from keychain, or generate a new one
        if let existing = CryptoManager.loadPrivateKey() {
            privateKey = existing
        } else {
            let newKey = CryptoManager.generateKeyPair()
            CryptoManager.storePrivateKey(newKey)
            privateKey = newKey
        }

        guard let privateKey else { return }

        // Export public key as base64(JWK) and upload to server
        let pubKeyB64 = CryptoManager.exportPublicKey(privateKey.publicKey)
        publicKeyBase64 = pubKeyB64

        do {
            try await KeyAPI.setPublicKey(pubKeyB64)
        } catch {
            print("[CryptoState] Failed to upload public key: \(error.localizedDescription)")
        }
    }

    // =========================================================================
    // MARK: - Server Key Management
    // =========================================================================

    /// Get the group key for a server. Returns cached key, or fetches and unwraps
    /// from the API. Returns nil if no key is available yet.
    func getServerKey(_ serverId: String) async -> SymmetricKey? {
        // Return cached
        if let key = serverKeys[serverId] {
            return key
        }

        guard let privateKey else { return nil }

        do {
            // Fetch the encrypted key stored for the current user
            guard let response = try await KeyAPI.getMyServerKey(serverId: serverId) else {
                // No key shared yet; request one via WS
                ws?.send(.requestServerKey(serverId: serverId))
                return nil
            }

            // Import sender's public key and unwrap
            let senderPublic = try await fetchPublicKey(userId: response.senderId)
            let groupKey = try KeyWrapping.unwrapGroupKey(
                response.encryptedKey,
                senderPublic: senderPublic,
                myPrivate: privateKey
            )

            await MainActor.run {
                self.serverKeys[serverId] = groupKey
            }

            return groupKey
        } catch {
            print("[CryptoState] getServerKey error: \(error.localizedDescription)")
            return nil
        }
    }

    /// Derive a DM encryption key from ECDH with the other user's public key.
    func getDMKey(dmChannelId: String, theirPublicKeyBase64: String) throws -> SymmetricKey {
        if let key = dmKeys[dmChannelId] {
            return key
        }

        guard let privateKey else {
            throw CryptoError.invalidKeyData
        }

        let theirPublic = try CryptoManager.importPublicKey(theirPublicKeyBase64)
        let key = try DMKeyDerivation.deriveDMKey(
            myPrivate: privateKey,
            theirPublic: theirPublic,
            dmChannelId: dmChannelId
        )

        dmKeys[dmChannelId] = key
        return key
    }

    // =========================================================================
    // MARK: - WS Event Handlers
    // =========================================================================

    /// Another user has shared their encrypted server key with us.
    func handleKeyShared(_ event: ServerKeySharedEvent) {
        guard let privateKey else { return }

        Task {
            do {
                let senderPublic = try await fetchPublicKey(userId: event.senderId)
                let groupKey = try KeyWrapping.unwrapGroupKey(
                    event.encryptedKey,
                    senderPublic: senderPublic,
                    myPrivate: privateKey
                )

                await MainActor.run {
                    self.serverKeys[event.serverId] = groupKey
                }
            } catch {
                print("[CryptoState] handleKeyShared error: \(error.localizedDescription)")
            }
        }
    }

    /// Another user is requesting the server key. If we have it, wrap it for
    /// them and share it via WS.
    func handleKeyRequested(_ event: ServerKeyRequestedEvent) {
        guard let privateKey else { return }
        guard let groupKey = serverKeys[event.serverId] else { return }

        Task {
            do {
                let theirPublic = try await fetchPublicKey(userId: event.userId)
                let wrapped = try KeyWrapping.wrapGroupKey(
                    groupKey,
                    recipientPublic: theirPublic,
                    myPrivate: privateKey
                )

                ws?.send(.shareServerKey(
                    serverId: event.serverId,
                    userId: event.userId,
                    encryptedKey: wrapped
                ))
            } catch {
                print("[CryptoState] handleKeyRequested error: \(error.localizedDescription)")
            }
        }
    }

    // =========================================================================
    // MARK: - Helpers
    // =========================================================================

    /// Fetch a user's public key from the API and import it.
    private func fetchPublicKey(userId: String) async throws -> P256.KeyAgreement.PublicKey {
        let response = try await KeyAPI.getPublicKey(userId: userId)
        return try CryptoManager.importPublicKey(response.publicKey)
    }
}
