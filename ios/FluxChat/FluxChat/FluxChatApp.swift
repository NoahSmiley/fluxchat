import SwiftUI

@main
struct FluxChatApp: App {
    @State private var authState = AuthState()
    @State private var chatState = ChatState()
    @State private var cryptoState = CryptoState()
    @State private var voiceState = VoiceState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(authState)
                .environment(chatState)
                .environment(cryptoState)
                .environment(voiceState)
        }
    }
}
