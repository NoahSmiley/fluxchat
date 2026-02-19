import SwiftUI

/// Displays the list of DM conversations for the current user.
/// Matches the desktop Flux DM sidebar with near-black monochrome aesthetic.
struct DMListView: View {
    @Environment(AuthState.self) private var authState
    @Environment(ChatState.self) private var chatState
    @Environment(CryptoState.self) private var cryptoState

    @State private var searchText = ""

    // MARK: - Desktop Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)       // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055)     // #0e0e0e
    private let bgInput = Color(red: 0.086, green: 0.086, blue: 0.086)         // #161616
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)      // #1a1a1a
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086)     // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)        // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533)   // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)       // #555555
    private let selectedBg = Color.white.opacity(0.08)

    // MARK: - Filtered Channels

    private var filteredChannels: [DMChannel] {
        if searchText.isEmpty {
            return chatState.dmChannels
        }
        return chatState.dmChannels.filter {
            $0.otherUser.username.localizedCaseInsensitiveContains(searchText)
        }
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            // Section label (desktop dm-header-label style)
            HStack {
                Text("DIRECT MESSAGES")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(textMuted)
                    .tracking(0.5)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 10)

            // Search bar
            searchBar

            // Content
            if chatState.dmChannels.isEmpty {
                emptyState
            } else if filteredChannels.isEmpty {
                noResultsState
            } else {
                dmList
            }
        }
        .background(bgPrimary)
        .task {
            await chatState.loadDMChannels()
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(textMuted)
                .font(.system(size: 13))

            TextField("Search conversations...", text: $searchText)
                .foregroundStyle(textPrimary)
                .font(.system(size: 14))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(bgInput)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(bgTertiary, lineWidth: 1)
        )
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    // MARK: - DM List

    private var dmList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                ForEach(filteredChannels) { channel in
                    DMRowView(
                        channel: channel,
                        isSelected: chatState.selectedDMChannelId == channel.id,
                        isOnline: chatState.onlineUsers.contains(channel.otherUser.id),
                        textPrimary: textPrimary,
                        textSecondary: textSecondary,
                        selectedBg: selectedBg,
                        bgPrimary: bgPrimary
                    )
                    .onTapGesture {
                        Task {
                            await chatState.selectDM(channel.id)
                        }
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.top, 4)
        }
        .refreshable {
            await chatState.loadDMChannels()
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Spacer()

            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 36))
                .foregroundStyle(textMuted.opacity(0.6))

            Text("No conversations yet")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(textMuted)

            Text("Start a DM from a user's profile")
                .font(.system(size: 13))
                .foregroundStyle(textMuted.opacity(0.7))

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - No Search Results

    private var noResultsState: some View {
        VStack(spacing: 8) {
            Spacer()

            Text("No results found")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(textMuted)

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - DM Row View

/// A single row in the DM list showing the other user's avatar, name, and
/// online status indicator. Matches desktop Flux DM sidebar entry styling.
private struct DMRowView: View {
    let channel: DMChannel
    let isSelected: Bool
    let isOnline: Bool
    let textPrimary: Color
    let textSecondary: Color
    let selectedBg: Color
    let bgPrimary: Color

    var body: some View {
        HStack(spacing: 12) {
            // Avatar with online indicator
            ZStack(alignment: .bottomTrailing) {
                AvatarView(
                    username: channel.otherUser.username,
                    image: channel.otherUser.image,
                    size: 36
                )

                // Online indicator dot
                if isOnline {
                    Circle()
                        .fill(Color(red: 0.298, green: 0.686, blue: 0.314)) // muted green
                        .frame(width: 10, height: 10)
                        .overlay(
                            Circle()
                                .stroke(bgPrimary, lineWidth: 2)
                        )
                        .offset(x: 1, y: 1)
                }
            }

            // Username
            Text(channel.otherUser.username)
                .font(.system(size: 14, weight: isSelected ? .semibold : .medium))
                .foregroundStyle(isSelected ? .white : textSecondary)
                .lineLimit(1)

            Spacer()

            // Online text indicator
            if isOnline {
                Circle()
                    .fill(Color(red: 0.298, green: 0.686, blue: 0.314))
                    .frame(width: 6, height: 6)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(isSelected ? selectedBg : .clear)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
    }
}

#Preview {
    DMListView()
        .environment(AuthState())
        .environment(ChatState())
        .environment(CryptoState())
}
