import SwiftUI

/// Channel list for the currently selected server. Groups channels by category
/// (parentId tree) with collapsible headers. Text channels show a # icon,
/// voice channels show a speaker icon with participant count. Unread channels
/// display a blue dot indicator.
struct ChannelListView: View {
    @Environment(ChatState.self) private var chatState

    let serverId: String

    @State private var collapsedCategories: Set<String> = []

    // MARK: - Colors

    private let bgColor = Color(red: 0.09, green: 0.09, blue: 0.11)
    private let headerColor = Color.white.opacity(0.45)
    private let selectedBg = Color.white.opacity(0.08)
    private let unreadDot = Color(red: 0.35, green: 0.55, blue: 1.0)

    var body: some View {
        let channels = chatState.channelsByServer[serverId] ?? []
        let tree = buildChannelTree(channels)

        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 1) {
                // Server name header
                serverHeader

                // Top-level channels (no parent)
                ForEach(tree.topLevel) { channel in
                    channelRow(channel)
                }

                // Categories with their children
                ForEach(tree.categories) { category in
                    categorySection(category, children: tree.children[category.id] ?? [])
                }
            }
            .padding(.vertical, 8)
        }
        .background(bgColor)
    }

    // MARK: - Server Header

    private var serverHeader: some View {
        Group {
            if let server = chatState.servers.first(where: { $0.id == serverId }) {
                HStack {
                    Text(server.name)
                        .font(.headline)
                        .fontWeight(.bold)
                        .foregroundStyle(.white)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
        }
    }

    // MARK: - Category Section

    private func categorySection(_ category: Channel, children: [Channel]) -> some View {
        let isCollapsed = collapsedCategories.contains(category.id)

        return VStack(alignment: .leading, spacing: 1) {
            // Category header
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
                        .foregroundStyle(headerColor)
                        .rotationEffect(.degrees(isCollapsed ? 0 : 90))

                    Text(category.name.uppercased())
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(headerColor)
                        .lineLimit(1)

                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 4)
            }
            .buttonStyle(.plain)

            // Children
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
        let participants = chatState.channelParticipants[channel.id] ?? []

        return Button {
            if channel.type == .text || channel.type == .game {
                Task { await chatState.selectChannel(channel.id) }
            }
            // Voice channels would trigger voice join (handled elsewhere)
        } label: {
            HStack(spacing: 8) {
                // Unread indicator
                Circle()
                    .fill(isUnread ? unreadDot : .clear)
                    .frame(width: 6, height: 6)

                // Channel icon
                channelIcon(for: channel.type)
                    .font(.system(size: 15))
                    .foregroundStyle(isSelected ? .white : (isUnread ? .white.opacity(0.8) : .gray))

                // Channel name
                Text(channel.name)
                    .font(.subheadline)
                    .foregroundStyle(isSelected ? .white : (isUnread ? .white.opacity(0.9) : .gray))
                    .lineLimit(1)

                Spacer()

                // Voice participants count
                if channel.type == .voice && !participants.isEmpty {
                    HStack(spacing: 3) {
                        Image(systemName: "person.fill")
                            .font(.system(size: 10))
                        Text("\(participants.count)")
                            .font(.caption2)
                    }
                    .foregroundStyle(.green.opacity(0.8))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(isSelected ? selectedBg : .clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .padding(.horizontal, 8)
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

    // MARK: - Channel Tree Builder

    private struct ChannelTree {
        var topLevel: [Channel]      // non-category channels with no parent
        var categories: [Channel]    // category channels
        var children: [String: [Channel]]  // parentId -> child channels
    }

    private func buildChannelTree(_ channels: [Channel]) -> ChannelTree {
        let categories = channels.filter { $0.type == .category }.sorted { $0.position < $1.position }
        let categoryIds = Set(categories.map(\.id))

        var children: [String: [Channel]] = [:]
        var topLevel: [Channel] = []

        for ch in channels where ch.type != .category {
            if let parentId = ch.parentId, categoryIds.contains(parentId) {
                children[parentId, default: []].append(ch)
            } else {
                topLevel.append(ch)
            }
        }

        // Sort children by position
        for key in children.keys {
            children[key]?.sort { $0.position < $1.position }
        }
        topLevel.sort { $0.position < $1.position }

        return ChannelTree(topLevel: topLevel, categories: categories, children: children)
    }
}
