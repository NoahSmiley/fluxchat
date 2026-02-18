import SwiftUI

/// Generates a deterministic color from a username string.
/// Port of the web client's `avatarColor` function that hashes
/// the username and maps it to a predefined palette.
enum AvatarColor {
    private static let colors: [Color] = [
        Color(hex: 0xE06C75), // soft red
        Color(hex: 0xE5C07B), // warm yellow
        Color(hex: 0x98C379), // green
        Color(hex: 0x56B6C2), // cyan
        Color(hex: 0x61AFEF), // blue
        Color(hex: 0xC678DD), // purple
        Color(hex: 0xD19A66), // orange
        Color(hex: 0xBE5046), // rust
        Color(hex: 0x7EC8E3), // sky blue
        Color(hex: 0xC3E88D), // lime
    ]

    /// Returns a consistent color for the given name.
    /// Uses the same hash algorithm as the web client:
    /// `hash = charCode + ((hash << 5) - hash)` per character.
    static func color(for name: String?) -> Color {
        guard let name, !name.isEmpty else {
            return colors[0]
        }

        var hash: Int = 0
        for scalar in name.unicodeScalars {
            let code = Int(scalar.value)
            hash = code &+ ((hash &<< 5) &- hash)
        }

        let index = abs(hash) % colors.count
        return colors[index]
    }
}

// MARK: - Color hex initializer

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}
