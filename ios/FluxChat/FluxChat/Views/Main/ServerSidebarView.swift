import SwiftUI

/// Vertical sidebar of server icons. Each server is represented as a circle
/// with the first letter of its name. The selected server is highlighted
/// with an accent indicator.
struct ServerSidebarView: View {
    @Environment(ChatState.self) private var chatState
    @Environment(AuthState.self) private var authState

    // MARK: - Colors

    private let bgColor = Color(red: 0.07, green: 0.07, blue: 0.09)
    private let selectedIndicator = Color(red: 0.35, green: 0.55, blue: 1.0)
    private let serverBg = Color(red: 0.15, green: 0.15, blue: 0.18)
    private let serverSelectedBg = Color(red: 0.35, green: 0.55, blue: 1.0)

    var body: some View {
        VStack(spacing: 8) {
            // DM button
            dmButton

            divider

            // Server list
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(chatState.servers) { server in
                        serverIcon(server)
                    }
                }
            }

            Spacer()

            // User avatar at bottom
            if let user = authState.user {
                AvatarView(
                    username: user.username,
                    image: user.image,
                    size: 36
                )
                .padding(.bottom, 8)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 4)
        .frame(width: 68)
        .background(bgColor)
    }

    // MARK: - DM Button

    private var dmButton: some View {
        Button {
            chatState.showingDMs = true
            Task { await chatState.loadDMChannels() }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: chatState.showingDMs ? 14 : 22)
                    .fill(chatState.showingDMs ? serverSelectedBg : serverBg)
                    .frame(width: 44, height: 44)
                    .animation(.easeInOut(duration: 0.15), value: chatState.showingDMs)

                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(chatState.showingDMs ? .white : .gray)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Server Icon

    private func serverIcon(_ server: Server) -> some View {
        let isSelected = server.id == chatState.selectedServerId && !chatState.showingDMs

        return HStack(spacing: 0) {
            // Left indicator pill
            RoundedRectangle(cornerRadius: 2)
                .fill(selectedIndicator)
                .frame(width: 4, height: isSelected ? 32 : hasUnread(server) ? 8 : 0)
                .animation(.easeInOut(duration: 0.15), value: isSelected)
                .padding(.trailing, 4)

            Button {
                chatState.showingDMs = false
                Task { await chatState.selectServer(server.id) }
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: isSelected ? 14 : 22)
                        .fill(isSelected ? serverSelectedBg : serverBg)
                        .frame(width: 44, height: 44)
                        .animation(.easeInOut(duration: 0.15), value: isSelected)

                    Text(serverInitial(server.name))
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(isSelected ? .white : .gray)
                }
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Helpers

    private var divider: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(Color.white.opacity(0.08))
            .frame(width: 32, height: 2)
            .padding(.vertical, 2)
    }

    private func serverInitial(_ name: String) -> String {
        let words = name.split(separator: " ")
        if words.count >= 2 {
            return String(words[0].prefix(1) + words[1].prefix(1)).uppercased()
        }
        return String(name.prefix(1)).uppercased()
    }

    private func hasUnread(_ server: Server) -> Bool {
        guard let channels = chatState.channelsByServer[server.id] else { return false }
        return channels.contains { chatState.unreadChannels.contains($0.id) }
    }
}
