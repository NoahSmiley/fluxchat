import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { onStateUpdate, sendCommand, type VoiceStateMessage } from "../lib/broadcast.js";
import * as api from "../lib/api.js";

type PopoutQuality = "high" | "medium" | "low";

const QUALITY_DIMENSIONS: Record<PopoutQuality, { width: number; height: number }> = {
  high: { width: 3840, height: 2160 },
  medium: { width: 1920, height: 1080 },
  low: { width: 1280, height: 720 },
};

function applyQuality(pub: RemoteTrackPublication, quality: PopoutQuality) {
  pub.setVideoDimensions(QUALITY_DIMENSIONS[quality]);
  pub.setVideoQuality(VideoQuality.HIGH);
}

export function PopoutScreenShareView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const pubRef = useRef<RemoteTrackPublication | null>(null);
  const [status, setStatus] = useState("Waiting for screen share...");
  const [sharerName, setSharerName] = useState<string | null>(null);
  const [quality, setQuality] = useState<PopoutQuality>("high");
  const qualityRef = useRef<PopoutQuality>("high");
  qualityRef.current = quality;

  // Update quality on the active publication when selection changes
  useEffect(() => {
    if (pubRef.current) {
      applyQuality(pubRef.current, quality);
    }
  }, [quality]);

  useEffect(() => {
    let currentChannelId: string | null = null;
    let currentSharerPid: string | null = null;
    let connecting = false;

    // Request initial state from main window
    sendCommand({ type: "request-state" });

    const cleanup = onStateUpdate(async (msg) => {
      if (msg.type !== "voice-state") return;
      const voiceMsg = msg as VoiceStateMessage;

      // If no screen share info, disconnect
      if (!voiceMsg.connectedChannelId || !voiceMsg.screenSharerParticipantId) {
        if (roomRef.current) {
          roomRef.current.disconnect();
          roomRef.current = null;
        }
        pubRef.current = null;
        currentChannelId = null;
        currentSharerPid = null;
        setStatus("Screen share ended");
        setSharerName(null);
        return;
      }

      setSharerName(voiceMsg.screenSharerUsername);

      // If already connected to same channel+sharer, skip
      if (
        currentChannelId === voiceMsg.connectedChannelId &&
        currentSharerPid === voiceMsg.screenSharerParticipantId
      ) {
        return;
      }

      // Prevent concurrent connection attempts
      if (connecting) return;
      connecting = true;

      currentChannelId = voiceMsg.connectedChannelId;
      currentSharerPid = voiceMsg.screenSharerParticipantId;

      // Disconnect existing room
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      pubRef.current = null;

      setStatus("Connecting...");

      try {
        // Fetch a fresh viewer token directly from the API
        const { token, url } = await api.getVoiceToken(voiceMsg.connectedChannelId, true);

        const room = new Room({
          adaptiveStream: false,
        });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track, publication) => {
          if (track.source === Track.Source.ScreenShare && track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current);
            const remotePub = publication as RemoteTrackPublication;
            requestAnimationFrame(() => {
              applyQuality(remotePub, qualityRef.current);
            });
            pubRef.current = remotePub;
            setStatus("Watching");
          }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track.source === Track.Source.ScreenShare && videoRef.current) {
            track.detach(videoRef.current);
            pubRef.current = null;
            setStatus("Screen share ended");
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          pubRef.current = null;
          setStatus("Disconnected");
        });

        await room.connect(url, token);

        // Check if sharer is already publishing
        for (const participant of room.remoteParticipants.values()) {
          if (participant.identity === voiceMsg.screenSharerParticipantId) {
            for (const pub of participant.videoTrackPublications.values()) {
              if (pub.source === Track.Source.ScreenShare && pub.track && videoRef.current) {
                pub.track.attach(videoRef.current);
                const remotePub = pub as RemoteTrackPublication;
                requestAnimationFrame(() => {
                  applyQuality(remotePub, qualityRef.current);
                });
                pubRef.current = remotePub;
                setStatus("Watching");
              }
            }
          }
        }
      } catch (err) {
        setStatus("Connection failed");
        console.error("Popout screen share connection failed:", err);
      } finally {
        connecting = false;
      }
    });

    return () => {
      cleanup();
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      pubRef.current = null;
    };
  }, []);

  return (
    <div className="popout-screenshare">
      <div className="popout-header">
        <span>{sharerName ? `${sharerName}'s screen` : "Screen Share"}</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            className="quality-select"
            value={quality}
            onChange={(e) => setQuality(e.target.value as PopoutQuality)}
          >
            <option value="high">Source</option>
            <option value="medium">1080p</option>
            <option value="low">720p</option>
          </select>
          <span className="popout-status">{status}</span>
        </div>
      </div>
      <video ref={videoRef} autoPlay playsInline className="popout-screenshare-video" />
    </div>
  );
}
