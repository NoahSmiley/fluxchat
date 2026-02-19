import SwiftUI

/// Reusable avatar component matching the desktop Flux design.
/// Displays a deterministic-color circle with the first letter of the username,
/// optionally overlaid with the user's profile image loaded from the API.
/// Default size is 36pt to match desktop message layout.
struct AvatarView: View {
    let username: String
    let image: String?
    var size: CGFloat = 36

    var body: some View {
        ZStack {
            // Background circle with deterministic color
            Circle()
                .fill(AvatarColor.color(for: username))

            // First letter
            Text(initial)
                .font(.system(size: size * 0.42, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)

            // Profile image overlay
            if let image, !image.isEmpty {
                AsyncImage(url: avatarURL(image)) { phase in
                    switch phase {
                    case .success(let img):
                        img
                            .resizable()
                            .scaledToFill()
                    default:
                        EmptyView()
                    }
                }
                .clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    // MARK: - Helpers

    private var initial: String {
        let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return "?" }
        return String(first).uppercased()
    }

    private func avatarURL(_ path: String) -> URL? {
        if path.hasPrefix("http") {
            return URL(string: path)
        }
        return URL(string: "\(Config.apiBase)/\(path)")
    }
}
