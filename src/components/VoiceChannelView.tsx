import { useEffect, useRef } from "react";
import { Track, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { useVoiceStore } from "../stores/voice.js";
import { useChatStore } from "../stores/chat.js";
import { useUIStore } from "../stores/ui.js";
import { ArrowUpRight, Volume2, Settings } from "lucide-react";
function applyMaxQuality(pub: RemoteTrackPublication) {
  pub.setVideoDimensions({ width: 3840, height: 2160 });
  pub.setVideoQuality(VideoQuality.HIGH);
}

function ScreenShareViewer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pubRef = useRef<RemoteTrackPublication | null>(null);
  const { room, watchingScreenShare, screenSharers, stopWatchingScreenShare } = useVoiceStore();

  const sharer = screenSharers.find((s) => s.participantId === watchingScreenShare);

  useEffect(() => {
    if (!room || !videoRef.current || !sharer) return;

    let track: Track | undefined;
    pubRef.current = null;

    if (sharer.participantId === room.localParticipant.identity) {
      for (const pub of room.localParticipant.videoTrackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare && pub.track) {
          track = pub.track;
          break;
        }
      }
    } else {
      const participant = room.remoteParticipants.get(sharer.participantId);
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
      // Always request max quality — streamer controls publishing quality
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
  }, [room, sharer, watchingScreenShare]);

  useEffect(() => {
    if (pubRef.current) {
      applyMaxQuality(pubRef.current);
    }
  }, []);

  if (!sharer) return null;

  return (
    <div className="screen-share-viewer">
      <div className="screen-share-header">
        <span className="screen-share-label">
          {sharer.username}'s screen
        </span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button className="btn-small popout-btn" onClick={() => import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_popout_window", { windowType: "screenshare" })).catch(() => {})} title="Pop out">
            <ArrowUpRight size={14} />
          </button>
          <button className="btn-small" onClick={stopWatchingScreenShare}>
            Stop Watching
          </button>
        </div>
      </div>
      <video ref={videoRef} autoPlay playsInline className="screen-share-video" />
    </div>
  );
}

function ScreenShareNotifications() {
  const { screenSharers, watchingScreenShare, watchScreenShare } = useVoiceStore();

  const unwatched = screenSharers.filter((s) => s.participantId !== watchingScreenShare);

  if (unwatched.length === 0) return null;

  return (
    <div className="screen-share-notifications">
      {unwatched.map((sharer) => (
        <div key={sharer.participantId} className="screen-share-notification">
          <span>{sharer.username} is sharing their screen</span>
          <button className="btn-small" onClick={() => watchScreenShare(sharer.participantId)}>
            Watch
          </button>
        </div>
      ))}
    </div>
  );
}

function SpeakingAvatar({ username, audioLevel, speaking }: { username: string; audioLevel: number; speaking: boolean }) {
  // Scale audio level (0-1) to a visual ring size
  const intensity = speaking ? Math.min(audioLevel * 3, 1) : 0;
  const ringScale = 1 + intensity * 0.35;
  const ringOpacity = speaking ? 0.3 + intensity * 0.7 : 0;

  return (
    <div className="voice-avatar-wrapper">
      <div
        className={`voice-avatar-ring ${speaking ? "active" : ""}`}
        style={{
          transform: `scale(${ringScale})`,
          opacity: ringOpacity,
        }}
      />
      <div className={`voice-participant-avatar ${speaking ? "speaking" : ""}`}>
        {username.charAt(0).toUpperCase()}
      </div>
    </div>
  );
}

export function VoiceChannelView() {
  const { channels, activeChannelId } = useChatStore();
  const {
    room,
    connectedChannelId,
    connecting,
    connectionError,
    participants,
    isMuted,
    isDeafened,
    isScreenSharing,
    watchingScreenShare,
    participantVolumes,
    audioLevels,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    setParticipantVolume,
  } = useVoiceStore();

  const { openSettings, settingsOpen } = useUIStore();
  const channel = channels.find((c) => c.id === activeChannelId);
  const isConnected = connectedChannelId === activeChannelId;

  return (
    <div className="voice-channel-view">
      <div className="voice-channel-header">
        <span className="voice-channel-icon"><Volume2 size={24} /></span>
        <h2>{channel?.name ?? "Voice Channel"}</h2>
      </div>

      {connectionError && (
        <div className="voice-error">{connectionError}</div>
      )}

      {!isConnected && !connecting && (
        <div className="voice-join-prompt">
          <p>Click below to join voice</p>
          <button
            className="btn-primary voice-join-btn"
            onClick={() => activeChannelId && joinVoiceChannel(activeChannelId)}
          >
            Join Voice Channel
          </button>
        </div>
      )}

      {connecting && (
        <div className="voice-connecting">
          <div className="loading-spinner" />
          <p>Connecting...</p>
        </div>
      )}

      {isConnected && (
        <>
          <ScreenShareNotifications />
          {watchingScreenShare && <ScreenShareViewer />}

          <div className="voice-participants">
            {participants.map((user) => (
              <div
                key={user.userId}
                className={`voice-participant ${user.speaking ? "speaking" : ""}`}
              >
                <SpeakingAvatar
                  username={user.username}
                  audioLevel={audioLevels[user.userId] ?? 0}
                  speaking={user.speaking}
                />
                <span className="voice-participant-name">{user.username}</span>
                {user.userId !== room?.localParticipant?.identity && (
                  <div className="participant-volume">
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={Math.round((participantVolumes[user.userId] ?? 1.0) * 100)}
                      onChange={(e) => setParticipantVolume(user.userId, parseInt(e.target.value) / 100)}
                      className="volume-slider"
                      title={`Volume: ${Math.round((participantVolumes[user.userId] ?? 1.0) * 100)}%`}
                    />
                    <span className="volume-label">
                      {Math.round((participantVolumes[user.userId] ?? 1.0) * 100)}%
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="voice-controls">
            <button
              className={`voice-control-btn ${isMuted ? "active" : ""}`}
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? "Unmute" : "Mute"}
            </button>
            <button
              className={`voice-control-btn ${isDeafened ? "active" : ""}`}
              onClick={toggleDeafen}
              title={isDeafened ? "Undeafen" : "Deafen"}
            >
              {isDeafened ? "Undeafen" : "Deafen"}
            </button>
            <button
              className={`voice-control-btn ${isScreenSharing ? "active" : ""}`}
              onClick={() => toggleScreenShare()}
              title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
            >
              {isScreenSharing ? "Stop Share" : "Screen"}
            </button>
            <button
              className={`voice-control-btn ${settingsOpen ? "active" : ""}`}
              onClick={openSettings}
              title="Settings"
            >
              <Settings size={14} />
            </button>
            <button
              className="voice-control-btn disconnect"
              onClick={leaveVoiceChannel}
              title="Disconnect"
            >
              Disconnect
            </button>
          </div>

        </>
      )}

    </div>
  );
}
