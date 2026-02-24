import PhotosUI
import SwiftUI

/// The root view after authentication. Implements Discord mobile-style navigation:
/// - Center: Chat view (main content)
/// - Swipe right: Reveals channel sidebar (left drawer) as an overlay
/// - Swipe left: Reveals member list (right drawer) as an overlay
/// - No TabView. No system NavigationStack for the main layout.
/// - Bottom has NO tab bar -- just the chat input
/// - DMs accessed from the channel sidebar toggle
struct MainView: View {
    @Environment(AuthState.self) private var authState
    @Environment(ChatState.self) private var chatState
    @Environment(CryptoState.self) private var cryptoState
    @Environment(VoiceState.self) private var voiceState

    @State private var ws = FluxWebSocket()
    @State private var router = EventRouter()

    // MARK: - Drawer State

    @State private var leftDrawerOpen = false
    @State private var dragOffset: CGFloat = 0
    @State private var isDragging = false

    // MARK: - Navigation State

    @State private var showSettings = false
    @State private var showDMChat: DMChannel?

    // MARK: - Profile Editing State

    @State private var isEditingUsername = false
    @State private var editedUsername = ""
    @State private var isSavingProfile = false
    @State private var profileError: String?
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isUploadingAvatar = false

    // MARK: - Drawer Constants

    private let channelDrawerWidth: CGFloat = 280
    private let dragThreshold: CGFloat = 80

