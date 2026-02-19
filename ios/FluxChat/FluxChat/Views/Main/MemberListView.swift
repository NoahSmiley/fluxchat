import SwiftUI

/// Member list panel for the selected server. Displays members grouped into
/// Online and Offline sections. Each member shows their avatar, username,
/// role badge, and online status dot.
struct MemberListView: View {
    @Environment(ChatState.self) private var chatState

    let serverId: String

    // MARK: - Colors

    private let bgColor = Color(red: 0.09, green: 0.09, blue: 0.11)
    private let sectionHeader = Color.white.opacity(0.4)

    var body: some View {
        let members = chatState.membersByServer[serverId] ?? []
        let online = members.filter { chatState.onlineUsers.contains($0.userId) }
        let offline = members.filter { !chatState.onlineUsers.contains($0.userId) }

        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 2) {
                // Online section
                if !online.isEmpty {
                    sectionTitle("ONLINE -- \(online.count)")
                    ForEach(online) { member in
                        memberRow(member, isOnline: true)
                    }
                }

                // Offline section
                if !offline.isEmpty {
                    sectionTitle("OFFLINE -- \(offline.count)")
                        .padding(.top, 12)
                    ForEach(offline) { member in
                        memberRow(member, isOnline: false)
                    }
                }
            }
            .padding(.vertical, 12)
        }
        .frame(width: 220)
        .background(bgColor)
    }

    // MARK: - Section Title

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(sectionHeader)
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
    }

    // MARK: - Member Row

    private func memberRow(_ member: Member, isOnline: Bool) -> some View {
        HStack(spacing: 10) {
            // Avatar with online dot
            ZStack(alignment: .bottomTrailing) {
                AvatarView(
                    username: member.username,
                    image: member.image,
                    size: 32
                )
                .opacity(isOnline ? 1.0 : 0.4)

                // Status dot
                Circle()
                    .fill(isOnline ? Color.green : Color.gray)
                    .frame(width: 10, height: 10)
                    .overlay(
                        Circle()
                            .stroke(Color(red: 0.09, green: 0.09, blue: 0.11), lineWidth: 2)
                    )
                    .offset(x: 2, y: 2)
            }

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(member.username)
                        .font(.subheadline)
                        .foregroundStyle(isOnline ? .white : .gray)
                        .lineLimit(1)

                    // Role badge
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
        .padding(.vertical, 4)
        .contentShape(Rectangle())
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
                    : Color(red: 0.35, green: 0.55, blue: 1.0).opacity(0.4)
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
                .font(.caption2)
                .lineLimit(1)
        }
        .foregroundStyle(.green.opacity(0.7))
    }
}
