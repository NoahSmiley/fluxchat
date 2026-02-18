import CryptoKit
import SwiftUI

/// Displays a DM conversation with another user. Shows decrypted messages,
/// a text input bar, and the other user's info in the header.
struct DMChatView: View {
    let dmChannel: DMChannel

    @Environment(AuthState.self) private var authState
    @Environment(ChatState.self) private var chatState
    @Environment(CryptoState.self) private var cryptoState

    @State private var messageText = ""
    @State private var dmKey: SymmetricKey?
    @State private var keyError: String?
    @State private var scrollProxy: ScrollViewProxy?

    // MARK: - Colors

    private let bgColor = Color(red: 0.07, green: 0.07, blue: 0.09)
    private let cardColor = Color(red: 0.11, green: 0.11, blue: 0.14)
    private let inputBgColor = Color(red: 0.13, green: 0.13, blue: 0.16)
    private let accentColor = Color(red: 0.35, green: 0.55, blue: 1.0)

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            // Header
            dmHeader

            Divider()
                .background(Color.white.opacity(0.1))

            // Messages area
            if let keyError {
                keyErrorView(keyError)
            } else {
                messageList
            }

            // Input bar
            inputBar
        }
        .background(bgColor)
        .task {
            await loadConversation()
        }
    }

    // MARK: - Header

    private var dmHeader: some View {
        HStack(spacing: 12) {
            AvatarView(
                username: dmChannel.otherUser.username,
                image: dmChannel.otherUser.image,
                size: 32
            )

            VStack(alignment: .leading, spacing: 1) {
                Text(dmChannel.otherUser.username)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)

                let isOnline = chatState.onlineUsers.contains(dmChannel.otherUser.id)
                Text(isOnline ? "Online" : "Offline")
                    .font(.system(size: 12))
                    .foregroundStyle(isOnline ? .green : .gray)
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(cardColor)
    }

    // MARK: - Key Error

    private func keyErrorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Spacer()

            Image(systemName: "lock.slash")
                .font(.system(size: 40))
                .foregroundStyle(.red.opacity(0.7))

            Text("Encryption Error")
                .font(.headline)
                .foregroundStyle(.white)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.gray)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button("Retry") {
                Task { await loadConversation() }
            }
            .buttonStyle(.borderedProminent)
            .tint(accentColor)

            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Message List

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(chatState.dmMessages) { message in
                        DMMessageRow(
                            message: message,
                            dmKey: dmKey,
                            isOwnMessage: message.senderId == authState.user?.id,
                            otherUser: dmChannel.otherUser,
                            currentUser: authState.user
                        )
                        .id(message.id)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .onChange(of: chatState.dmMessages.count) { _, _ in
                // Auto-scroll to newest message
                if let lastId = chatState.dmMessages.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
            .onAppear {
                scrollProxy = proxy
                // Scroll to bottom on initial load
                if let lastId = chatState.dmMessages.last?.id {
                    proxy.scrollTo(lastId, anchor: .bottom)
                }
            }
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 12) {
            TextField("Message \(dmChannel.otherUser.username)", text: $messageText)
                .foregroundStyle(.white)
                .font(.system(size: 15))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(inputBgColor)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .onSubmit {
                    sendMessage()
                }

            // Send button
            Button {
                sendMessage()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(canSend ? accentColor : .gray.opacity(0.4))
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(cardColor)
    }

    // MARK: - Helpers

    private var canSend: Bool {
        !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && dmKey != nil
    }

    private func loadConversation() async {
        // 1. Derive the DM encryption key
        do {
            let theirPublicKey = try await KeyAPI.getPublicKey(userId: dmChannel.otherUser.id)
            let key = try cryptoState.getDMKey(
                dmChannelId: dmChannel.id,
                theirPublicKeyBase64: theirPublicKey.publicKey
            )
            await MainActor.run {
                self.dmKey = key
                self.keyError = nil
            }
        } catch {
            await MainActor.run {
                self.keyError = error.localizedDescription
            }
            return
        }

        // 2. Load messages
        await chatState.selectDM(dmChannel.id)
    }

    private func sendMessage() {
        let text = messageText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let key = dmKey else { return }

        messageText = ""

        Task {
            await chatState.sendDM(text, dmChannelId: dmChannel.id, key: key)
        }
    }
}

// MARK: - DM Message Row

/// Renders a single DM message bubble with sender info and decrypted text.
private struct DMMessageRow: View {
    let message: DMMessage
    let dmKey: SymmetricKey?
    let isOwnMessage: Bool
    let otherUser: DMUser
    let currentUser: User?

    private let ownBubbleColor = Color(red: 0.2, green: 0.35, blue: 0.65)
    private let otherBubbleColor = Color(red: 0.15, green: 0.15, blue: 0.18)

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isOwnMessage {
                Spacer(minLength: 60)
            }

            if !isOwnMessage {
                AvatarView(
                    username: otherUser.username,
                    image: otherUser.image,
                    size: 32
                )
            }

            VStack(alignment: isOwnMessage ? .trailing : .leading, spacing: 4) {
                // Sender name + timestamp
                HStack(spacing: 6) {
                    if !isOwnMessage {
                        Text(otherUser.username)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(AvatarColor.color(for: otherUser.username))
                    }

                    Text(formatTimestamp(message.createdAt))
                        .font(.system(size: 11))
                        .foregroundStyle(.gray)
                }

                // Message bubble
                Text(decryptedText)
                    .font(.system(size: 15))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(isOwnMessage ? ownBubbleColor : otherBubbleColor)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }

            if !isOwnMessage {
                Spacer(minLength: 60)
            }
        }
        .padding(.vertical, 2)
    }

    private var decryptedText: String {
        MessageCrypto.decryptMessage(message.ciphertext, key: dmKey, mlsEpoch: message.mlsEpoch)
    }

    private func formatTimestamp(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        guard let date = formatter.date(from: isoString)
                ?? ISO8601DateFormatter().date(from: isoString) else {
            return ""
        }

        let displayFormatter = DateFormatter()
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            displayFormatter.dateFormat = "h:mm a"
        } else if calendar.isDateInYesterday(date) {
            displayFormatter.dateFormat = "'Yesterday' h:mm a"
        } else {
            displayFormatter.dateFormat = "MMM d, h:mm a"
        }

        return displayFormatter.string(from: date)
    }
}

#Preview {
    DMChatView(
        dmChannel: DMChannel(
            id: "dm-1",
            otherUser: DMUser(id: "u-2", username: "alice", image: nil),
            createdAt: "2025-01-01T00:00:00Z"
        )
    )
    .environment(AuthState())
    .environment(ChatState())
    .environment(CryptoState())
}
