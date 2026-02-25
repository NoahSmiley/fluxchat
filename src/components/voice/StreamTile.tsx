import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Track, RoomEvent, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { useVoiceStore } from "@/stores/voice/index.js";
import {
  ArrowUpRight, Pin, PinOff, Maximize2, Minimize2,
} from "lucide-react";

function applyMaxQuality(pub: RemoteTrackPublication) {
  // Request 1080p — matches the max resolution we actually publish
  pub.setVideoDimensions({ width: 1920, height: 1080 });
  pub.setVideoQuality(VideoQuality.HIGH);
}

// ── Single Stream Tile ──
// Attaches a LiveKit video track to a <video> element for one screen sharer.
interface StreamTileProps {
  participantId: string;
  username: string;
  isPinned: boolean;
}

export function StreamTile({ participantId, username, isPinned }: StreamTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pubRef = useRef<RemoteTrackPublication | null>(null);
  const { room, pinScreenShare, unpinScreenShare, toggleTheatreMode, theatreMode } = useVoiceStore(useShallow((s) => ({
    room: s.room, pinScreenShare: s.pinScreenShare, unpinScreenShare: s.unpinScreenShare,
    toggleTheatreMode: s.toggleTheatreMode, theatreMode: s.theatreMode,
  })));

  /** Find and attach the screen share track for this participant */
  const attachTrack = useCallback(() => {
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
  }, [room, participantId]);

  useEffect(() => {
    if (!room) return;

    // Try to attach immediately (track may already be subscribed)
    attachTrack();

    // Listen for late track subscriptions so we attach when the track arrives
    const onTrackSubscribed = (track: Track, _pub: RemoteTrackPublication, participant: { identity: string }) => {
      if (participant.identity === participantId && track.kind === Track.Kind.Video) {
        attachTrack();
      }
    };
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      // Detach any currently attached track
      if (room && videoRef.current) {
        const findTrack = (): Track | undefined => {
          if (participantId === room.localParticipant.identity) {
            for (const pub of room.localParticipant.videoTrackPublications.values()) {
              if (pub.source === Track.Source.ScreenShare && pub.track) return pub.track;
            }
          } else {
            const p = room.remoteParticipants.get(participantId);
            if (p) {
              for (const pub of p.videoTrackPublications.values()) {
                if (pub.source === Track.Source.ScreenShare && pub.track) return pub.track;
              }
            }
          }
        };
        const t = findTrack();
        if (t) t.detach(videoRef.current);
      }
      pubRef.current = null;
    };
  }, [room, participantId, attachTrack]);

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

