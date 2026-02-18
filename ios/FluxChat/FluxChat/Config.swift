import Foundation

enum Config {
    // Change this to your server's address
    // Use local IP so physical iPhone can reach the backend on the same Wi-Fi
    static let serverURL = "http://192.168.0.69:3001"
    static let apiBase = "\(serverURL)/api"
    static let gatewayURL = serverURL.replacingOccurrences(of: "http", with: "ws") + "/gateway"

    static let wsHeartbeatInterval: TimeInterval = 30
    static let wsReconnectBaseDelay: TimeInterval = 1
    static let wsReconnectMaxDelay: TimeInterval = 30
    static let messagesPageSize = 50

    static let keychainService = "com.flux.app"
    static let sessionTokenKey = "flux-session-token"
}
