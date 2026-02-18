import CryptoKit
import Foundation

enum KeyWrappingError: LocalizedError {
    case invalidBase64
    case dataTooShort
    case unwrapFailed

    var errorDescription: String? {
        switch self {
        case .invalidBase64:
            return "Invalid base64 in wrapped key"
        case .dataTooShort:
            return "Wrapped key data too short (must contain IV + tag at minimum)"
        case .unwrapFailed:
            return "Failed to unwrap group key"
        }
    }
}

enum KeyWrapping {
    // MARK: - Wrapping Key Derivation

    /// Derive an AES-256-GCM wrapping key from an ECDH shared secret using HKDF.
    ///
    /// This matches the web client's two-step process:
    /// 1. `deriveBits(ECDH, 256)` -> raw x-coordinate of shared point (32 bytes)
    /// 2. `HKDF(SHA-256, salt="flux-server-key-wrap", info="flux-wrap")` -> AES-256 key
    ///
    /// CryptoKit's `SharedSecret` holds the same x-coordinate, and
    /// `hkdfDerivedSymmetricKey` applies HKDF directly to it, producing
    /// a byte-compatible result.
    private static func deriveWrappingKey(
        myPrivate: P256.KeyAgreement.PrivateKey,
        theirPublic: P256.KeyAgreement.PublicKey
    ) throws -> SymmetricKey {
        let sharedSecret = try myPrivate.sharedSecretFromKeyAgreement(with: theirPublic)
        return sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data("flux-server-key-wrap".utf8),
            sharedInfo: Data("flux-wrap".utf8),
            outputByteCount: 32
        )
    }

    // MARK: - Wrap / Unwrap

    /// Wrap a group key for a recipient using ECDH-derived AES-256-GCM.
    ///
    /// Returns `base64(IV[12] || AES-GCM(rawKey[32] || tag[16]))`.
    ///
    /// The web client's `wrapKey("raw", groupKey, wrappingKey, { name: "AES-GCM", iv })`
    /// encrypts the raw 32-byte key material with AES-GCM and appends the 16-byte tag.
    /// CryptoKit's `AES.GCM.seal` with `.combined` produces `nonce || ciphertext || tag`,
    /// which is the same layout.
    static func wrapGroupKey(
        _ groupKey: SymmetricKey,
        recipientPublic: P256.KeyAgreement.PublicKey,
        myPrivate: P256.KeyAgreement.PrivateKey
    ) throws -> String {
        let wrappingKey = try deriveWrappingKey(myPrivate: myPrivate, theirPublic: recipientPublic)

        // Extract raw 32-byte key material
        let rawKey = groupKey.withUnsafeBytes { Data($0) }

        // Encrypt with AES-256-GCM; combined = nonce[12] || ciphertext || tag[16]
        let sealedBox = try AES.GCM.seal(rawKey, using: wrappingKey)

        guard let combined = sealedBox.combined else {
            throw KeyWrappingError.unwrapFailed
        }

        return Base64.encode(combined)
    }

    /// Unwrap a group key received from a sender.
    ///
    /// Input format: `base64(IV[12] || AES-GCM(rawKey[32]) || tag[16])`.
    ///
    /// The web client's `unwrapKey` splits at byte 12 (IV vs rest), then AES-GCM
    /// decrypts the remainder. CryptoKit's `SealedBox(combined:)` handles the same
    /// layout (nonce || ciphertext || tag).
    static func unwrapGroupKey(
        _ wrapped: String,
        senderPublic: P256.KeyAgreement.PublicKey,
        myPrivate: P256.KeyAgreement.PrivateKey
    ) throws -> SymmetricKey {
        let wrappingKey = try deriveWrappingKey(myPrivate: myPrivate, theirPublic: senderPublic)

        guard let data = Base64.decode(wrapped) else {
            throw KeyWrappingError.invalidBase64
        }

        // Minimum: 12 (nonce) + 16 (tag) = 28 bytes (empty plaintext, but key is 32 bytes so really 60)
        guard data.count >= 28 else {
            throw KeyWrappingError.dataTooShort
        }

        let sealedBox = try AES.GCM.SealedBox(combined: data)
        let rawKey = try AES.GCM.open(sealedBox, using: wrappingKey)

        return SymmetricKey(data: rawKey)
    }
}
