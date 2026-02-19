import { useEffect, useRef, useState, type ReactNode } from "react";
import { Track, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { useVoiceStore } from "../stores/voice.js";
import { useChatStore } from "../stores/chat.js";
import { useSpotifyStore } from "../stores/spotify.js";
import { MusicPanel } from "./MusicPanel.js";
import {
  ArrowUpRight, Volume2, Volume1, VolumeX, Mic, MicOff, Headphones, HeadphoneOff,
  PhoneOff, Monitor, MonitorOff, Pin, PinOff, Maximize2, Minimize2,
  Music, Beer,
} from "lucide-react";
import { avatarColor, ringClass, ringGradientStyle } from "../lib/avatarColor.js";

function applyMaxQuality(pub: RemoteTrackPublication) {
  // Request 1080p — matches the max resolution we actually publish
  pub.setVideoDimensions({ width: 1920, height: 1080 });
  pub.setVideoQuality(VideoQuality.HIGH);
}

// ── Single Stream Tile ──
// Attaches a LiveKit video track to a <video> element for one screen sharer.
function StreamTile({ participantId, username, isPinned }: {
  participantId: string;
  username: string;
  isPinned: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pubRef = useRef<RemoteTrackPublication | null>(null);
  const { room, pinScreenShare, unpinScreenShare, toggleTheatreMode, theatreMode } = useVoiceStore();

  useEffect(() => {
    if (!room || !videoRef.current) return;

    let track: Track | undefined;
    pubRef.current = null;

    if (participantId === room.localParticipant.identity) {
      for (const pub of room.localParticipant.videoTrackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare && pub.track) {
          track = pub.track;
          break;
        }
      }
    } else {
      const participant = room.remoteParticipants.get(participantId);
      if (participant) {
        for (const pub of participant.videoTrackPublications.values()) {
          if (pub.source === Track.Source.ScreenShare && pub.track) {
            track = pub.track;
            pubRef.current = pub as RemoteTrackPublication;
            break;
          }
        }
      }
    }

    if (track && videoRef.current) {
      track.attach(videoRef.current);
      if (pubRef.current) {
        const pub = pubRef.current;
        requestAnimationFrame(() => applyMaxQuality(pub));
      }
    }

    return () => {
      if (track && videoRef.current) {
        track.detach(videoRef.current);
      }
      pubRef.current = null;
    };
  }, [room, participantId]);

  return (
    <div className={`stream-tile ${isPinned ? "pinned" : ""}`}>
      <span className="stream-tile-label">{username}'s screen</span>
      <div className="stream-tile-header">
        <div className="stream-tile-actions">
          {isPinned ? (
            <>
              <button
                className="stream-tile-btn"
                onClick={toggleTheatreMode}
                title={theatreMode ? "Exit Theatre Mode" : "Theatre Mode"}
              >
                {theatreMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button
                className="stream-tile-btn"
                onClick={() => import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_popout_window", { windowType: "screenshare" })).catch(() => {})}
                title="Pop out"
              >
                <ArrowUpRight size={14} />
              </button>
              <button className="stream-tile-btn" onClick={unpinScreenShare} title="Unpin">
                <PinOff size={14} />
              </button>
            </>
          ) : (
            <button className="stream-tile-btn" onClick={() => pinScreenShare(participantId)} title="Pin as main">
              <Pin size={14} />
            </button>
          )}
        </div>
      </div>
      <video ref={videoRef} autoPlay playsInline className="stream-tile-video" />
    </div>
  );
}

// ── Speaking Avatar ──
// The glow ring animates via rAF reading audio levels directly from the store (no re-render).
// Only the binary speaking boolean triggers a React re-render.
function SpeakingAvatar({ userId, username, image, large, role, memberRingStyle, memberRingSpin, memberRingPatternSeed }: {
  userId: string; username: string; image?: string | null; large?: boolean; role?: string;
  memberRingStyle?: string; memberRingSpin?: boolean; memberRingPatternSeed?: number | null;
}) {
  const speaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  const ringRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const rc = ringClass(memberRingStyle, memberRingSpin, role, false, memberRingPatternSeed);

  // Determine the ring color — use the avatar's base color as the speaking ring color
  const ringColor = avatarColor(username);

  // Animate the speaking ring at 60fps by reading audioLevels directly — no React re-render
  useEffect(() => {
    if (!speaking) {
      // Reset ring when not speaking
      if (ringRef.current) {
        ringRef.current.style.transform = "scale(1)";
        ringRef.current.style.opacity = "0";
        ringRef.current.style.boxShadow = "none";
      }
      return;
    }
    let smoothed = 0;
    function animate() {
      const raw = useVoiceStore.getState().audioLevels[userId] ?? 0;
      // Smooth: fast attack, slow release
      smoothed = raw > smoothed ? raw * 0.7 + smoothed * 0.3 : raw * 0.15 + smoothed * 0.85;
      const intensity = Math.min(smoothed * 10, 1);
      const scale = 1 + intensity * 0.5;
      const opacity = 0.4 + intensity * 0.6;
      const glowSize = Math.round(4 + intensity * 16);
      if (ringRef.current) {
        ringRef.current.style.transform = `scale(${scale})`;
        ringRef.current.style.opacity = `${opacity}`;
        ringRef.current.style.boxShadow = `0 0 ${glowSize}px ${ringColor}`;
      }
      rafRef.current = requestAnimationFrame(animate);
    }
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [speaking, userId, ringColor]);

  return (
    <div className={`voice-avatar-wrapper ${large ? "large" : ""}`}>
      <div
        ref={ringRef}
        className={`voice-avatar-speaking-ring ${speaking ? "active" : ""}`}
        style={{ transform: "scale(1)", opacity: 0, background: ringColor }}
      />
      <div className={`voice-participant-ring ${rc}`} style={{ "--ring-color": avatarColor(username), ...ringGradientStyle(memberRingPatternSeed, memberRingStyle) } as React.CSSProperties}>
        <div className={`voice-participant-avatar ${speaking ? "speaking" : ""} ${large ? "large" : ""}`}>
          {image ? (
            <img src={image} alt={username} className="avatar-img" />
          ) : (
            username.charAt(0).toUpperCase()
          )}
        </div>
      </div>
    </div>
  );
}

/** Wraps a participant tile so the speaking class updates via store subscription, not parent re-render */
function ParticipantTile({ userId, username, children }: { userId: string; username: string; children: ReactNode }) {
  const speaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  const color = avatarColor(username);
  return (
    <div className={`voice-participant-tile ${speaking ? "speaking" : ""}`} style={{ "--ring-color": color } as React.CSSProperties}>
      {children}
    </div>
  );
}

// ── Main Export ──
export function VoiceChannelView() {
  const { channels, activeChannelId, members } = useChatStore();
  const {
    room,
    connectedChannelId,
    connecting,
    connectionError,
    participants,
    isMuted,
    isDeafened,
    isScreenSharing,
    screenSharers,
    pinnedScreenShare,
    theatreMode,
    participantVolumes,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    setParticipantVolume,
    screenShareQuality,
    setScreenShareQuality,
    channelParticipants,
    incrementDrinkCount,
  } = useVoiceStore();
  const { loadSession, account, playerState, session, queue, volume, setVolume } = useSpotifyStore();
  const [activeTab, setActiveTab] = useState<"voice" | "music">("voice");
  const [showQualityPicker, setShowQualityPicker] = useState(false);

  const channel = channels.find((c) => c.id === activeChannelId);
  const isConnected = connectedChannelId === activeChannelId;
  const hasScreenShares = screenSharers.length > 0;

  // Load session when connecting to voice channel or switching to music tab
  useEffect(() => {
    if (isConnected && activeChannelId) {
      loadSession(activeChannelId);
    }
  }, [isConnected, activeChannelId]);

  useEffect(() => {
    if (activeTab === "music" && activeChannelId) {
      loadSession(activeChannelId);
    }
  }, [activeTab, activeChannelId]);

  // Close quality picker when clicking outside
  useEffect(() => {
    if (!showQualityPicker) return;
    const handler = () => setShowQualityPicker(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showQualityPicker]);

  // Separate pinned vs unpinned streams
  const pinnedSharer = screenSharers.find((s) => s.participantId === pinnedScreenShare);
  const otherSharers = screenSharers.filter((s) => s.participantId !== pinnedScreenShare);

  return (
    <div className={`voice-channel-view ${theatreMode ? "theatre" : ""}`}>
      {isConnected && (
        <div className="voice-channel-tabs">
          <button
            className={`voice-tab ${activeTab === "voice" ? "active" : ""}`}
            onClick={() => setActiveTab("voice")}
          >
            <Volume2 size={14} /> Voice
          </button>
          <button
            className={`voice-tab ${activeTab === "music" ? "active" : ""}`}
            onClick={() => setActiveTab("music")}
          >
            <Music size={14} /> Music
          </button>
        </div>
      )}

      {connectionError && (
        <div className="voice-error">{connectionError}</div>
      )}

      {!isConnected && !connecting && (
        <div className="voice-join-prompt">
          <span className="voice-join-icon"><Volume2 size={48} /></span>
          <h2>{channel?.name ?? "Voice Channel"}</h2>
          <p>No one is currently in this voice channel.</p>
          <button
            className="btn-primary voice-join-btn"
            onClick={() => activeChannelId && joinVoiceChannel(activeChannelId)}
          >
            Join Voice
          </button>
        </div>
      )}

      {connecting && (
        <div className="voice-connecting">
          <div className="loading-spinner" />
          <p>Connecting...</p>
        </div>
      )}

      {isConnected && activeTab === "music" && activeChannelId && (
        <MusicPanel voiceChannelId={activeChannelId} />
      )}

      {isConnected && activeTab === "voice" && (
        <>
          {/* Screen shares area */}
          {hasScreenShares && (
            <div className="streams-area">
              {/* Pinned (main) stream */}
              {pinnedSharer && (
                <StreamTile
                  key={pinnedSharer.participantId}
                  participantId={pinnedSharer.participantId}
                  username={pinnedSharer.username}
                  isPinned
                />
              )}

              {/* Other streams as smaller tiles */}
              {otherSharers.length > 0 && (
                <div className="streams-secondary">
                  {otherSharers.map((sharer) => (
                    <StreamTile
                      key={sharer.participantId}
                      participantId={sharer.participantId}
                      username={sharer.username}
                      isPinned={false}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Participants */}
          <div className="voice-participants-grid">
            {participants.map((user) => {
              const member = members.find((m) => m.userId === user.userId);
              return (
              <ParticipantTile key={user.userId} userId={user.userId} username={user.username}>
                <SpeakingAvatar
                  userId={user.userId}
                  username={user.username}
                  image={member?.image}
                  role={member?.role}
                  memberRingStyle={member?.ringStyle}
                  memberRingSpin={member?.ringSpin}
                  memberRingPatternSeed={member?.ringPatternSeed}
                  large
                />
                <span className="voice-tile-name">
                  {user.username}
                  {(() => {
                    const drinks = (channelParticipants[connectedChannelId!] || []).find((p) => p.userId === user.userId)?.drinkCount ?? 0;
                    return drinks > 0 ? <span className="drink-badge">🍺{drinks}</span> : null;
                  })()}
                  {(user.isMuted || user.isDeafened) && (
                    <span className="voice-tile-status-icons">
                      {user.isMuted && <MicOff size={14} className="voice-tile-status-icon" />}
                      {user.isDeafened && <HeadphoneOff size={14} className="voice-tile-status-icon" />}
                    </span>
                  )}
                </span>
                {user.userId !== room?.localParticipant?.identity && (
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

          {/* Mini now-playing bar */}
          {session && playerState?.track_window?.current_track && (() => {
            const track = playerState.track_window.current_track!;
            const nextTrack = queue[0];
            return (
              <div className="voice-now-playing">
                {track.album.images[0] && (
                  <img src={track.album.images[0].url} alt="" className="voice-np-art" />
                )}
                <div className="voice-np-info">
                  <span className="voice-np-name">{track.name}</span>
                  <span className="voice-np-artist">{track.artists.map(a => a.name).join(", ")}</span>
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
          })()}
        </>
      )}

      {/* Controls bar — always visible when connected */}
      {isConnected && (
        <div className="voice-controls-bar">
          <button
            className={`voice-ctrl-btn ${isMuted ? "active" : ""}`}
            onClick={toggleMute}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            className={`voice-ctrl-btn ${isDeafened ? "active" : ""}`}
            onClick={toggleDeafen}
            title={isDeafened ? "Undeafen" : "Deafen"}
          >
            {isDeafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
          </button>
          <div className="screen-share-group">
            <button
              className={`voice-ctrl-btn ${isScreenSharing ? "active" : ""}`}
              onClick={() => toggleScreenShare()}
              title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
            >
              {isScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
            </button>
            {/* Only show quality picker to the person about to stream, not viewers */}
            {!isScreenSharing && !hasScreenShares && (
              <button
                className="voice-ctrl-btn quality-picker-toggle"
                onClick={(e) => { e.stopPropagation(); setShowQualityPicker((v) => !v); }}
                title="Stream Quality"
              >
                <span className="quality-label">{screenShareQuality}</span>
              </button>
            )}
            {showQualityPicker && !isScreenSharing && !hasScreenShares && (
              <div className="quality-picker-dropdown" onClick={(e) => e.stopPropagation()}>
                {(["1080p60", "1080p30", "720p60", "720p30", "480p30"] as const).map((q) => (
                  <button
                    key={q}
                    className={`quality-option ${screenShareQuality === q ? "active" : ""}`}
                    onClick={() => { setScreenShareQuality(q); setShowQualityPicker(false); }}
                  >
                    {q}
                  </button>
                ))}
                <div className="quality-separator" />
                <button
                  className={`quality-option quality-lossless ${screenShareQuality === "Lossless" ? "active" : ""}`}
                  onClick={() => { setScreenShareQuality("Lossless"); setShowQualityPicker(false); }}
                >
                  Lossless
                </button>
              </div>
            )}
          </div>
          <button
            className="voice-ctrl-btn drink-btn"
            onClick={incrementDrinkCount}
            title="Take a drink! 🍺"
          >
            <Beer size={20} />
          </button>
          <button
            className="voice-ctrl-btn disconnect"
            onClick={leaveVoiceChannel}
            title="Disconnect"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
