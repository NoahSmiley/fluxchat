import NukeUI
import SwiftUI

/// Displays a message attachment. Images are shown inline with a tap-to-zoom
/// gesture. Other file types are displayed as a tappable download row with
/// file icon, name, and human-readable size.
struct AttachmentView: View {
    let attachment: Attachment

    @State private var showFullScreen = false

    // MARK: - Colors

    private let cardColor = Color(red: 0.13, green: 0.13, blue: 0.16)
    private let accentColor = Color(red: 0.35, green: 0.55, blue: 1.0)

    // MARK: - Computed

    private var isImage: Bool {
        attachment.contentType.hasPrefix("image/")
    }

    private var fileURL: URL? {
        URL(string: attachment.fileURL)
    }

    // MARK: - Body

    var body: some View {
        if isImage {
            imageAttachment
        } else {
            fileAttachment
        }
    }

    // MARK: - Image Attachment

    private var imageAttachment: some View {
        Group {
            if let url = fileURL {
                LazyImage(url: url) { state in
                    if let image = state.image {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 300, maxHeight: 300)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .onTapGesture {
                                showFullScreen = true
                            }
                    } else if state.error != nil {
                        failedImagePlaceholder
                    } else {
                        // Loading
                        RoundedRectangle(cornerRadius: 8)
                            .fill(cardColor)
                            .frame(width: 200, height: 150)
                            .overlay(
                                ProgressView()
                                    .tint(.gray)
                            )
                    }
                }
            } else {
                failedImagePlaceholder
            }
        }
        .fullScreenCover(isPresented: $showFullScreen) {
            FullScreenImageView(
                url: fileURL,
                filename: attachment.filename,
                isPresented: $showFullScreen
            )
        }
    }

    // MARK: - File Attachment

    private var fileAttachment: some View {
        Button {
            if let url = fileURL {
                UIApplication.shared.open(url)
            }
        } label: {
            HStack(spacing: 12) {
                // File type icon
                fileIcon
                    .font(.system(size: 28))
                    .foregroundStyle(accentColor)
                    .frame(width: 40, height: 40)

                VStack(alignment: .leading, spacing: 2) {
                    // Filename
                    Text(attachment.filename)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    // File size
                    Text(formatFileSize(attachment.size))
                        .font(.system(size: 12))
                        .foregroundStyle(.gray)
                }

                Spacer()

                // Download icon
                Image(systemName: "arrow.down.circle")
                    .font(.system(size: 20))
                    .foregroundStyle(accentColor)
            }
            .padding(12)
            .background(cardColor)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .frame(maxWidth: 300)
    }

    // MARK: - Failed Image Placeholder

    private var failedImagePlaceholder: some View {
        VStack(spacing: 6) {
            Image(systemName: "photo")
                .font(.system(size: 24))
                .foregroundStyle(.gray)

            Text("Failed to load image")
                .font(.system(size: 12))
                .foregroundStyle(.gray)
        }
        .frame(width: 200, height: 100)
        .background(cardColor)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - File Icon

    private var fileIcon: Image {
        let ct = attachment.contentType.lowercased()

        if ct.hasPrefix("video/") {
            return Image(systemName: "film")
        } else if ct.hasPrefix("audio/") {
            return Image(systemName: "waveform")
        } else if ct.contains("pdf") {
            return Image(systemName: "doc.text")
        } else if ct.contains("zip") || ct.contains("tar") || ct.contains("gzip") || ct.contains("rar") {
            return Image(systemName: "doc.zipper")
        } else if ct.contains("text") {
            return Image(systemName: "doc.plaintext")
        } else if ct.contains("json") || ct.contains("xml") || ct.contains("html") {
            return Image(systemName: "chevron.left.forwardslash.chevron.right")
        } else {
            return Image(systemName: "doc")
        }
    }

    // MARK: - Helpers

    private func formatFileSize(_ bytes: Int) -> String {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useBytes, .useKB, .useMB, .useGB]
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(bytes))
    }
}

// MARK: - Full Screen Image View

/// A full-screen overlay for viewing images at full resolution with
/// pinch-to-zoom and drag-to-dismiss.
private struct FullScreenImageView: View {
    let url: URL?
    let filename: String
    @Binding var isPresented: Bool

    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero

    private let bgColor = Color.black

    var body: some View {
        ZStack {
            bgColor.ignoresSafeArea()

            // Image
            if let url {
                LazyImage(url: url) { state in
                    if let image = state.image {
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .scaleEffect(scale)
                            .offset(offset)
                            .gesture(
                                MagnifyGesture()
                                    .onChanged { value in
                                        scale = lastScale * value.magnification
                                    }
                                    .onEnded { _ in
                                        lastScale = scale
                                        if scale < 1.0 {
                                            withAnimation {
                                                scale = 1.0
                                                lastScale = 1.0
                                            }
                                        }
                                    }
                            )
                            .gesture(
                                DragGesture()
                                    .onChanged { value in
                                        offset = value.translation
                                    }
                                    .onEnded { value in
                                        if abs(value.translation.height) > 100 && scale <= 1.0 {
                                            isPresented = false
                                        } else {
                                            withAnimation {
                                                offset = .zero
                                            }
                                        }
                                    }
                            )
                    } else {
                        ProgressView()
                            .tint(.white)
                    }
                }
            }

            // Top bar with close and filename
            VStack {
                HStack {
                    Button {
                        isPresented = false
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.white.opacity(0.15))
                            .clipShape(Circle())
                    }

                    Spacer()

                    Text(filename)
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)

                    Spacer()

                    // Share button
                    if let url {
                        ShareLink(item: url) {
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 36, height: 36)
                                .background(Color.white.opacity(0.15))
                                .clipShape(Circle())
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
    }
}

// MARK: - Convenience: Render a list of attachments

/// Renders a vertical stack of attachment views for a message.
struct AttachmentListView: View {
    let attachments: [Attachment]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(attachments) { attachment in
                AttachmentView(attachment: attachment)
            }
        }
    }
}

#Preview {
    VStack(spacing: 16) {
        AttachmentView(
            attachment: Attachment(
                id: "att-1",
                messageId: "msg-1",
                uploaderId: "u-1",
                filename: "screenshot.png",
                contentType: "image/png",
                size: 245_000,
                createdAt: "2025-01-01T00:00:00Z"
            )
        )

        AttachmentView(
            attachment: Attachment(
                id: "att-2",
                messageId: "msg-1",
                uploaderId: "u-1",
                filename: "document.pdf",
                contentType: "application/pdf",
                size: 1_234_567,
                createdAt: "2025-01-01T00:00:00Z"
            )
        )
    }
    .padding()
    .background(Color(red: 0.07, green: 0.07, blue: 0.09))
}
