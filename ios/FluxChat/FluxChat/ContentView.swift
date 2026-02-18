import SwiftUI

struct ContentView: View {
    @Environment(AuthState.self) private var authState

    var body: some View {
        Group {
            if authState.isLoading && authState.user == nil {
                // Launch / session-restore spinner
                ZStack {
                    Color.black.ignoresSafeArea()
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                        .scaleEffect(1.4)
                }
            } else if authState.isAuthenticated {
                MainView()
            } else {
                LoginView()
            }
        }
        .preferredColorScheme(.dark)
        .task {
            await authState.initialize()
        }
    }
}

#Preview {
    ContentView()
        .environment(AuthState())
        .environment(ChatState())
        .environment(CryptoState())
        .environment(VoiceState())
}
