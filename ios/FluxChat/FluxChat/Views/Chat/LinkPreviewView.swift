import SwiftUI

/// Displays a rich link preview card for the first URL found in a message.
/// Fetches preview data from the server's `/link-preview` endpoint and caches
/// results in a shared actor-isolated dictionary to avoid redundant network calls.
///
/// Styled as a dark card matching the Flux aesthetic:
/// - Background: #1a1a1a (bgTertiary)
/// - Border: #161616 (borderColor)
/// - Rounded corners, optional image, domain label, title, description
struct LinkPreviewView: View {
    let messageText: String

    @State private var preview: LinkPreview?
    @State private var isLoading = false
    @State private var hasFailed = false

    // MARK: - Color Palette

    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)  // #1a1a1a
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086) // #161616
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)    // #e8e8e8
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533) // #888888
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)   // #555555
    private let accentColor = Color(red: 0.345, green: 0.518, blue: 1.0)   // blue accent

    var body: some View {
        Group {
            if let preview {
                linkCard(preview)
            } else if isLoading {
                loadingPlaceholder
            }
            // If hasFailed or no URL found, show nothing
        }
        .task(id: messageText) {
            await loadPreview()
        }
    }

    // MARK: - Link Card

    private func linkCard(_ preview: LinkPreview) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Optional preview image
            if let imageURL = preview.image, let url = URL(string: imageURL) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity)
                            .frame(height: 140)
                            .clipped()
                    case .failure:
                        EmptyView()
                    default:
                        Rectangle()
                            .fill(Color.white.opacity(0.03))
                            .frame(height: 140)
                            .overlay(
                                ProgressView()
                                    .tint(textMuted)
                            )
                    }
                }
            }

            // Text content
            VStack(alignment: .leading, spacing: 4) {
                // Domain
                if let domain = preview.domain {
                    Text(domain.uppercased())
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(textMuted)
                        .tracking(0.5)
                }

                // Title
                if let title = preview.title, !title.isEmpty {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(accentColor)
                        .lineLimit(2)
                }

                // Description
                if let description = preview.description, !description.isEmpty {
                    Text(description)
                        .font(.system(size: 12))
                        .foregroundStyle(textSecondary)
                        .lineLimit(3)
                }
            }
            .padding(10)
        }
        .frame(maxWidth: 340, alignment: .leading)
        .background(bgTertiary)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(borderColor, lineWidth: 1)
        )
        .padding(.top, 6)
    }

    // MARK: - Loading Placeholder

    private var loadingPlaceholder: some View {
        HStack(spacing: 8) {
            ProgressView()
                .tint(textMuted)
                .scaleEffect(0.7)
            Text("Loading preview...")
                .font(.system(size: 11))
                .foregroundStyle(textMuted)
        }
        .padding(8)
        .padding(.top, 4)
    }

    // MARK: - Data Loading

    private func loadPreview() async {
        guard let url = extractFirstURL(from: messageText) else { return }

        // Check cache first
        if let cached = LinkPreviewCache.shared.get(url: url) {
            self.preview = cached
            return
        }

        isLoading = true
        hasFailed = false

        do {
            let result = try await MessageAPI.getLinkPreview(url: url)
            LinkPreviewCache.shared.set(url: url, preview: result)
            await MainActor.run {
                self.preview = result
                self.isLoading = false
            }
        } catch {
            print("[LinkPreviewView] Failed to load preview for \(url): \(error.localizedDescription)")
            await MainActor.run {
                self.isLoading = false
                self.hasFailed = true
            }
        }
    }

    // MARK: - URL Extraction

    /// Extracts the first URL found in the message text using NSDataDetector.
    private func extractFirstURL(from text: String) -> String? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return nil
        }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        let matches = detector.matches(in: text, options: [], range: range)
        return matches.first?.url?.absoluteString
    }
}

// MARK: - Link Preview Cache

/// A simple in-memory cache for link preview results, keyed by URL string.
/// Thread-safe via actor isolation.
final class LinkPreviewCache: @unchecked Sendable {
    static let shared = LinkPreviewCache()

    private var cache: [String: LinkPreview] = [:]
    private let lock = NSLock()

    private init() {}

    func get(url: String) -> LinkPreview? {
        lock.lock()
        defer { lock.unlock() }
        return cache[url]
    }

    func set(url: String, preview: LinkPreview) {
        lock.lock()
        defer { lock.unlock() }
        cache[url] = preview
    }
}
