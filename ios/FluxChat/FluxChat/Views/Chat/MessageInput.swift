import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Represents a pending attachment that has been selected but may still be uploading.
struct PendingAttachment: Identifiable {
    let id: String          // UUID for local tracking, replaced with server ID after upload
    let filename: String
    let contentType: String
    let data: Data
    let thumbnail: UIImage?
    var uploadedId: String?  // Set once FileAPI.upload completes
    var isUploading: Bool = true
    var uploadFailed: Bool = false
}

/// Text input bar at the bottom of the chat view matching the desktop Flux design:
/// - Outer bar background: #0e0e0e (bgSecondary)
/// - Inner text field: #161616 (bgInput) with rounded corners
/// - Placeholder: "Message #channel-name"
/// - Plus button on left for attachments
/// - Send button (arrow up) appears white when text is entered
/// - Typing start/stop via WS
/// - Edit mode: shows "Editing message" bar with cancel button
/// - Attachment picker: photo library and file chooser
struct MessageInput: View {
    @Environment(ChatState.self) private var chatState
    let channelId: String
    let channelName: String
    let onSend: (String, [String]) -> Void

    /// When set, the input enters edit mode pre-filled with the message text.
    var editingMessage: Message?
    var editingText: String?
    var onCancelEdit: (() -> Void)?
    var onSubmitEdit: ((String) -> Void)?

    @State private var text = ""
    @State private var isTyping = false
    @FocusState private var isFocused: Bool

    // Attachment state
    @State private var showAttachmentSheet = false
    @State private var pendingAttachments: [PendingAttachment] = []
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var showPhotoPicker = false
    @State private var showFilePicker = false

