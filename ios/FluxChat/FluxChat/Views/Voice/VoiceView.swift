import SwiftUI

struct VoiceView: View {
    let channel: Channel

    @Environment(AuthState.self) private var authState
    @Environment(ChatState.self) private var chatState
    @Environment(VoiceState.self) private var voiceState

    // Desktop color palette
    private let bgPrimary = Color(red: 0.039, green: 0.039, blue: 0.039)
    private let bgSecondary = Color(red: 0.055, green: 0.055, blue: 0.055)
    private let bgTertiary = Color(red: 0.102, green: 0.102, blue: 0.102)
    private let borderColor = Color(red: 0.086, green: 0.086, blue: 0.086)
    private let textPrimary = Color(red: 0.91, green: 0.91, blue: 0.91)
    private let textSecondary = Color(red: 0.533, green: 0.533, blue: 0.533)
    private let textMuted = Color(red: 0.333, green: 0.333, blue: 0.333)
    private let danger = Color(red: 1.0, green: 0.267, blue: 0.267)

    private var isInThisChannel: Bool {
        voiceState.isConnected && voiceState.currentChannelId == channel.id
    }

    private var participants: [VoiceParticipant] {
        chatState.channelParticipants[channel.id] ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(borderColor).frame(height: 1)

            ScrollView {
                if participants.isEmpty && !isInThisChannel {
                    emptyState
                } else {
                    participantGrid
                }
            }
            .background(bgSecondary)

            Rectangle().fill(borderColor).frame(height: 1)
            controlBar
        }
        .background(bgPrimary)
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer().frame(height: 80)
            Image(systemName: "speaker.wave.2.circle")
                .font(.system(size: 56))
                .foregroundStyle(textMuted.opacity(0.6))
            Text("No one is here yet")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(textSecondary)
            Text("Join the voice channel to start talking")
                .font(.system(size: 14))
                .foregroundStyle(textMuted)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var participantGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 100, maximum: 140), spacing: 16)]
        return LazyVGrid(columns: columns, spacing: 16) {
            ForEach(participants) { participant in
                participantCard(participant)
            }
        }
        .padding(20)
    }

    private func participantCard(_ participant: VoiceParticipant) -> some View {
        let isSpeaking = voiceState.speakingUsers.contains(participant.userId)
        return VStack(spacing: 8) {
            ZStack {
                Circle()
                    .stroke(isSpeaking ? Color.green.opacity(0.6) : borderColor, lineWidth: isSpeaking ? 2.5 : 1)
                    .frame(width: 60, height: 60)
                AvatarView(username: participant.username, image: nil, size: 54)
            }
            Text(participant.username)
                .font(.system(size: 12))
                .foregroundStyle(textPrimary)
                .lineLimit(1)
            if participant.drinkCount > 0 {
                Text("\(participant.drinkCount)")
                    .font(.system(size: 10))
                    .foregroundStyle(.yellow.opacity(0.7))
            }
        }
        .padding(12)
        .background(bgTertiary)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(isSpeaking ? Color.green.opacity(0.3) : borderColor, lineWidth: 1)
        )
    }

    private var controlBar: some View {
        HStack(spacing: 16) {
            if isInThisChannel {
                Button { voiceState.toggleMute() } label: {
                    VStack(spacing: 4) {
                        Image(systemName: voiceState.isMuted ? "mic.slash.fill" : "mic.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(voiceState.isMuted ? danger : textPrimary)
                            .frame(width: 44, height: 44)
                            .background(bgTertiary)
                            .clipShape(Circle())
                        Text(voiceState.isMuted ? "Unmute" : "Mute")
                            .font(.system(size: 10))
                            .foregroundStyle(textMuted)
                    }
                }

                Button { voiceState.toggleDeafen() } label: {
                    VStack(spacing: 4) {
                        Image(systemName: voiceState.isDeafened ? "speaker.slash.fill" : "speaker.wave.2.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(voiceState.isDeafened ? danger : textPrimary)
                            .frame(width: 44, height: 44)
                            .background(bgTertiary)
                            .clipShape(Circle())
                        Text(voiceState.isDeafened ? "Undeafen" : "Deafen")
                            .font(.system(size: 10))
                            .foregroundStyle(textMuted)
                    }
                }

                Spacer()

                Button {
                    Task { await voiceState.leaveVoice() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "phone.down.fill").font(.system(size: 14))
                        Text("Leave").font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(danger)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                }
            } else {
                Spacer()
                Button {
                    Task { try? await voiceState.joinVoice(channelId: channel.id, channelName: channel.name) }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "speaker.wave.2.fill").font(.system(size: 14))
                        Text("Join Voice").font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundStyle(.black)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                }
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(bgPrimary)
    }
}
