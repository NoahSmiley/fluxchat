import SwiftUI

/// Discord-style right drawer showing the member list for the current server.
/// Displays ONLINE and OFFLINE sections with avatars, usernames, role badges,
/// and online status indicators. Tapping a member shows a profile bottom sheet.
struct MemberDrawerView: View {
    @Environment(ChatState.self) private var chatState
    @Environment(AuthState.self) private var authState

    let serverId: String

    @State private var selectedMember: Member?

    // MARK: - Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)   // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055) // #0e0e0e
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)  // #1a1a1a
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086) // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555

    var body: some View {
        VStack(spacing: 0) {
            // Header
            memberHeader

            Rectangle()
                .fill(borderColor)
                .frame(height: 1)

            // Member list
            memberList
        }
        .background(bgPrimary)
        .sheet(item: $selectedMember) { member in
            MemberProfileSheet(member: member)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(bgSecondary)
        }
    }

    // MARK: - Header

    private var memberHeader: some View {
        HStack {
            Text("Members")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(textPrimary)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(bgPrimary)
    }

    // MARK: - Member List

    private var memberList: some View {
        let members = chatState.membersByServer[serverId] ?? []
        let online = members.filter { chatState.onlineUsers.contains($0.userId) }
        let offline = members.filter { !chatState.onlineUsers.contains($0.userId) }

        return ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0) {
                // Online section
                if !online.isEmpty {
                    sectionTitle("ONLINE \u{2014} \(online.count)")
                    ForEach(online) { member in
                        memberRow(member, isOnline: true)
                    }
                }

                // Offline section
                if !offline.isEmpty {
                    sectionTitle("OFFLINE \u{2014} \(offline.count)")
                        .padding(.top, 12)
                    ForEach(offline) { member in
                        memberRow(member, isOnline: false)
                    }
                }
            }
            .padding(.vertical, 8)
        }
    }

    // MARK: - Section Title

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(textMuted)
            .tracking(0.5)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
    }

    // MARK: - Member Row

    private func memberRow(_ member: Member, isOnline: Bool) -> some View {
        Button {
            selectedMember = member
        } label: {
            HStack(spacing: 10) {
                // Avatar with status dot
                ZStack(alignment: .bottomTrailing) {
                    AvatarView(
                        username: member.username,
                        image: member.image,
                        size: 32
                    )
                    .opacity(isOnline ? 1.0 : 0.4)

                    Circle()
                        .fill(isOnline ? Color.green : Color.gray)
                        .frame(width: 10, height: 10)
                        .overlay(
                            Circle()
                                .stroke(bgPrimary, lineWidth: 2)
                        )
                        .offset(x: 2, y: 2)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Text(member.username)
                            .font(.system(size: 14))
                            .foregroundStyle(isOnline ? textPrimary : textSecondary)
                            .lineLimit(1)

                        if member.role != .member {
                            roleBadge(member.role)
                        }
                    }

                    // Activity
                    if let activity = chatState.activities[member.userId] {
                        activityLabel(activity)
                    }
                }

                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Role Badge

    private func roleBadge(_ role: MemberRole) -> some View {
        Text(role.rawValue.capitalized)
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.white.opacity(0.8))
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                role == .owner
                    ? Color.orange.opacity(0.5)
                    : Color.white.opacity(0.15)
            )
            .clipShape(RoundedRectangle(cornerRadius: 3))
    }

    // MARK: - Activity Label

    private func activityLabel(_ activity: ActivityInfo) -> some View {
        HStack(spacing: 3) {
            if activity.activityType == "listening" {
                Image(systemName: "music.note")
                    .font(.system(size: 9))
            } else if activity.activityType == "playing" {
                Image(systemName: "gamecontroller.fill")
                    .font(.system(size: 9))
            }
            Text(activity.name)
                .font(.system(size: 11))
                .lineLimit(1)
        }
        .foregroundStyle(.green.opacity(0.7))
    }
}

// MARK: - Member Profile Bottom Sheet

/// A bottom sheet showing member profile info when tapped.
struct MemberProfileSheet: View {
    let member: Member

    @Environment(ChatState.self) private var chatState

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055)
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086)
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533)
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)

    var body: some View {
        VStack(spacing: 0) {
            // Banner area
            Rectangle()
                .fill(AvatarColor.color(for: member.username).opacity(0.3))
                .frame(height: 60)

            // Avatar + info
            VStack(spacing: 12) {
                AvatarView(
                    username: member.username,
                    image: member.image,
                    size: 72
                )
                .overlay(
                    Circle()
                        .stroke(bgSecondary, lineWidth: 4)
                )
                .offset(y: -36)
                .padding(.bottom, -36)

                Text(member.username)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(textPrimary)

                if member.role != .member {
                    Text(member.role.rawValue.capitalized)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.8))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            member.role == .owner
                                ? Color.orange.opacity(0.4)
                                : Color.white.opacity(0.12)
                        )
                        .clipShape(Capsule())
                }

                // Status
                let isOnline = chatState.onlineUsers.contains(member.userId)
                HStack(spacing: 6) {
                    Circle()
                        .fill(isOnline ? Color.green : Color.gray)
                        .frame(width: 8, height: 8)
                    Text(isOnline ? "Online" : "Offline")
                        .font(.system(size: 13))
                        .foregroundStyle(textSecondary)
                }

                // Activity
                if let activity = chatState.activities[member.userId] {
                    HStack(spacing: 6) {
                        if activity.activityType == "listening" {
                            Image(systemName: "music.note")
                                .font(.system(size: 12))
                        } else if activity.activityType == "playing" {
                            Image(systemName: "gamecontroller.fill")
                                .font(.system(size: 12))
                        }
                        Text(activity.name)
                            .font(.system(size: 13))
                    }
                    .foregroundStyle(.green.opacity(0.8))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.green.opacity(0.08))
                    .clipShape(Capsule())
                }

                Spacer()
            }
            .padding(.top, 8)
        }
        .background(bgSecondary)
        .preferredColorScheme(.dark)
    }
}