    // MARK: - Desktop Color Palette

    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)   // #0a0a0a
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055) // #0e0e0e
    private let bgInput = Color(red: 0.086, green: 0.086, blue: 0.086)     // #161616
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)  // #1a1a1a
    private let borderColor = Color(red: 0.102, green: 0.102, blue: 0.102) // #1a1a1a
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555
    private let accentColor = Color(red: 0.345, green: 0.518, blue: 1.0)   // blue accent

    var body: some View {
        VStack(spacing: 0) {
            // Subtle top border
            Rectangle()
                .fill(borderColor)
                .frame(height: 1)

            // Edit mode bar
            if editingMessage != nil {
                editBar
            }

            // Pending attachments preview
            if !pendingAttachments.isEmpty {
                pendingAttachmentsRow
            }

            // Input area
            HStack(alignment: .bottom, spacing: 10) {
                // Attachment button (hidden in edit mode)
                if editingMessage == nil {
                    Button {
                        showAttachmentSheet = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(textMuted)
                    }
                    .padding(.bottom, 4)
                }

                // Text field with rounded bg
                TextField(
                    editingMessage != nil ? "Edit message" : "Message #\(channelName)",
                    text: $text,
                    axis: .vertical
                )
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundStyle(textPrimary)
                .lineLimit(1...6)
                .focused($isFocused)
                .onChange(of: text) { _, newValue in
                    handleTypingChange(newValue)
                }
                .onSubmit {
                    send()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(bgInput)
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(borderColor, lineWidth: 1)
                )

                // Send button
                Button {
                    send()
                } label: {
                    Image(systemName: editingMessage != nil ? "checkmark.circle.fill" : "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(
                            canSend ? .white : textMuted
                        )
                }
                .disabled(!canSend)
                .padding(.bottom, 4)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(bgSecondary)
        }
        .onChange(of: editingText) { _, newValue in
            if let newValue {
                text = newValue
                isFocused = true
            }
        }
        .onChange(of: selectedPhotoItems) { _, newItems in
            Task {
                await handleSelectedPhotos(newItems)
                selectedPhotoItems = []
            }
        }
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $selectedPhotoItems,
            maxSelectionCount: 5,
            matching: .any(of: [.images, .videos])
        )
        .fileImporter(
            isPresented: $showFilePicker,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            Task {
                await handleFileImport(result)
            }
        }
        .confirmationDialog("Add Attachment", isPresented: $showAttachmentSheet) {
            Button("Photo Library") {
                showPhotoPicker = true
            }
            Button("Choose File") {
                showFilePicker = true
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: - Edit Bar

    private var editBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "pencil")
                .font(.system(size: 13))
                .foregroundStyle(accentColor)

            VStack(alignment: .leading, spacing: 1) {
                Text("Editing message")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(accentColor)

                if let original = editingText {
                    Text(original)
                        .font(.system(size: 12))
                        .foregroundStyle(textSecondary)
                        .lineLimit(1)
                }
            }

            Spacer()

            Button {
                onCancelEdit?()
                text = ""
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(textMuted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(bgSecondary)
    }

    // MARK: - Pending Attachments Row

    private var pendingAttachmentsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(pendingAttachments) { attachment in
                    pendingAttachmentCard(attachment)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
        }
        .background(bgSecondary)
    }

    private func pendingAttachmentCard(_ attachment: PendingAttachment) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topTrailing) {
                // Thumbnail or file icon
                if let thumb = attachment.thumbnail {
                    Image(uiImage: thumb)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 80, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                } else {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(bgInput)
                        .frame(width: 80, height: 60)
                        .overlay(
                            Image(systemName: "doc.fill")
                                .font(.system(size: 20))
                                .foregroundStyle(textMuted)
                        )
                }

                // Remove button
                Button {
                    removePendingAttachment(attachment.id)
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(.white)
                        .background(Circle().fill(Color.black.opacity(0.6)))
                }
                .offset(x: 4, y: -4)

                // Upload indicator
                if attachment.isUploading {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.7)
                        .frame(width: 80, height: 60)
                        .background(Color.black.opacity(0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }

                if attachment.uploadFailed {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(.red)
                        .frame(width: 80, height: 60)
                        .background(Color.black.opacity(0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }

            Text(attachment.filename)
                .font(.system(size: 10))
                .foregroundStyle(textSecondary)
                .lineLimit(1)
                .frame(width: 80, alignment: .leading)
        }
    }

    // MARK: - Computed Properties

    private var canSend: Bool {
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasAttachments = !pendingAttachments.isEmpty && pendingAttachments.allSatisfy { !$0.isUploading && !$0.uploadFailed }
        return hasText || hasAttachments
    }

    // MARK: - Actions

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)

        if editingMessage != nil {
            // Edit mode: submit the edit
            guard !trimmed.isEmpty else { return }
            onSubmitEdit?(trimmed)
            text = ""
            stopTypingIfNeeded()
            return
        }

        // Normal send mode
        let uploadedIds = pendingAttachments.compactMap(\.uploadedId)
        guard !trimmed.isEmpty || !uploadedIds.isEmpty else { return }
        onSend(trimmed, uploadedIds)
        text = ""
        pendingAttachments = []
        stopTypingIfNeeded()
    }

    private func handleTypingChange(_ newValue: String) {
        let hasContent = !newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if hasContent && !isTyping {
            isTyping = true
            chatState.startTyping(channelId: channelId)
        } else if !hasContent && isTyping {
            stopTypingIfNeeded()
        }
    }

    private func stopTypingIfNeeded() {
        if isTyping {
            isTyping = false
            chatState.stopTyping(channelId: channelId)
        }
    }

    // MARK: - Attachment Handling

    private func handleSelectedPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            let localId = UUID().uuidString
            let filename = "photo_\(Date().timeIntervalSince1970).jpg"

            // Load transferable data
            if let data = try? await item.loadTransferable(type: Data.self) {
                let thumbnail = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 160, height: 120))
                let contentType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"

                let pending = PendingAttachment(
                    id: localId,
                    filename: filename,
                    contentType: contentType,
                    data: data,
                    thumbnail: thumbnail,
                    isUploading: true
                )

                await MainActor.run {
                    pendingAttachments.append(pending)
                }

                // Upload
                do {
                    let response = try await FileAPI.upload(
                        data: data,
                        filename: filename,
                        contentType: contentType
                    )
                    await MainActor.run {
                        if let idx = pendingAttachments.firstIndex(where: { $0.id == localId }) {
                            pendingAttachments[idx].uploadedId = response.id
                            pendingAttachments[idx].isUploading = false
                        }
                    }
                } catch {
                    print("[MessageInput] Upload failed: \(error.localizedDescription)")
                    await MainActor.run {
                        if let idx = pendingAttachments.firstIndex(where: { $0.id == localId }) {
                            pendingAttachments[idx].isUploading = false
                            pendingAttachments[idx].uploadFailed = true
                        }
                    }
                }
            }
        }
    }

    private func handleFileImport(_ result: Result<[URL], Error>) async {
        guard let urls = try? result.get() else { return }

        for url in urls {
            guard url.startAccessingSecurityScopedResource() else { continue }
            defer { url.stopAccessingSecurityScopedResource() }

            let localId = UUID().uuidString
            let filename = url.lastPathComponent

            guard let data = try? Data(contentsOf: url) else { continue }

            let contentType = mimeType(for: url.pathExtension)
            let thumbnail: UIImage? = contentType.hasPrefix("image/")
                ? UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 160, height: 120))
                : nil

            await MainActor.run {
                pendingAttachments.append(PendingAttachment(
                    id: localId,
                    filename: filename,
                    contentType: contentType,
                    data: data,
                    thumbnail: thumbnail,
                    isUploading: true
                ))
            }

            // Upload
            do {
                let response = try await FileAPI.upload(
                    data: data,
                    filename: filename,
                    contentType: contentType
                )
                await MainActor.run {
                    if let idx = pendingAttachments.firstIndex(where: { $0.id == localId }) {
                        pendingAttachments[idx].uploadedId = response.id
                        pendingAttachments[idx].isUploading = false
                    }
                }
            } catch {
                print("[MessageInput] Upload failed: \(error.localizedDescription)")
                await MainActor.run {
                    if let idx = pendingAttachments.firstIndex(where: { $0.id == localId }) {
                        pendingAttachments[idx].isUploading = false
                        pendingAttachments[idx].uploadFailed = true
                    }
                }
            }
        }
    }

    private func removePendingAttachment(_ id: String) {
        pendingAttachments.removeAll { $0.id == id }
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "mp4": return "video/mp4"
        case "mov": return "video/quicktime"
        case "pdf": return "application/pdf"
        case "zip": return "application/zip"
        case "txt": return "text/plain"
        default: return "application/octet-stream"
        }
    }
}
