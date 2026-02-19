import ActivityKit
import Foundation

/// Attributes for the Flux Live Activity that shows the logo in the Dynamic Island.
struct FluxActivityAttributes: ActivityAttributes {
    /// Static data that doesn't change during the activity.
    struct ContentState: Codable, Hashable {
        var isConnected: Bool
    }
}
