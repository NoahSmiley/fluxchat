import CryptoKit
import Foundation

enum CryptoError: LocalizedError {
    case invalidBase64
    case invalidJWK
    case invalidKeyData
    case missingJWKField(String)

    var errorDescription: String? {
        switch self {
        case .invalidBase64:
            return "Invalid base64 encoding"
        case .invalidJWK:
            return "Invalid JWK format"
        case .invalidKeyData:
            return "Invalid key data"
        case .missingJWKField(let field):
            return "Missing JWK field: \(field)"
        }
    }
}

enum CryptoManager {
    private static let privateKeyKeychainKey = "flux-identity-private-key"

    // MARK: - Key Pair Generation

    /// Generate a new P-256 key pair for ECDH key agreement.
    static func generateKeyPair() -> P256.KeyAgreement.PrivateKey {
        P256.KeyAgreement.PrivateKey()
    }

    // MARK: - Keychain Storage

    /// Store the private key's raw representation (32-byte scalar) in the Keychain.
    static func storePrivateKey(_ key: P256.KeyAgreement.PrivateKey) {
        KeychainHelper.setData(privateKeyKeychainKey, value: key.rawRepresentation)
    }

    /// Load the private key from Keychain. Returns nil if no key is stored.
    static func loadPrivateKey() -> P256.KeyAgreement.PrivateKey? {
        guard let data = KeychainHelper.getData(privateKeyKeychainKey) else { return nil }
        return try? P256.KeyAgreement.PrivateKey(rawRepresentation: data)
    }

    // MARK: - Public Key Export/Import (JWK)

    /// Export a public key as `base64(JSON(JWK))`, matching the web client's format.
    ///
    /// CryptoKit's `x963Representation` is 65 bytes: `0x04 || x[32] || y[32]`.
    /// We extract x and y, base64url-encode them (no padding), build a minimal JWK
    /// JSON object, then standard-base64 encode the entire JSON string.
    static func exportPublicKey(_ publicKey: P256.KeyAgreement.PublicKey) -> String {
        let x963 = publicKey.x963Representation
        // x963: byte 0 = 0x04, bytes 1..32 = x, bytes 33..64 = y
        let x = x963[x963.startIndex + 1 ..< x963.startIndex + 33]
        let y = x963[x963.startIndex + 33 ..< x963.startIndex + 65]

        let xB64 = Base64.encodeURL(Data(x))
        let yB64 = Base64.encodeURL(Data(y))

        // Build JWK JSON with keys in a consistent order.
        // The web client produces: {"kty":"EC","crv":"P-256","x":"...","y":"...","ext":true,"key_ops":[]}
        // For import compatibility, only kty/crv/x/y are required.
        let jwk = "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"\(xB64)\",\"y\":\"\(yB64)\"}"

        return Base64.encode(Data(jwk.utf8))
    }

    /// Import a public key from `base64(JSON(JWK))`.
    ///
    /// Decodes the base64 wrapper, parses the JSON to extract `x` and `y` (base64url),
    /// decodes each to 32 bytes, prepends `0x04` to form x963 representation, and
    /// creates the CryptoKit public key.
    static func importPublicKey(_ base64JWK: String) throws -> P256.KeyAgreement.PublicKey {
        guard let jsonData = Base64.decode(base64JWK) else {
            throw CryptoError.invalidBase64
        }

        guard let jwk = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            throw CryptoError.invalidJWK
        }

        guard let xStr = jwk["x"] as? String else {
            throw CryptoError.missingJWKField("x")
        }
        guard let yStr = jwk["y"] as? String else {
            throw CryptoError.missingJWKField("y")
        }

        guard let xData = Base64.decodeURL(xStr), xData.count == 32 else {
            throw CryptoError.invalidKeyData
        }
        guard let yData = Base64.decodeURL(yStr), yData.count == 32 else {
            throw CryptoError.invalidKeyData
        }

        // Build x963 uncompressed point: 0x04 || x || y
        var x963 = Data([0x04])
        x963.append(xData)
        x963.append(yData)

        return try P256.KeyAgreement.PublicKey(x963Representation: x963)
    }

    // MARK: - Private Key Export/Import (JWK)

    /// Export a private key as `base64(JSON(JWK))` including the `d` parameter.
    ///
    /// The private scalar is `rawRepresentation` (32 bytes). The public key's x and y
    /// are extracted from `x963Representation` as above.
    static func exportPrivateKey(_ privateKey: P256.KeyAgreement.PrivateKey) -> String {
        let publicKey = privateKey.publicKey
        let x963 = publicKey.x963Representation
        let x = x963[x963.startIndex + 1 ..< x963.startIndex + 33]
        let y = x963[x963.startIndex + 33 ..< x963.startIndex + 65]
        let d = privateKey.rawRepresentation

        let xB64 = Base64.encodeURL(Data(x))
        let yB64 = Base64.encodeURL(Data(y))
        let dB64 = Base64.encodeURL(Data(d))

        let jwk = "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"\(xB64)\",\"y\":\"\(yB64)\",\"d\":\"\(dB64)\"}"

        return Base64.encode(Data(jwk.utf8))
    }

    /// Import a private key from `base64(JSON(JWK))`.
    ///
    /// Extracts the `d` parameter (the 32-byte scalar) and creates the private key
    /// from its raw representation.
    static func importPrivateKey(_ base64JWK: String) throws -> P256.KeyAgreement.PrivateKey {
        guard let jsonData = Base64.decode(base64JWK) else {
            throw CryptoError.invalidBase64
        }

        guard let jwk = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] else {
            throw CryptoError.invalidJWK
        }

        guard let dStr = jwk["d"] as? String else {
            throw CryptoError.missingJWKField("d")
        }

        guard let dData = Base64.decodeURL(dStr), dData.count == 32 else {
            throw CryptoError.invalidKeyData
        }

        return try P256.KeyAgreement.PrivateKey(rawRepresentation: dData)
    }
}