    // MARK: - Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)   // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055) // #0e0e0e
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)  // #1a1a1a
    private let bgInput = Color(red: 0.086, green: 0.086, blue: 0.086)     // #161616
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086) // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555
    private let danger = Color(red: 1.0, green: 0.267, blue: 0.267)        // #ff4444

    // MARK: - Computed Offsets

    private var effectiveOffset: CGFloat {
        if isDragging { return max(dragOffset, 0) }
        if leftDrawerOpen { return channelDrawerWidth }
        return 0
    }

    private var channelDrawerOffset: CGFloat {
        let base: CGFloat = -channelDrawerWidth
        if isDragging && dragOffset > 0 { return base + dragOffset }
        if leftDrawerOpen { return 0 }
        return base
    }

    private var overlayOpacity: Double {
        if isDragging && dragOffset > 0 {
            return Double(min(dragOffset / channelDrawerWidth, 1.0)) * 0.5
        }
        if leftDrawerOpen { return 0.5 }
        return 0.0
    }

    // MARK: - Body

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                bgPrimary.ignoresSafeArea()

                // Channel drawer (slides from left)
                ChannelDrawerView(
                    onSelectChannel: { channel in
                        Task { await chatState.selectChannel(channel.id) }
                        closeDrawers()
                    },
                    onSelectDM: { dm in
                        showDMChat = dm
                        closeDrawers()
                    },
                    onOpenSettings: {
                        closeDrawers()
                        showSettings = true
                    }
                )
                .frame(width: channelDrawerWidth)
                .offset(x: channelDrawerOffset)
                .ignoresSafeArea(.keyboard)
                .zIndex(2)

                // Main content (chat)
                mainContent
                    .frame(width: geo.size.width)
                    .offset(x: effectiveOffset)
                    .zIndex(0)

                // Dim overlay
                Color.black.opacity(overlayOpacity)
                    .ignoresSafeArea()
                    .ignoresSafeArea(.keyboard)
                    .offset(x: effectiveOffset)
                    .allowsHitTesting(overlayOpacity > 0.05)
                    .onTapGesture { closeDrawers() }
                    .zIndex(1)
            }
            .gesture(swipeGesture)
            .animation(.spring(response: 0.3, dampingFraction: 0.85), value: leftDrawerOpen)
            .animation(.spring(response: 0.3, dampingFraction: 0.85), value: isDragging)
        }
        .preferredColorScheme(.dark)
        .onAppear {
            configureNavBarAppearance()
        }
        .task { await setup() }
        .onDisappear { disconnect() }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                settingsView
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .principal) {
                            Text("Settings")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(textPrimary)
                        }
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") {
                                showSettings = false
                            }
                            .foregroundStyle(.white)
                        }
                    }
                    .toolbarBackground(bgPrimary, for: .navigationBar)
                    .toolbarBackground(.visible, for: .navigationBar)
            }
            .presentationBackground(bgPrimary)
        }
        .fullScreenCover(item: $showDMChat) { dm in
            NavigationStack {
                DMChatView(dmChannel: dm)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button {
                                showDMChat = nil
                            } label: {
                                Image(systemName: "chevron.left")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundStyle(.white)
                            }
                        }
                    }
            }
            .preferredColorScheme(.dark)
        }
    }

    // MARK: - Main Content

    @ViewBuilder
    private var mainContent: some View {
        ZStack(alignment: .bottom) {
            if let channelId = chatState.selectedChannelId,
               let serverId = chatState.selectedServerId,
               let channels = chatState.channelsByServer[serverId],
               let channel = channels.first(where: { $0.id == channelId }) {
                if channel.type == .voice {
                    // Voice channel: show VoiceView inline (not as a modal)
                    VStack(spacing: 0) {
                        voiceNavBar(channel: channel)
                        Rectangle()
                            .fill(borderColor)
                            .frame(height: 1)
                        VoiceView(channel: channel)
                    }
                    .background(bgSecondary)
                } else {
                    ChatView(
                        channel: channel,
                        onOpenLeftDrawer: { openLeftDrawer() }
                    )
                }
            } else {
                // Empty state / loading
                emptyStateView
            }

            // Voice bar overlay at bottom (above input) when viewing a non-voice channel
            if voiceState.isConnected,
               !(selectedChannelIsVoice) {
                VStack {
                    Spacer()
                    VoiceBar {
                        // Tap the voice bar -> navigate to that voice channel inline
                        if let channelId = voiceState.currentChannelId {
                            Task { await chatState.selectChannel(channelId) }
                        }
                    }
                    .padding(.bottom, 60) // above the message input area
                }
            }
        }
    }

    /// Whether the currently selected channel is a voice channel.
    private var selectedChannelIsVoice: Bool {
        guard let channelId = chatState.selectedChannelId,
              let serverId = chatState.selectedServerId,
              let channels = chatState.channelsByServer[serverId],
              let channel = channels.first(where: { $0.id == channelId }) else {
            return false
        }
        return channel.type == .voice
    }

    /// Custom nav bar for voice channels shown inline.
    private func voiceNavBar(channel: Channel) -> some View {
        HStack(spacing: 12) {
            Button {
                openLeftDrawer()
            } label: {
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(textPrimary)
                    .frame(width: 36, height: 36)
            }

            HStack(spacing: 6) {
                Image(systemName: "speaker.wave.2")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(textSecondary)

                Text(channel.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(textPrimary)
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .background(bgPrimary)
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 0) {
            // Custom nav bar for empty state
            HStack(spacing: 12) {
                Button {
                    openLeftDrawer()
                } label: {
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(textPrimary)
                        .frame(width: 36, height: 36)
                }

                Spacer()

                FluxLogoView(size: 28)
                    .foregroundStyle(.white)

                Spacer()

                // Invisible spacer for symmetry
                Color.clear.frame(width: 36, height: 36)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .background(bgPrimary)

            Rectangle()
                .fill(borderColor)
                .frame(height: 1)

            // Content
            if chatState.servers.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
                    ProgressView()
                        .tint(textSecondary)
                    Text("Loading...")
                        .font(.system(size: 14))
                        .foregroundStyle(textSecondary)
                    Spacer()
                }
            } else {
                VStack(spacing: 16) {
                    Spacer()
                    FluxLogoView(size: 56)
                        .foregroundStyle(textMuted.opacity(0.5))
                    Text("Select a channel")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(textSecondary)
                    Text("Swipe right or tap the menu to browse channels")
                        .font(.system(size: 13))
                        .foregroundStyle(textMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                    Spacer()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(bgSecondary)
    }

    // MARK: - Swipe Gesture

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 20, coordinateSpace: .global)
            .onChanged { value in
                let x = value.translation.width

                if !isDragging {
                    let isHorizontal = abs(value.translation.width) > abs(value.translation.height) * 1.2
                    guard isHorizontal else { return }
                    isDragging = true
                }

                if leftDrawerOpen {
                    if x < 0 {
                        dragOffset = channelDrawerWidth + x
                    } else {
                        dragOffset = channelDrawerWidth
                    }
                } else {
                    if x > 0 {
                        dragOffset = min(x, channelDrawerWidth)
                    }
                }
            }
            .onEnded { value in
                let x = value.translation.width
                let velocity = value.predictedEndTranslation.width - value.translation.width

                if leftDrawerOpen {
                    if x < -dragThreshold || velocity < -200 {
                        closeDrawerImmediate()
                    } else {
                        leftDrawerOpen = true
                    }
                } else {
                    if x > dragThreshold || velocity > 300 {
                        leftDrawerOpen = true
                    }
                }

                isDragging = false
                dragOffset = 0
            }
    }

    // MARK: - Drawer Control

    private func openLeftDrawer() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
            leftDrawerOpen = true
        }
    }


    private func closeDrawers() {
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
            leftDrawerOpen = false
        }
    }

    private func closeDrawerImmediate() {
        leftDrawerOpen = false
    }

    // MARK: - Settings View

    private var settingsView: some View {
        ScrollView {
            VStack(spacing: 16) {
                Spacer().frame(height: 8)

                // User Card with editable avatar and username
                if let user = authState.user {
                    VStack(spacing: 16) {
                        // Avatar with photo picker
                        PhotosPicker(
                            selection: $selectedPhotoItem,
                            matching: .images,
                            photoLibrary: .shared()
                        ) {
                            ZStack(alignment: .bottomTrailing) {
                                if isUploadingAvatar {
                                    Circle()
                                        .fill(bgTertiary)
                                        .frame(width: 72, height: 72)
                                        .overlay(ProgressView().tint(textSecondary))
                                } else {
                                    AvatarView(username: user.username, image: user.image, size: 72)
                                }

                                // Camera badge
                                Image(systemName: "camera.fill")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 24, height: 24)
                                    .background(Circle().fill(bgTertiary))
                                    .overlay(
                                        Circle().stroke(bgPrimary, lineWidth: 2)
                                    )
                            }
                        }
                        .buttonStyle(.plain)
                        .onChange(of: selectedPhotoItem) { _, newItem in
                            guard let item = newItem else { return }
                            Task { await uploadAvatar(item: item) }
                        }

                        // Username (tap to edit)
                        if isEditingUsername {
                            HStack(spacing: 10) {
                                TextField("Username", text: $editedUsername)
                                    .textFieldStyle(.plain)
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(textPrimary)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(
                                        RoundedRectangle(cornerRadius: 8)
                                            .fill(bgInput)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .stroke(borderColor, lineWidth: 1)
                                    )
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                    .onSubmit { Task { await saveUsername() } }

                                // Save button
                                Button {
                                    Task { await saveUsername() }
                                } label: {
                                    if isSavingProfile {
                                        ProgressView()
                                            .tint(textPrimary)
                                            .frame(width: 32, height: 32)
                                    } else {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.system(size: 22))
                                            .foregroundStyle(.green)
                                    }
                                }
                                .disabled(isSavingProfile || editedUsername.trimmingCharacters(in: .whitespaces).isEmpty)

                                // Cancel button
                                Button {
                                    isEditingUsername = false
                                    editedUsername = ""
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 22))
                                        .foregroundStyle(textMuted)
                                }
                            }
                        } else {
                            Button {
                                editedUsername = user.username
                                isEditingUsername = true
                            } label: {
                                HStack(spacing: 6) {
                                    Text(user.username)
                                        .font(.system(size: 17, weight: .semibold))
                                        .foregroundStyle(textPrimary)

                                    Image(systemName: "pencil")
                                        .font(.system(size: 12))
                                        .foregroundStyle(textMuted)
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        // Email (non-editable)
                        Text(user.email)
                            .font(.system(size: 13))
                            .foregroundStyle(textSecondary)

                        // Error message
                        if let profileError {
                            Text(profileError)
                                .font(.system(size: 12))
                                .foregroundStyle(danger)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(bgSecondary)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(borderColor, lineWidth: 1)
                    )
                    .padding(.horizontal, 16)
                }

                // App Info Section
                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        FluxLogoView(size: 20)
                            .foregroundStyle(textSecondary)
                        Text("iOS")
                            .font(.system(size: 14))
                            .foregroundStyle(textSecondary)
                        Spacer()
                        Text("1.0")
                            .font(.system(size: 13))
                            .foregroundStyle(textMuted)
                    }
                    .padding(16)
                }
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(bgSecondary)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(borderColor, lineWidth: 1)
                )
                .padding(.horizontal, 16)

                // Sign Out Button
                Button {
                    disconnect()
                    showSettings = false
                    Task { await authState.signOut() }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 14))
                        Text("Sign Out")
                            .font(.system(size: 15, weight: .medium))
                    }
                    .foregroundStyle(danger)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(bgTertiary)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(borderColor, lineWidth: 1)
                    )
                }
                .padding(.horizontal, 16)

                Spacer()
            }
        }
        .background(bgPrimary)
    }

    // MARK: - Profile Actions

    private func saveUsername() async {
        let trimmed = editedUsername.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        isSavingProfile = true
        profileError = nil

        do {
            let updated = try await UserAPI.updateProfile(username: trimmed)
            await MainActor.run {
                authState.user = updated
                isEditingUsername = false
                editedUsername = ""
                isSavingProfile = false
            }
        } catch {
            await MainActor.run {
                profileError = error.localizedDescription
                isSavingProfile = false
            }
        }
    }

    private func uploadAvatar(item: PhotosPickerItem) async {
        isUploadingAvatar = true
        profileError = nil

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                await MainActor.run {
                    profileError = "Could not load image"
                    isUploadingAvatar = false
                    selectedPhotoItem = nil
                }
                return
            }

            let base64 = data.base64EncodedString()
            let dataURL = "data:image/jpeg;base64,\(base64)"

            let updated = try await UserAPI.updateProfile(image: dataURL)
            await MainActor.run {
                authState.user = updated
                isUploadingAvatar = false
                selectedPhotoItem = nil
            }
        } catch {
            await MainActor.run {
                profileError = error.localizedDescription
                isUploadingAvatar = false
                selectedPhotoItem = nil
            }
        }
    }

    // MARK: - Nav Bar Appearance

    private func configureNavBarAppearance() {
        let navAppearance = UINavigationBarAppearance()
        navAppearance.configureWithOpaqueBackground()
        navAppearance.backgroundColor = UIColor(red: 0.039, green: 0.039, blue: 0.039, alpha: 1)
        navAppearance.shadowColor = UIColor(red: 0.086, green: 0.086, blue: 0.086, alpha: 1)
        navAppearance.titleTextAttributes = [
            .foregroundColor: UIColor(red: 0.91, green: 0.91, blue: 0.91, alpha: 1)
        ]
        UINavigationBar.appearance().standardAppearance = navAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = navAppearance
        UINavigationBar.appearance().compactAppearance = navAppearance
    }

    // MARK: - Setup & Teardown

    private func setup() async {
        guard let token = KeychainHelper.get(Config.sessionTokenKey) else { return }

        chatState.ws = ws
        cryptoState.ws = ws
        voiceState.ws = ws

        ws.connect(token: token)
        router.start(ws: ws, chatState: chatState, cryptoState: cryptoState, voiceState: voiceState)

        await cryptoState.initialize()
        await chatState.loadServers()

        // Auto-select first server
        if chatState.selectedServerId == nil, let first = chatState.servers.first {
            await chatState.selectServer(first.id)
        }
    }

    private func disconnect() {
        router.stop()
        ws.disconnect()
    }
}

// MARK: - Hashable Conformance for fullScreenCover(item:)

extension Channel: Hashable {
    static func == (lhs: Channel, rhs: Channel) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

extension DMChannel: Hashable {
    static func == (lhs: DMChannel, rhs: DMChannel) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}
