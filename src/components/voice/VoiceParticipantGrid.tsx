import { Volume2, Volume1, VolumeX, MicOff, HeadphoneOff, Radio } from "lucide-react";
import { useVoiceStore } from "@/stores/voice/index.js";
import { ParticipantTile } from "./ParticipantTile.js";
import { LobbyMusicBar } from "./LobbyMusicBar.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "@/lib/avatarColor.js";
import type { SpotifyPlayerState } from "@/stores/spotify/types.js";
import type { ListeningSession, QueueItem } from "@/types/user.js";
import type { MemberWithUser } from "@/types/shared.js";
import type { VoiceUser } from "@/stores/voice/types.js";

// ── Types ──

interface NowPlayingTrack {
  name: string;
  artist: string;
  imageUrl?: string;
}

interface VoiceParticipantGridProps {
  participants: VoiceUser[];
  members: MemberWithUser[];
  localParticipantIdentity: string | undefined;
  participantVolumes: Record<string, number>;
  setParticipantVolume: (userId: string, volume: number) => void;
  screenSharerIds: Set<string>;
  // Now-playing props
  session: ListeningSession | null;
  playerState: SpotifyPlayerState | null;
  youtubeTrack: NowPlayingTrack | null;
  queue: QueueItem[];
  volume: number;
  setVolume: (v: number) => void;
}

// ── Speaking Avatar ──
// The glow ring animates via rAF reading audio levels directly from the store (no re-render).
// Only the binary speaking boolean triggers a React re-render.
function SpeakingAvatar({ userId, username, image, large, role, memberRingStyle, memberRingSpin, memberRingPatternSeed, isStreaming }: {
  userId: string; username: string; image?: string | null; large?: boolean; role?: string;
  memberRingStyle?: string; memberRingSpin?: boolean; memberRingPatternSeed?: number | null;
  isStreaming?: boolean;
}) {
  const speaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  const rc = ringClass(memberRingStyle, memberRingSpin, role, false, memberRingPatternSeed);

  return (
    <div className={`voice-avatar-wrapper ${large ? "large" : ""}`}>
      <div className={`voice-participant-ring ${rc}`} style={{ "--ring-color": avatarColor(username), ...ringGradientStyle(memberRingPatternSeed, memberRingStyle) } as React.CSSProperties}>
        <div className={`voice-participant-avatar ${speaking ? "speaking" : ""} ${large ? "large" : ""}`}>
          {image ? (
            <img src={image} alt={username} className="avatar-img" />
          ) : (
            username.charAt(0).toUpperCase()
          )}
        </div>
      </div>
      {isStreaming && (
        <div className="voice-avatar-streaming-badge" title="Streaming">
          <Radio size={10} />
        </div>
      )}
    </div>
  );
}

// ── Now-Playing Bar ──
function NowPlayingBar({ session, playerState, youtubeTrack, queue, volume, setVolume }: {
  session: ListeningSession | null;
  playerState: SpotifyPlayerState | null;
  youtubeTrack: NowPlayingTrack | null;
  queue: { trackName: string }[];
  volume: number;
  setVolume: (v: number) => void;
}) {
  if (!session) return null;

  const spotifyTrack = playerState?.track_window?.current_track;
  const npName = youtubeTrack ? youtubeTrack.name : spotifyTrack?.name;
  const npArtist = youtubeTrack ? youtubeTrack.artist : spotifyTrack?.artists.map(a => a.name).join(", ");
  const npArt = youtubeTrack ? youtubeTrack.imageUrl : spotifyTrack?.album.images[0]?.url;
  if (!npName) return null;
  const nextTrack = queue[0];

  return (
    <div className="voice-now-playing">
      {npArt && (
        <img src={npArt} alt="" className="voice-np-art" />
      )}
      <div className="voice-np-info">
        <span className="voice-np-name">{npName}</span>
        <span className="voice-np-artist">{npArtist}</span>
      </div>
      <div className="voice-np-volume">
        <button
          className="voice-np-mute-btn"
          onClick={() => setVolume(volume > 0 ? 0 : 0.5)}
          title={volume === 0 ? "Unmute Music" : "Mute Music"}
        >
          {volume === 0 ? <VolumeX size={16} /> : <Volume1 size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
          className="volume-slider voice-np-slider"
        />
      </div>
      {nextTrack && (
        <span className="voice-np-next" title={`Next: ${nextTrack.trackName}`}>
          Next: {nextTrack.trackName}
        </span>
      )}
    </div>
  );
}

// ── Main Export ──
export function VoiceParticipantGrid({
  participants,
  members,
  localParticipantIdentity,
  participantVolumes,
  setParticipantVolume,
  screenSharerIds,
  session,
  playerState,
  youtubeTrack,
  queue,
  volume,
  setVolume,
}: VoiceParticipantGridProps) {
  return (
    <>
      {/* Participants */}
      <div className="voice-participants-grid">
        {participants.map((user) => {
          const member = members.find((m) => m.userId === user.userId);
          const tileBanner = bannerBackground(member?.bannerCss, member?.bannerPatternSeed);
          return (
            <ParticipantTile key={user.userId} userId={user.userId} username={user.username} banner={tileBanner}>
              <SpeakingAvatar
                userId={user.userId}
                username={user.username}
                image={member?.image}
                role={member?.role}
                memberRingStyle={member?.ringStyle}
                memberRingSpin={member?.ringSpin}
                memberRingPatternSeed={member?.ringPatternSeed}
                isStreaming={screenSharerIds.has(user.userId)}
                large
              />
              <span className="voice-tile-name">
                {user.username}
                {(user.isMuted || user.isDeafened) && (
                  <span className="voice-tile-status-icons">
                    {user.isMuted && <MicOff size={14} className="voice-tile-status-icon" />}
                    {user.isDeafened && <HeadphoneOff size={14} className="voice-tile-status-icon" />}
                  </span>
                )}
              </span>
              {user.userId !== localParticipantIdentity && (
                <div className="voice-tile-volume">
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={Math.round((participantVolumes[user.userId] ?? 1.0) * 100)}
                    onChange={(e) => setParticipantVolume(user.userId, parseInt(e.target.value) / 100)}
                    className="volume-slider"
                    title={`Volume: ${Math.round((participantVolumes[user.userId] ?? 1.0) * 100)}%`}
                  />
                </div>
              )}
            </ParticipantTile>
          );
        })}
      </div>

      {/* Lobby music bar (easter egg) */}
      <LobbyMusicBar />

      {/* Mini now-playing bar (Spotify or YouTube) */}
      <NowPlayingBar
        session={session}
        playerState={playerState}
        youtubeTrack={youtubeTrack}
        queue={queue}
        volume={volume}
        setVolume={setVolume}
      />
    </>
  );
}
