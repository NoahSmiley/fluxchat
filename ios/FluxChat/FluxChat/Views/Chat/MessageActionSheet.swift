import SwiftUI

/// Discord-style bottom sheet that appears when long-pressing a message.
/// Shows a row of quick reaction emojis at the top, followed by action buttons
/// like Reply, Edit, Copy Text, and Delete. Styled as a dark bottom sheet
/// matching the Flux color scheme.
struct MessageActionSheet: View {
    let message: Message
    let isOwnMessage: Bool
    let messageText: String
    let onReaction: (String) -> Void
    let onReply: () -> Void
    let onEdit: () -> Void
    let onCopyText: () -> Void
    let onDelete: () -> Void
    let onDismiss: () -> Void

    // MARK: - Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)   // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055) // #0e0e0e
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)  // #1a1a1a
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086) // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555
    private let danger = Color(red: 1.0, green: 0.267, blue: 0.267)        // #ff4444

    private let quickReactions = [
        "\u{1F44D}", // thumbs up
        "\u{1F44E}", // thumbs down
        "\u{2764}\u{FE0F}", // red heart
        "\u{1F602}", // laughing
        "\u{1F62E}", // surprised
        "\u{1F622}", // crying
        "\u{1F525}", // fire
        "\u{1F389}", // party
        "\u{1F440}", // eyes
        "\u{1F5FF}"  // moai
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Drag indicator
            RoundedRectangle(cornerRadius: 3)
                .fill(textMuted)
                .frame(width: 36, height: 4)
                .padding(.top, 10)
                .padding(.bottom, 14)

            // Quick reaction row
            quickReactionRow
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

            // Divider
            Rectangle()
                .fill(borderColor)
                .frame(height: 1)
                .padding(.horizontal, 16)

            // Action buttons
            VStack(spacing: 0) {
                actionButton(
                    icon: "arrowshape.turn.up.left",
                    label: "Reply",
                    action: {
                        onDismiss()
                        onReply()
                    }
                )

                if isOwnMessage {
                    actionButton(
                        icon: "pencil",
                        label: "Edit Message",
                        action: {
                            onDismiss()
                            onEdit()
                        }
                    )
                }

                actionButton(
                    icon: "doc.on.doc",
                    label: "Copy Text",
                    action: {
                        UIPasteboard.general.string = messageText
                        onDismiss()
                        onCopyText()
                    }
                )

                actionButton(
                    icon: "pin",
                    label: "Pin Message",
                    action: {
                        onDismiss()
                    }
                )

                if isOwnMessage {
                    Rectangle()
                        .fill(borderColor)
                        .frame(height: 1)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 4)

                    actionButton(
                        icon: "trash",
                        label: "Delete Message",
                        color: danger,
                        action: {
                            onDismiss()
                            onDelete()
                        }
                    )
                }
            }
            .padding(.vertical, 8)

            Spacer().frame(height: 20)
        }
        .background(bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .preferredColorScheme(.dark)
    }

    // MARK: - Quick Reaction Row

    private var quickReactionRow: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                ForEach(quickReactions.prefix(5), id: \.self) { emoji in
                    reactionButton(emoji)
                }
            }
            HStack(spacing: 6) {
                ForEach(quickReactions.suffix(5), id: \.self) { emoji in
                    reactionButton(emoji)
                }
            }
        }
    }

    private func reactionButton(_ emoji: String) -> some View {
        Button {
            onReaction(emoji)
            onDismiss()
        } label: {
            Text(emoji)
                .font(.system(size: 24))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(bgTertiary)
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Action Button

    private func actionButton(
        icon: String,
        label: String,
        color: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                    .foregroundStyle(color ?? textSecondary)
                    .frame(width: 24)

                Text(label)
                    .font(.system(size: 15))
                    .foregroundStyle(color ?? textPrimary)

                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Message Action Sheet Overlay

/// A full-screen overlay that dims the background and presents the
/// MessageActionSheet from the bottom. Handles tap-to-dismiss and
/// drag-to-dismiss gestures.
struct MessageActionOverlay: View {
    let message: Message
    let isOwnMessage: Bool
    let messageText: String
    let onReaction: (String) -> Void
    let onReply: () -> Void
    let onEdit: () -> Void
    let onCopyText: () -> Void
    let onDelete: () -> Void
    @Binding var isPresented: Bool

    @State private var sheetOffset: CGFloat = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            // Dimmed background
            Color.black.opacity(0.5)
                .ignoresSafeArea()
                .onTapGesture {
                    dismiss()
                }

            // Sheet
            MessageActionSheet(
                message: message,
                isOwnMessage: isOwnMessage,
                messageText: messageText,
                onReaction: onReaction,
                onReply: onReply,
                onEdit: onEdit,
                onCopyText: onCopyText,
                onDelete: onDelete,
                onDismiss: { dismiss() }
            )
            .offset(y: sheetOffset)
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if value.translation.height > 0 {
                            sheetOffset = value.translation.height
                        }
                    }
                    .onEnded { value in
                        if value.translation.height > 100 {
                            dismiss()
                        } else {
                            withAnimation(.spring(response: 0.3)) {
                                sheetOffset = 0
                            }
                        }
                    }
            )
            .transition(.move(edge: .bottom))
        }
        .animation(.spring(response: 0.3), value: isPresented)
    }

    private func dismiss() {
        withAnimation(.spring(response: 0.3)) {
            isPresented = false
        }
    }
}
