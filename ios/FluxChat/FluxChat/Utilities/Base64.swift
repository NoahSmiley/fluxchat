import Foundation

enum Base64 {
    // MARK: - Standard Base64

    /// Encode Data to a standard base64 string.
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
    }

    /// Decode a standard base64 string to Data.
    static func decode(_ string: String) -> Data? {
        Data(base64Encoded: string)
    }

    // MARK: - Base64URL (for JWK interop)

    /// Encode Data to a base64url string (replaces +/ with -_, strips =).
    static func encodeURL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Decode a base64url string to Data.
    /// Re-adds padding and swaps -_ back to +/ before decoding.
    static func decodeURL(_ string: String) -> Data? {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        // Re-add padding if necessary
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }

        return Data(base64Encoded: base64)
    }
}
