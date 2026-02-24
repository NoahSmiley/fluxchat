import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { onStateUpdate, sendCommand, type VoiceStateMessage } from "../../lib/broadcast.js";
import * as api from "../../lib/api.js";
import { dbg } from "../../lib/debug.js";

function applyMaxQuality(pub: RemoteTrackPublication) {
  // Request 1080p — matches the max resolution we actually publish
  pub.setVideoDimensions({ width: 1920, height: 1080 });
  pub.setVideoQuality(VideoQuality.HIGH);
}

export function PopoutScreenShareView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const pubRef = useRef<RemoteTrackPublication | null>(null);
  const [status, setStatus] = useState("Waiting for screen share...");
  const [sharerName, setSharerName] = useState<string | null>(null);

  useEffect(() => {
    let currentChannelId: string | null = null;
    let currentSharerPid: string | null = null;
    let connecting = false;
    let hasConnected = false;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;

    // Request initial state from main window
    sendCommand({ type: "request-state" });

    const cleanup = onStateUpdate(async (msg) => {
      if (msg.type !== "voice-state") return;
      const voiceMsg = msg as VoiceStateMessage;

      // If no screen share info, handle gracefully
      if (!voiceMsg.connectedChannelId || !voiceMsg.screenSharerParticipantId) {
        if (roomRef.current) {
          roomRef.current.disconnect();
          roomRef.current = null;
        }
        pubRef.current = null;
        currentChannelId = null;
        currentSharerPid = null;

        // Only auto-close if we previously had a connection (stream genuinely ended)
        // Use a debounce to handle transient state updates
        if (hasConnected && !closeTimer) {
          setStatus("Screen share ended");
          closeTimer = setTimeout(() => {
            import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().close()).catch(() => {});
          }, 2000);
        }
        return;
      }

      // Valid state received — cancel any pending close
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
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
              applyMaxQuality(remotePub);
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
        hasConnected = true;

        // Check if sharer is already publishing
        for (const participant of room.remoteParticipants.values()) {
          if (participant.identity === voiceMsg.screenSharerParticipantId) {
            for (const pub of participant.videoTrackPublications.values()) {
              if (pub.source === Track.Source.ScreenShare && pub.track && videoRef.current) {
                pub.track.attach(videoRef.current);
                const remotePub = pub as RemoteTrackPublication;
                requestAnimationFrame(() => {
                  applyMaxQuality(remotePub);
                });
                pubRef.current = remotePub;
                setStatus("Watching");
              }
            }
          }
        }
      } catch (err) {
        setStatus("Connection failed");
        dbg("voice", "Popout screen share connection failed:", err);
      } finally {
        connecting = false;
      }
    });

    return () => {
      cleanup();
      if (closeTimer) clearTimeout(closeTimer);
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
        <span className="popout-status">{status}</span>
      </div>
      <video ref={videoRef} autoPlay playsInline className="popout-screenshare-video" />
    </div>
  );
}
