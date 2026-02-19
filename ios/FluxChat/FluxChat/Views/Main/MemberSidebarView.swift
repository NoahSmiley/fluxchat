import SwiftUI

/// Always-visible thin left strip matching the desktop ServerSidebar:
/// - Flux logo at top (tap = home)
/// - Scrollable member avatars (self first, online sorted, offline dimmed)
/// - FluxFloat + Settings buttons at bottom
struct MemberSidebarView: View {
    @Environment(AuthState.self) private var authState
    @Environment(ChatState.self) private var chatState

    let onOpenSettings: () -> Void
    let onLogoTap: () -> Void

    @State private var hoveredMemberId: String?

    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055)
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086)
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)

    var body: some View {
        VStack(spacing: 0) {
            // Flux logo
            Button(action: onLogoTap) {
                FluxLogoView(size: 28)
                    .foregroundStyle(.white)
                    .frame(width: 54, height: 44)
            }
            .buttonStyle(.plain)

            RoundedRectangle(cornerRadius: 1)
                .fill(Color.white.opacity(0.08))
                .frame(width: 28, height: 2)
                .padding(.bottom, 6)

            // Member avatars
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 4) {
                    ForEach(sortedMembers, id: \.userId) { member in
                        memberAvatar(member)
                    }
                }
                .padding(.vertical, 4)
            }

            Spacer(minLength: 0)

            // Bottom buttons
            VStack(spacing: 4) {
                Button {} label: {
                    Image(systemName: "bag.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(textMuted)
                        .frame(width: 34, height: 34)
                        .background(bgTertiary)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                Button(action: onOpenSettings) {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(textMuted)
                        .frame(width: 34, height: 34)
                        .background(bgTertiary)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 8)
        }
        .frame(width: 54)
        .background(bgSecondary)
    }

    private var sortedMembers: [Member] {
        let serverId = chatState.selectedServerId ?? chatState.servers.first?.id
        guard let serverId, let members = chatState.membersByServer[serverId] else { return [] }
        let myId = authState.user?.id ?? ""
        var me: Member?
        var online: [Member] = []
        var offline: [Member] = []
        for m in members {
            if m.userId == myId { me = m }
            else if chatState.onlineUsers.contains(m.userId) { online.append(m) }
            else { offline.append(m) }
        }
        online.sort { $0.username.localizedCaseInsensitiveCompare($1.username) == .orderedAscending }
        offline.sort { $0.username.localizedCaseInsensitiveCompare($1.username) == .orderedAscending }
        var result: [Member] = []
        if let me { result.append(me) }
        result.append(contentsOf: online)
        result.append(contentsOf: offline)
        return result
    }

    private func memberAvatar(_ member: Member) -> some View {
        let isOnline = member.userId == (authState.user?.id ?? "") || chatState.onlineUsers.contains(member.userId)
        return AvatarView(username: member.username, image: member.image, size: 34)
            .opacity(isOnline ? 1.0 : 0.4)
            .frame(width: 42, height: 38)
    }
}
