import { useEffect, useRef } from "react";
import { Track, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { useVoiceStore } from "../../stores/voice/index.js";
import {
  ArrowUpRight, Pin, PinOff, Maximize2, Minimize2, Monitor,
} from "lucide-react";
import { avatarColor } from "../../lib/avatarColor.js";

function applyMaxQuality(pub: RemoteTrackPublication) {
  // Request 1080p — matches the max resolution we actually publish
  pub.setVideoDimensions({ width: 1920, height: 1080 });
  pub.setVideoQuality(VideoQuality.HIGH);
}

// ── Single Stream Tile ──
// Attaches a LiveKit video track to a <video> element for one screen sharer.
export interface StreamTileProps {
  participantId: string;
  username: string;
  isPinned: boolean;
}

export function StreamTile({ participantId, username, isPinned }: StreamTileProps) {
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
      <video ref={videoRef} autoPlay playsInline className="stream-tile-video" />

      {/* Bottom bar — username + hover actions */}
      <div className="stream-tile-bottom-bar">
        <span className="stream-tile-label">{username}'s screen</span>
        <div className="stream-tile-actions">
          {isPinned ? (
            <>
              <button className="stream-tile-btn" onClick={toggleTheatreMode} title={theatreMode ? "Exit Theatre Mode" : "Theatre Mode"}>
                {theatreMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button className="stream-tile-btn" onClick={() => import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_popout_window", { windowType: "screenshare" })).catch(() => {})} title="Pop out">
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
    </div>
  );
}

// ── Dummy Stream Tile (for preview when showDummyUsers is on) ──
export interface DummyStreamTileProps {
  participantId: string;
  username: string;
  isPinned: boolean;
}

export function DummyStreamTile({ participantId, username, isPinned }: DummyStreamTileProps) {
  const color = avatarColor(username);
  const { pinScreenShare, unpinScreenShare } = useVoiceStore();

  return (
    <div className={`stream-tile ${isPinned ? "pinned" : ""}`}>
      <div className="dummy-stream-video" style={{ background: `linear-gradient(135deg, ${color}22, ${color}08)` }}>
        <Monitor size={isPinned ? 64 : 32} style={{ color: `${color}44` }} />
      </div>

      <div className="stream-tile-bottom-bar">
        <span className="stream-tile-label">{username}'s screen</span>
        <div className="stream-tile-actions">
          {isPinned ? (
            <button className="stream-tile-btn" onClick={unpinScreenShare} title="Unpin">
              <PinOff size={14} />
            </button>
          ) : (
            <button className="stream-tile-btn" onClick={() => pinScreenShare(participantId)} title="Pin as main">
              <Pin size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
