import SwiftUI

/// A compact floating bar that appears when the user is connected to a voice
/// channel but is viewing other content. Shows the channel name and provides
/// quick access to mute, deafen, and disconnect controls.
///
/// Tap the bar to navigate to the voice channel. Place this at the bottom of
/// your main navigation container using an overlay or ZStack.
struct VoiceBar: View {
    @Environment(VoiceState.self) private var voiceState

    /// Called when the user taps the bar body (not a control button)
    /// to navigate to the voice channel.
    var onTap: (() -> Void)?

    // MARK: - Colors

    private let barColor = Color(red: 0.12, green: 0.16, blue: 0.12)
    private let greenColor = Color(red: 0.3, green: 0.75, blue: 0.4)
    private let redColor = Color(red: 0.85, green: 0.3, blue: 0.3)
    private let mutedColor = Color(red: 0.85, green: 0.3, blue: 0.3)

    // MARK: - Body

    var body: some View {
        if voiceState.isConnected {
            HStack(spacing: 12) {
                // Connection indicator + channel name
                Button {
                    onTap?()
                } label: {
                    HStack(spacing: 8) {
                        // Pulsing green dot
                        Circle()
                            .fill(greenColor)
                            .frame(width: 8, height: 8)
                            .shadow(color: greenColor.opacity(0.6), radius: 4)

                        VStack(alignment: .leading, spacing: 1) {
                            Text("Voice Connected")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(greenColor)

                            if let name = voiceState.currentChannelName {
                                Text(name)
                                    .font(.system(size: 11))
                                    .foregroundStyle(.gray)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)

                Spacer()

                // Mute button
                Button {
                    voiceState.toggleMute()
                } label: {
                    Image(systemName: voiceState.isMuted ? "mic.slash.fill" : "mic.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(voiceState.isMuted ? mutedColor : .white)
                        .frame(width: 36, height: 36)
                        .background(
                            voiceState.isMuted
                                ? mutedColor.opacity(0.2)
                                : Color.white.opacity(0.1)
                        )
                        .clipShape(Circle())
                }

                // Deafen button
                Button {
                    voiceState.toggleDeafen()
                } label: {
                    Image(systemName: voiceState.isDeafened ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(voiceState.isDeafened ? mutedColor : .white)
                        .frame(width: 36, height: 36)
                        .background(
                            voiceState.isDeafened
                                ? mutedColor.opacity(0.2)
                                : Color.white.opacity(0.1)
                        )
                        .clipShape(Circle())
                }

                // Hang up button
                Button {
                    Task { await voiceState.leaveVoice() }
                } label: {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(redColor)
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(barColor)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .animation(.spring(duration: 0.3), value: voiceState.isConnected)
        }
    }
}

#Preview {
    ZStack {
        Color(red: 0.07, green: 0.07, blue: 0.09)
            .ignoresSafeArea()

        VStack {
            Spacer()
            VoiceBar {
                print("Navigate to voice channel")
            }
        }
    }
    .environment(VoiceState())
}
