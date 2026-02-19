import CryptoKit
import Foundation

enum DMKeyDerivation {
    /// Derive a DM encryption key from ECDH shared secret + HKDF.
    ///
    /// This matches the web client's three-step process (crypto.ts lines 99-134):
    /// 1. `deriveBits(ECDH, 256)` -> raw x-coordinate of shared point (32 bytes)
    /// 2. Import as HKDF key material
    /// 3. `HKDF(SHA-256, salt=UTF8(dmChannelId), info=UTF8("flux-dm"))` -> AES-256-GCM key
    ///
    /// CryptoKit's `SharedSecret` internally holds the same x-coordinate that
    /// Web Crypto's `deriveBits` returns. Calling `hkdfDerivedSymmetricKey` applies
    /// HKDF directly to that value, producing a byte-identical result.
    ///
    /// Because ECDH is commutative (A's private + B's public == B's private + A's public),
    /// both participants derive the same key for the same `dmChannelId`.
    ///
    /// - Parameters:
    ///   - myPrivate: The local user's ECDH private key.
    ///   - theirPublic: The remote user's ECDH public key.
    ///   - dmChannelId: The unique DM channel identifier, used as the HKDF salt.
    /// - Returns: A 256-bit symmetric key for AES-256-GCM encryption of DM messages.
    static func deriveDMKey(
        myPrivate: P256.KeyAgreement.PrivateKey,
        theirPublic: P256.KeyAgreement.PublicKey,
        dmChannelId: String
    ) throws -> SymmetricKey {
        let sharedSecret = try myPrivate.sharedSecretFromKeyAgreement(with: theirPublic)
        return sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(dmChannelId.utf8),
            sharedInfo: Data("flux-dm".utf8),
            outputByteCount: 32
        )
    }
}
