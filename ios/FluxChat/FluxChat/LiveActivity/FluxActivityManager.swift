import ActivityKit
import Foundation

/// Manages the Flux Live Activity that shows the logo in the Dynamic Island.
enum FluxActivityManager {
    private static var currentActivity: Activity<FluxActivityAttributes>?

    /// Start the Live Activity when the app becomes active.
    static func start() {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        // Don't start a new one if already running
        if currentActivity != nil { return }

        let attributes = FluxActivityAttributes()
        let state = FluxActivityAttributes.ContentState(isConnected: true)

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil),
                pushType: nil
            )
            currentActivity = activity
        } catch {
            print("[FluxActivity] Failed to start: \(error.localizedDescription)")
        }
    }

    /// End the Live Activity when the app goes to background.
    static func stop() {
        Task {
            let state = FluxActivityAttributes.ContentState(isConnected: false)
            await currentActivity?.end(
                .init(state: state, staleDate: nil),
                dismissalPolicy: .immediate
            )
            currentActivity = nil
        }
    }
}
