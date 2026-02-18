import SwiftUI

/// Displays "User is typing..." or "User1, User2 are typing..." above the
/// message input when other users are typing in the current channel.
struct TypingIndicator: View {
    let usernames: [String]

    var body: some View {
        if !usernames.isEmpty {
            HStack(spacing: 6) {
                // Animated dots
                TypingDots()

                Text(typingText)
                    .font(.caption)
                    .foregroundStyle(.gray)

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
    }

    private var typingText: String {
        switch usernames.count {
        case 1:
            return "\(usernames[0]) is typing..."
        case 2:
            return "\(usernames[0]) and \(usernames[1]) are typing..."
        case 3:
            return "\(usernames[0]), \(usernames[1]), and \(usernames[2]) are typing..."
        default:
            return "Several people are typing..."
        }
    }
}

// MARK: - Animated Dots

private struct TypingDots: View {
    @State private var phase = 0.0

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(Color.gray)
                    .frame(width: 5, height: 5)
                    .offset(y: dotOffset(for: index))
            }
        }
        .onAppear {
            withAnimation(
                .easeInOut(duration: 0.6)
                .repeatForever(autoreverses: true)
            ) {
                phase = 1.0
            }
        }
    }

    private func dotOffset(for index: Int) -> CGFloat {
        let delay = Double(index) * 0.15
        let progress = max(0, min(1, phase - delay))
        return -3 * sin(progress * .pi)
    }
}

#Preview {
    VStack(spacing: 20) {
        TypingIndicator(usernames: ["Alice"])
        TypingIndicator(usernames: ["Alice", "Bob"])
        TypingIndicator(usernames: ["Alice", "Bob", "Charlie"])
    }
    .padding()
    .background(Color(red: 0.11, green: 0.11, blue: 0.14))
}
