import SwiftUI

/// Discord-style chat view with:
/// - Custom nav bar: hamburger menu (left) | # channel-name (center) | search + member list icon (right)
/// - No system NavigationStack -- fully custom layout
/// - Messages area with auto-scroll
/// - Input bar at bottom with edit mode and attachment support
/// - Long-press messages trigger a Discord-style action sheet overlay
/// - Message search with results overlay
struct ChatView: View {
    @Environment(ChatState.self) private var chatState
    @Environment(AuthState.self) private var authState

    let channel: Channel

    /// Callback to open the left drawer from parent MainView.
    var onOpenLeftDrawer: (() -> Void)?

    @State private var scrolledToBottom = true

    // Action sheet state
    @State private var actionSheetMessage: Message?
    @State private var actionSheetText: String = ""
    @State private var showActionSheet = false

    // Edit mode state
    @State private var editingMessage: Message?
    @State private var editingText: String?

    // Search state
    @State private var isSearching = false
    @State private var searchQuery = ""
    @State private var searchResults: [Message] = []
    @State private var isSearchLoading = false
    @State private var searchTask: Task<Void, Never>?
    @State private var highlightedMessageId: String?

    // MARK: - Desktop Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)   // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055) // #0e0e0e
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)  // #1a1a1a
    private let bgInput = Color(red: 0.086, green: 0.086, blue: 0.086)     // #161616
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086) // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555
    private let accentColor = Color(red: 0.345, green: 0.518, blue: 1.0)   // blue accent

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                // Custom nav bar
                customNavBar

                // Subtle border below nav bar
                Rectangle()
                    .fill(borderColor)
                    .frame(height: 1)

                // Search bar (shown when searching)
                if isSearching {
                    searchBar
                }

                // Search results or messages area
                if isSearching && !searchQuery.isEmpty {
                    searchResultsView
                } else {
                    // Messages area
                    ScrollViewReader { proxy in
                        ScrollView {
                            VStack(alignment: .leading, spacing: 0) {
                                // Load more indicator
                                if chatState.hasMoreMessages {
                                    Button {
                                        Task { await chatState.loadMoreMessages() }
                                    } label: {
                                        if chatState.isLoadingMessages {
                                            ProgressView()
                                                .tint(textMuted)
                                                .padding(.vertical, 16)
                                        } else {
                                            Text("Load earlier messages")
                                                .font(.system(size: 12))
                                                .foregroundStyle(textMuted)
                                                .padding(.vertical, 16)
                                        }
                                    }
                                    .frame(maxWidth: .infinity)
                                    .id("load-more")
                                }

                                // Channel welcome
                                if !chatState.hasMoreMessages && !chatState.messages.isEmpty {
                                    channelWelcome
                                }

                                // Messages list
                                ForEach(Array(chatState.messages.enumerated()), id: \.element.id) { index, message in
                                    MessageRow(
                                        message: message,
                                        showHeader: shouldShowHeader(at: index),
                                        onLongPress: { msg, text in
                                            actionSheetMessage = msg
                                            actionSheetText = text
                                            withAnimation(.spring(response: 0.3)) {
                                                showActionSheet = true
                                            }
                                        }
                                    )
                                    .id(message.id)
                                    .background(
                                        highlightedMessageId == message.id
                                            ? Color.white.opacity(0.08)
                                            : Color.clear
                                    )
                                }

                                // Anchor for scrolling to bottom
                                Color.clear
                                    .frame(height: 1)
                                    .id("bottom")
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .scrollDismissesKeyboard(.interactively)
                        .onChange(of: chatState.messages.count) { _, _ in
                            if scrolledToBottom {
                                withAnimation(.easeOut(duration: 0.2)) {
                                    proxy.scrollTo("bottom", anchor: .bottom)
                                }
                            }
                        }
                        .onChange(of: chatState.selectedChannelId) { _, _ in
                            proxy.scrollTo("bottom", anchor: .bottom)
                        }
                        .onChange(of: highlightedMessageId) { _, newId in
                            if let id = newId {
                                withAnimation(.easeOut(duration: 0.3)) {
                                    proxy.scrollTo(id, anchor: .center)
                                }
                                // Clear highlight after a brief delay
                                Task { @MainActor in
                                    try? await Task.sleep(for: .seconds(2))
                                    withAnimation(.easeOut(duration: 0.5)) {
                                        highlightedMessageId = nil
                                    }
                                }
                            }
                        }
                    }
                    .background(bgSecondary)
                }

                // Typing indicator
                typingIndicatorView

                // Input bar
                MessageInput(
                    channelId: channel.id,
                    channelName: channel.name,
                    onSend: { text, attachmentIds in
                        Task {
                            await chatState.sendMessage(
                                text,
                                channelId: channel.id,
                                attachmentIds: attachmentIds
                            )
                        }
                    },
                    editingMessage: editingMessage,
                    editingText: editingText,
                    onCancelEdit: {
                        cancelEdit()
                    },
                    onSubmitEdit: { newText in
                        submitEdit(newText)
                    }
                )
            }
            .background(bgSecondary)

            // Action sheet overlay
            if showActionSheet, let msg = actionSheetMessage {
                MessageActionOverlay(
                    message: msg,
                    isOwnMessage: msg.senderId == authState.user?.id,
                    messageText: actionSheetText,
                    onReaction: { emoji in
                        chatState.addReaction(messageId: msg.id, emoji: emoji)
                    },
                    onReply: {
                        // Reply functionality placeholder
                    },
                    onEdit: {
                        startEditing(msg)
                    },
                    onCopyText: {
                        // Already handled in the sheet
                    },
                    onDelete: {
                        chatState.deleteMessage(msg.id)
                    },
                    isPresented: $showActionSheet
                )
                .transition(.opacity)
            }
        }
        .task(id: channel.id) {
            await chatState.selectChannel(channel.id)
        }
    }

    // MARK: - Custom Nav Bar

    private var customNavBar: some View {
        HStack(spacing: 12) {
            // Hamburger menu button (opens left drawer)
            Button {
                onOpenLeftDrawer?()
            } label: {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(textPrimary)
                    .frame(width: 36, height: 36)
            }

            // Channel name
            HStack(spacing: 6) {
                Image(systemName: channel.type == .voice ? "speaker.wave.2" : "text.bubble")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(textSecondary)

                Text(channel.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(textPrimary)
                    .lineLimit(1)
            }

            Spacer()

            // Search button
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isSearching.toggle()
                    if !isSearching {
                        closeSearch()
                    }
                }
            } label: {
                Image(systemName: isSearching ? "magnifyingglass.circle.fill" : "magnifyingglass")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(isSearching ? accentColor : textPrimary)
                    .frame(width: 36, height: 36)
            }

        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .background(bgPrimary)
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14))
                .foregroundStyle(textMuted)

            TextField("Search messages...", text: $searchQuery)
                .textFieldStyle(.plain)
                .font(.system(size: 14))
                .foregroundStyle(textPrimary)
                .onSubmit {
                    performSearch()
                }
                .onChange(of: searchQuery) { _, newValue in
                    // Debounced search
                    searchTask?.cancel()
                    searchTask = Task {
                        try? await Task.sleep(for: .milliseconds(400))
                        guard !Task.isCancelled else { return }
                        performSearch()
                    }
                }

            if !searchQuery.isEmpty {
                Button {
                    searchQuery = ""
                    searchResults = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(textMuted)
                }
            }

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    closeSearch()
                }
            } label: {
                Text("Cancel")
                    .font(.system(size: 13))
                    .foregroundStyle(textSecondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(bgInput)
        .overlay(
            Rectangle()
                .fill(borderColor)
                .frame(height: 1),
            alignment: .bottom
        )
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    // MARK: - Search Results

    private var searchResultsView: some View {
        VStack(spacing: 0) {
            if isSearchLoading {
                Spacer()
                ProgressView()
                    .tint(textMuted)
                Spacer()
            } else if searchResults.isEmpty && !searchQuery.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 32))
                        .foregroundStyle(textMuted)
                    Text("No results found")
                        .font(.system(size: 14))
                        .foregroundStyle(textSecondary)
                    Text("Try a different search query")
                        .font(.system(size: 12))
                        .foregroundStyle(textMuted)
                }
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(searchResults) { message in
                            searchResultRow(message)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(bgSecondary)
    }

    private func searchResultRow(_ message: Message) -> some View {
        Button {
            // Close search and scroll to message
            withAnimation(.easeInOut(duration: 0.2)) {
                isSearching = false
                searchQuery = ""
                searchResults = []
            }
            // Highlight the message in the main list
            highlightedMessageId = message.id
        } label: {
            HStack(alignment: .top, spacing: 10) {
                // Avatar
                AvatarView(
                    username: chatState.username(for: message.senderId),
                    image: chatState.member(for: message.senderId)?.image,
                    size: 32
                )

                VStack(alignment: .leading, spacing: 3) {
                    // Username + timestamp
                    HStack(spacing: 6) {
                        Text(chatState.username(for: message.senderId))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(AvatarColor.color(for: chatState.username(for: message.senderId)))

                        Text(formatTimestamp(message.createdAt))
                            .font(.system(size: 10))
                            .foregroundStyle(textMuted)
                    }

                    // Message text
                    Text(message.content)
                        .font(.system(size: 13))
                        .foregroundStyle(textPrimary)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(
            Rectangle()
                .fill(borderColor)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Channel Welcome

    private var channelWelcome: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "text.bubble")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(textPrimary)
                Text(channel.name)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(textPrimary)
            }

            Text("This is the start of #\(channel.name)")
                .font(.system(size: 13))
                .foregroundStyle(textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 16)
    }

    // MARK: - Typing Indicator

    @ViewBuilder
    private var typingIndicatorView: some View {
        let typers = typingUsernames
        if !typers.isEmpty {
            HStack(spacing: 6) {
                TypingIndicator(usernames: typers)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
            .background(bgSecondary)
            .animation(.easeInOut(duration: 0.2), value: typers.count)
        }
    }

    private var typingUsernames: [String] {
        guard let typers = chatState.typingUsers[channel.id] else { return [] }
        let myId = authState.user?.id ?? ""
        return typers
            .filter { $0 != myId }
            .map { chatState.username(for: $0) }
    }

    // MARK: - Message Grouping

    private func shouldShowHeader(at index: Int) -> Bool {
        guard index > 0 else { return true }
        let current = chatState.messages[index]
        let previous = chatState.messages[index - 1]

        if current.senderId != previous.senderId { return true }

        if let currentDate = parseDate(current.createdAt),
           let previousDate = parseDate(previous.createdAt) {
            return currentDate.timeIntervalSince(previousDate) > 300
        }

        return true
    }

    private func parseDate(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }

    // MARK: - Edit Actions

    private func startEditing(_ message: Message) {
        editingMessage = message
        editingText = message.content
    }

    private func cancelEdit() {
        editingMessage = nil
        editingText = nil
    }

    private func submitEdit(_ newText: String) {
        guard let message = editingMessage else { return }
        Task {
            await chatState.editMessage(message.id, newText: newText)
        }
        cancelEdit()
    }

    // MARK: - Search Actions

    private func performSearch() {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            searchResults = []
            return
        }

        isSearchLoading = true
        Task {
            do {
                let results = try await MessageAPI.searchMessages(
                    channelId: channel.id,
                    query: query
                )
                await MainActor.run {
                    searchResults = results.items
                    isSearchLoading = false
                }
            } catch {
                print("[ChatView] Search error: \(error.localizedDescription)")
                await MainActor.run {
                    searchResults = []
                    isSearchLoading = false
                }
            }
        }
    }

    private func closeSearch() {
        isSearching = false
        searchQuery = ""
        searchResults = []
        searchTask?.cancel()
        searchTask = nil
    }

    // MARK: - Helpers

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
}
