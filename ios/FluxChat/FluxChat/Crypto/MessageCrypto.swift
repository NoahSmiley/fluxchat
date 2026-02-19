import CryptoKit
import Foundation

enum MessageCryptoError: LocalizedError {
    case invalidBase64
    case dataTooShort
    case encryptionFailed
    case decryptionFailed
    case utf8EncodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidBase64:
            return "Invalid base64 ciphertext"
        case .dataTooShort:
            return "Ciphertext data too short (must contain nonce + tag at minimum)"
        case .encryptionFailed:
            return "AES-GCM encryption failed"
        case .decryptionFailed:
            return "AES-GCM decryption failed"
        case .utf8EncodingFailed:
            return "Failed to encode plaintext as UTF-8"
        }
    }
}

enum MessageCrypto {
    // MARK: - Message Encryption

    /// Encrypt a plaintext string with AES-256-GCM.
    ///
    /// Returns `base64(nonce[12] || ciphertext || tag[16])`.
    ///
    /// CryptoKit's `AES.GCM.SealedBox.combined` produces exactly
    /// `nonce[12] || ciphertext || tag[16]`, which matches the web client's
    /// format of `IV || AES-GCM-ciphertext-with-tag`.
    static func encrypt(_ plaintext: String, key: SymmetricKey) throws -> String {
        guard let data = plaintext.data(using: .utf8) else {
            throw MessageCryptoError.utf8EncodingFailed
        }

        let sealedBox = try AES.GCM.seal(data, using: key)

        guard let combined = sealedBox.combined else {
            throw MessageCryptoError.encryptionFailed
        }

        // combined = nonce[12] || ciphertext || tag[16]
        return Base64.encode(combined)
    }

    /// Decrypt a base64-encoded AES-256-GCM ciphertext.
    ///
    /// Input format: `base64(nonce[12] || ciphertext || tag[16])`.
    ///
    /// CryptoKit's `AES.GCM.SealedBox(combined:)` expects exactly this layout,
    /// matching the web client's output.
    static func decrypt(_ ciphertext: String, key: SymmetricKey) throws -> String {
        guard let data = Base64.decode(ciphertext) else {
            throw MessageCryptoError.invalidBase64
        }

        // Minimum size: 12 (nonce) + 16 (tag) = 28 bytes (empty plaintext)
        guard data.count >= 28 else {
            throw MessageCryptoError.dataTooShort
        }

        let sealedBox = try AES.GCM.SealedBox(combined: data)
        let decryptedData = try AES.GCM.open(sealedBox, using: key)

        guard let plaintext = String(data: decryptedData, encoding: .utf8) else {
            throw MessageCryptoError.decryptionFailed
        }

        return plaintext
    }

    // MARK: - Message Decryption with Legacy Handling

    /// Decrypt a message, handling legacy base64 (mlsEpoch 0) and encrypted (mlsEpoch >= 1).
    ///
    /// - mlsEpoch == 0: The ciphertext is just base64-encoded UTF-8 (legacy, unencrypted).
    /// - mlsEpoch >= 1: The ciphertext is AES-256-GCM encrypted and must be decrypted.
    static func decryptMessage(_ ciphertext: String, key: SymmetricKey?, mlsEpoch: Int) -> String {
        if mlsEpoch == 0 {
            // Legacy: plain base64-encoded UTF-8 text
            guard let data = Base64.decode(ciphertext),
                  let text = String(data: data, encoding: .utf8) else {
                return "[unreadable message]"
            }
            return text
        }

        guard let key = key else {
            return "[encrypted message - key unavailable]"
        }

        do {
            return try decrypt(ciphertext, key: key)
        } catch {
            return "[encrypted message - decryption failed]"
        }
    }

    // MARK: - Group Key Management

    /// Generate a random AES-256 (32-byte) symmetric key for group encryption.
    static func generateGroupKey() -> SymmetricKey {
        SymmetricKey(size: .bits256)
    }

    /// Export a symmetric key as raw bytes.
    static func exportGroupKey(_ key: SymmetricKey) -> Data {
        key.withUnsafeBytes { Data($0) }
    }

    /// Import a symmetric key from raw bytes.
    static func importGroupKey(_ data: Data) -> SymmetricKey {
        SymmetricKey(data: data)
    }

    /// Export a symmetric key as a standard base64 string (for LiveKit E2EE).
    static func exportKeyAsBase64(_ key: SymmetricKey) -> String {
        let data = exportGroupKey(key)
        return Base64.encode(data)
    }
}
