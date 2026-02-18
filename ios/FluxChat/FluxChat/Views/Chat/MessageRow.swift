import CryptoKit
import SwiftUI

/// Displays a single message matching the desktop Flux layout:
/// - Left-aligned with 36pt avatar, username + timestamp header, text below
/// - Continuation messages (same sender, <5min gap) indent by 46pt with no header
/// - No chat bubbles, text flows directly
/// - Reactions shown as small pills below the message
/// - Attachments below text
/// - Link previews for messages containing URLs
/// - Long-press triggers a Discord-style action sheet
struct MessageRow: View {
    @Environment(ChatState.self) private var chatState
    @Environment(AuthState.self) private var authState

    let message: Message
    let serverKey: SymmetricKey?
    let showHeader: Bool

    /// Binding to trigger the message action sheet in the parent view.
    var onLongPress: ((Message, String) -> Void)?

    // MARK: - Desktop Color Palette

    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555
    private let hoverBg = Color.white.opacity(0.02)
    private let highlightBg = Color.white.opacity(0.06)

    // Avatar width (36) + spacing (10) = 46pt indent for continuation messages
    private let avatarSize: CGFloat = 36
    private let avatarSpacing: CGFloat = 10
    private var continuationIndent: CGFloat { avatarSize + avatarSpacing }

