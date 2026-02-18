import Foundation

enum ServerAPI {

    /// Fetch all servers the current user is a member of.
    static func getServers() async throws -> [Server] {
        try await APIClient.shared.request("GET", "/servers")
    }

    /// Fetch all channels for a given server.
    static func getChannels(serverId: String) async throws -> [Channel] {
        try await APIClient.shared.request("GET", "/servers/\(serverId)/channels")
    }

    /// Fetch all members of a given server.
    static func getMembers(serverId: String) async throws -> [Member] {
        try await APIClient.shared.request("GET", "/servers/\(serverId)/members")
    }
}
