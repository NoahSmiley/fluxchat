import Foundation
import KeychainAccess

enum KeychainHelper {
    private static let keychain = Keychain(service: Config.keychainService)

    // MARK: - String values

    static func get(_ key: String) -> String? {
        try? keychain.get(key)
    }

    static func set(_ key: String, value: String) {
        try? keychain.set(value, key: key)
    }

    static func delete(_ key: String) {
        try? keychain.remove(key)
    }

    // MARK: - Data values (for crypto keys)

    static func getData(_ key: String) -> Data? {
        try? keychain.getData(key)
    }

    static func setData(_ key: String, value: Data) {
        try? keychain.set(value, key: key)
    }
}