    @State private var isHighlighted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showHeader {
                headerMessage
            } else {
                continuationMessage
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, showHeader ? 4 : 2)
        .background(isHighlighted ? highlightBg : Color.clear)
        .contentShape(Rectangle())
        .onLongPressGesture(minimumDuration: 0.4) {
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            onLongPress?(message, decryptedText)
        } onPressingChanged: { pressing in
            withAnimation(.easeInOut(duration: 0.1)) {
                isHighlighted = pressing
            }
        }
    }

    // MARK: - Header Message (avatar + name + time + text)

    private var headerMessage: some View {
        HStack(alignment: .top, spacing: avatarSpacing) {
            // Avatar
            AvatarView(
                username: senderName,
                image: senderImage,
                size: avatarSize
            )

            // Name + timestamp + message body
            VStack(alignment: .leading, spacing: 3) {
                // Username and timestamp row
                HStack(spacing: 6) {
                    Text(senderName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(AvatarColor.color(for: senderName))

                    Text(formattedTime)
                        .font(.system(size: 11))
                        .foregroundStyle(textMuted)
                }

                // Message text
                Text(decryptedText)
                    .font(.system(size: 15))
                    .foregroundStyle(textPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)

                if message.editedAt != nil {
                    Text("(edited)")
                        .font(.system(size: 10))
                        .foregroundStyle(textMuted)
                }

                // Link preview
                LinkPreviewView(messageText: decryptedText)

                // Attachments
                if let attachments = message.attachments, !attachments.isEmpty {
                    attachmentSection(attachments)
                }

                // Reactions
                if let rxnGroups = chatState.reactions[message.id], !rxnGroups.isEmpty {
                    reactionsRow(rxnGroups)
                }
            }
        }
    }

    // MARK: - Continuation Message (indented text only, no avatar/header)

    private var continuationMessage: some View {
        VStack(alignment: .leading, spacing: 3) {
            // Message text indented to align with header messages
            Text(decryptedText)
                .font(.system(size: 15))
                .foregroundStyle(textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)

            if message.editedAt != nil {
                Text("(edited)")
                    .font(.system(size: 10))
                    .foregroundStyle(textMuted)
            }

            // Link preview
            LinkPreviewView(messageText: decryptedText)

            // Attachments
            if let attachments = message.attachments, !attachments.isEmpty {
                attachmentSection(attachments)
            }

            // Reactions
            if let rxnGroups = chatState.reactions[message.id], !rxnGroups.isEmpty {
                reactionsRow(rxnGroups)
            }
        }
        .padding(.leading, continuationIndent)
    }

    // MARK: - Attachments

    @ViewBuilder
    private func attachmentSection(_ attachments: [Attachment]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(attachments) { attachment in
                if attachment.contentType.hasPrefix("image/") {
                    AsyncImage(url: URL(string: attachment.fileURL)) { phase in
                        switch phase {
                        case .success(let img):
                            img
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: 300, maxHeight: 300)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        case .failure:
                            attachmentFileRow(attachment)
                        default:
                            RoundedRectangle(cornerRadius: 6)
                                .fill(Color.white.opacity(0.04))
                                .frame(width: 200, height: 120)
                                .overlay(ProgressView().tint(textMuted))
                        }
                    }
                } else {
                    attachmentFileRow(attachment)
                }
            }
        }
        .padding(.top, 4)
    }

    private func attachmentFileRow(_ attachment: Attachment) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "doc.fill")
                .foregroundStyle(textSecondary)
                .font(.system(size: 14))
            VStack(alignment: .leading, spacing: 1) {
                Text(attachment.filename)
                    .font(.system(size: 13))
                    .foregroundStyle(textPrimary.opacity(0.8))
                    .lineLimit(1)
                Text(formatFileSize(attachment.size))
                    .font(.system(size: 11))
                    .foregroundStyle(textMuted)
            }
        }
        .padding(8)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    // MARK: - Reactions

    private func reactionsRow(_ groups: [(emoji: String, userIds: [String])]) -> some View {
        FlowLayout(spacing: 4) {
            ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                Button {
                    let myId = authState.user?.id ?? ""
                    if group.userIds.contains(myId) {
                        chatState.removeReaction(messageId: message.id, emoji: group.emoji)
                    } else {
                        chatState.addReaction(messageId: message.id, emoji: group.emoji)
                    }
                } label: {
                    HStack(spacing: 3) {
                        Text(group.emoji)
                            .font(.system(size: 12))
                        Text("\(group.userIds.count)")
                            .font(.system(size: 11))
                            .foregroundStyle(textSecondary)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(
                        group.userIds.contains(authState.user?.id ?? "")
                            ? Color.white.opacity(0.12)
                            : Color.white.opacity(0.05)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(
                                group.userIds.contains(authState.user?.id ?? "")
                                    ? Color.white.opacity(0.2)
                                    : Color.clear,
                                lineWidth: 1
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 4)
    }

    // MARK: - Helpers

    private var decryptedText: String {
        chatState.decryptedText(for: message, key: serverKey)
    }

    private var senderName: String {
        chatState.username(for: message.senderId)
    }

    private var senderImage: String? {
        chatState.member(for: message.senderId)?.image
    }

    private var formattedTime: String {
        formatTimestamp(message.createdAt)
    }

    private func formatTimestamp(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else {
            formatter.formatOptions = [.withInternetDateTime]
            guard let date2 = formatter.date(from: iso) else { return iso }
            return timeString(date2)
        }
        return timeString(date)
    }

    private func timeString(_ date: Date) -> String {
        let calendar = Calendar.current
        let timeFormatter = DateFormatter()

        if calendar.isDateInToday(date) {
            timeFormatter.dateFormat = "h:mm a"
            return "Today at \(timeFormatter.string(from: date))"
        } else if calendar.isDateInYesterday(date) {
            timeFormatter.dateFormat = "h:mm a"
            return "Yesterday at \(timeFormatter.string(from: date))"
        } else {
            timeFormatter.dateFormat = "M/d/yy h:mm a"
            return timeFormatter.string(from: date)
        }
    }

    private func formatFileSize(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return "\(bytes / 1024) KB" }
        return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
    }
}

// MARK: - Flow Layout for Reactions

/// A simple horizontal flow layout that wraps to the next line when out of space.
struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(in: proposal.width ?? 0, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(in: bounds.width, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private struct LayoutResult {
        var positions: [CGPoint]
        var size: CGSize
    }

    private func layout(in maxWidth: CGFloat, subviews: Subviews) -> LayoutResult {
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            maxX = max(maxX, x)
        }

        return LayoutResult(
            positions: positions,
            size: CGSize(width: maxX, height: y + rowHeight)
        )
    }
}
