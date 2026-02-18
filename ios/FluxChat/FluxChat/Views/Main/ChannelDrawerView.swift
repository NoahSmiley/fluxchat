import SwiftUI

/// Left drawer panel matching the desktop Tauri ServerSidebar layout:
/// - Left strip (~60pt): Flux logo at top, scrollable member avatars,
///   FluxFloat button + settings gear at bottom
/// - Right area: channel list (full remaining width)
/// - No server icon rail, no DM toggle button
struct ChannelDrawerView: View {
    @Environment(AuthState.self) private var authState
    @Environment(ChatState.self) private var chatState
    @Environment(VoiceState.self) private var voiceState

    /// Called when the user taps any channel (text or voice) to navigate to it.
    let onSelectChannel: (Channel) -> Void
    /// Called when the user taps a DM conversation.
    let onSelectDM: (DMChannel) -> Void
    /// Called when the user wants to open settings.
    let onOpenSettings: () -> Void

    @State private var collapsedCategories: Set<String> = []
    @State private var hoveredMemberId: String?

    // MARK: - Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)   // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055) // #0e0e0e
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)  // #1a1a1a
    private let bgInput = Color(red: 0.086, green: 0.086, blue: 0.086)     // #161616
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086) // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555
    private let activeChannelBg = Color.white.opacity(0.08)

    var body: some View {
        HStack(spacing: 0) {
            memberSidebar

            Rectangle()
                .fill(borderColor)
                .frame(width: 1)

            channelListPanel
        }
        .background(bgPrimary)
    }

    // MARK: - Member Sidebar (Left Strip)

    private var memberSidebar: some View {
        VStack(spacing: 0) {
            // Flux logo at top
            Button {
                // Logo tap -> select first server (home)
                if let first = chatState.servers.first {
                    Task { await chatState.selectServer(first.id) }
                }
            } label: {
                FluxLogoView(size: 36)
                    .foregroundStyle(.white)
                    .frame(width: 60, height: 48)
            }
            .buttonStyle(.plain)

            // Thin separator below logo
            RoundedRectangle(cornerRadius: 1)
                .fill(Color.white.opacity(0.08))
                .frame(width: 32, height: 2)
                .padding(.bottom, 8)

            // Scrollable member avatars
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 6) {
                    ForEach(sortedMembers, id: \.userId) { member in
                        memberAvatar(member)
                    }
                }
                .padding(.vertical, 4)
            }

            Spacer(minLength: 0)

            // Bottom buttons: FluxFloat + Settings
            VStack(spacing: 6) {
                // FluxFloat button (shopping bag)
                Button {
                    // FluxFloat action placeholder
                } label: {
                    Image(systemName: "bag.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(textMuted)
                        .frame(width: 40, height: 40)
                        .background(bgTertiary)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                // Settings button (gear)
                Button {
                    onOpenSettings()
                } label: {
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(textMuted)
                        .frame(width: 40, height: 40)
                        .background(bgTertiary)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 10)
        }
        .frame(width: 60)
        .background(bgSecondary)
    }

    // MARK: - Sorted Members

    /// Members sorted: self first, then online (alphabetical), then offline (alphabetical, dimmed).
    private var sortedMembers: [Member] {
        guard let serverId = chatState.selectedServerId,
              let members = chatState.membersByServer[serverId] else {
            return []
        }

        let myId = authState.user?.id ?? ""

        // Partition into self, online others, offline others
        var selfMember: Member?
        var onlineMembers: [Member] = []
        var offlineMembers: [Member] = []

        for member in members {
            if member.userId == myId {
                selfMember = member
            } else if chatState.onlineUsers.contains(member.userId) {
                onlineMembers.append(member)
            } else {
                offlineMembers.append(member)
            }
        }

        onlineMembers.sort { $0.username.localizedCaseInsensitiveCompare($1.username) == .orderedAscending }
        offlineMembers.sort { $0.username.localizedCaseInsensitiveCompare($1.username) == .orderedAscending }

        var result: [Member] = []
        if let me = selfMember {
            result.append(me)
        }
        result.append(contentsOf: onlineMembers)
        result.append(contentsOf: offlineMembers)
        return result
    }

    // MARK: - Member Avatar

    private func memberAvatar(_ member: Member) -> some View {
        let myId = authState.user?.id ?? ""
        let isOnline = member.userId == myId || chatState.onlineUsers.contains(member.userId)
        let isHovered = hoveredMemberId == member.userId

        return ZStack {
            AvatarView(
                username: member.username,
                image: member.image,
                size: 38
            )
            .opacity(isOnline ? 1.0 : 0.4)

            // Tooltip overlay when tapped
            if isHovered {
                Text(member.username)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(textPrimary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(bgTertiary)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .offset(x: 44)
                    .transition(.opacity.combined(with: .scale(scale: 0.8)))
            }
        }
        .frame(width: 48, height: 42)
        .contentShape(Rectangle())
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.15)) {
                if hoveredMemberId == member.userId {
                    hoveredMemberId = nil
                } else {
                    hoveredMemberId = member.userId
                }
            }
        }
    }

    // MARK: - Channel List Panel

    private var channelListPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Channel list
            if let serverId = chatState.selectedServerId {
                let channels = chatState.channelsByServer[serverId] ?? []
                let grouped = groupChannels(channels)

                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(grouped) { group in
                            if let cat = group.category {
                                categoryHeader(cat, children: group.children)
                            } else {
                                ForEach(group.children) { channel in
                                    channelRow(channel)
                                }
                            }
                        }
                    }
                    .padding(.top, 8)
                    .padding(.bottom, 16)
                }
            } else {
                Spacer()
                HStack {
                    Spacer()
                    ProgressView()
                        .tint(textMuted)
                    Spacer()
                }
                Spacer()
            }
        }
        .background(bgPrimary)
    }

    // MARK: - Server Header

    private var serverHeader: some View {
        HStack {
            FluxLogoView(size: 22)
                .foregroundStyle(.white)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(bgPrimary)
    }

    // MARK: - Category Header

    private func categoryHeader(_ category: Channel, children: [Channel]) -> some View {
        let isCollapsed = collapsedCategories.contains(category.id)

        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    if isCollapsed {
                        collapsedCategories.remove(category.id)
                    } else {
                        collapsedCategories.insert(category.id)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(textMuted)
                        .rotationEffect(.degrees(isCollapsed ? 0 : 90))

                    Text(category.name.uppercased())
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(textMuted)
                        .tracking(0.5)
                        .lineLimit(1)

                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.top, 18)
                .padding(.bottom, 4)
            }
            .buttonStyle(.plain)

            if !isCollapsed {
                ForEach(children) { channel in
                    channelRow(channel)
                }
            }
        }
    }

    // MARK: - Channel Row

    private func channelRow(_ channel: Channel) -> some View {
        let isSelected = channel.id == chatState.selectedChannelId
        let isUnread = chatState.unreadChannels.contains(channel.id)

        return Button {
            onSelectChannel(channel)
        } label: {
            HStack(spacing: 8) {
                // Channel type icon
                channelIcon(for: channel.type)
                    .font(.system(size: 15))
                    .foregroundStyle(isSelected ? textPrimary : (isUnread ? textPrimary : textMuted))
                    .frame(width: 20)

                // Channel name
                Text(channel.name)
                    .font(.system(size: 15))
                    .foregroundStyle(isSelected ? textPrimary : (isUnread ? textPrimary : textSecondary))
                    .fontWeight(isUnread ? .semibold : .regular)
                    .lineLimit(1)

                Spacer()

                // Voice participant count
                if channel.type == .voice,
                   let participants = chatState.channelParticipants[channel.id],
                   !participants.isEmpty {
                    Text("\(participants.count)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(textPrimary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green.opacity(0.2))
                        .clipShape(Capsule())
                }

                // Unread dot
                if isUnread && !isSelected {
                    Circle()
                        .fill(.white)
                        .frame(width: 6, height: 6)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isSelected ? activeChannelBg : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 6)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Channel Icon

    @ViewBuilder
    private func channelIcon(for type: ChannelType) -> some View {
        switch type {
        case .text:
            Image(systemName: "text.bubble")
        case .voice:
            Image(systemName: "speaker.wave.2.fill")
        case .game:
            Image(systemName: "gamecontroller.fill")
        case .category:
            Image(systemName: "folder.fill")
        }
    }

    // MARK: - Channel Grouping

    struct ChannelGroup: Identifiable {
        let id: String
        let category: Channel?
        let children: [Channel]
    }

    private func groupChannels(_ channels: [Channel]) -> [ChannelGroup] {
        var groups: [ChannelGroup] = []
        let sorted = channels.sorted { $0.position < $1.position }

        let rootChannels = sorted.filter { $0.parentId == nil && $0.type != .category }
        if !rootChannels.isEmpty {
            groups.append(ChannelGroup(id: "root", category: nil, children: rootChannels))
        }

        let categories = sorted.filter { $0.type == .category && $0.parentId == nil }
        for cat in categories {
            let children = sorted.filter { $0.parentId == cat.id && $0.type != .category }
            groups.append(ChannelGroup(id: cat.id, category: cat, children: children))
        }

        return groups
    }
}
