import { useEffect, useRef, useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Track, RoomEvent, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { useVoiceStore } from "@/stores/voice/index.js";
import { X } from "lucide-react";
import type { VoiceState } from "@/stores/voice/types.js";

type Corner = VoiceState["floatingCorner"];

interface Props {
  participantId: string;
  username: string;
  onGoToStreams: () => void;
}

export function PinnedStreamFloating({ participantId, username, onGoToStreams }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { room, screenRoom, floatingCorner, setFloatingCorner, dismissFloating, floatingSize, setFloatingSize } = useVoiceStore(useShallow((s) => ({
    room: s.room, screenRoom: s.screenRoom,
    floatingCorner: s.floatingCorner, setFloatingCorner: s.setFloatingCorner,
    dismissFloating: s.dismissFloating, floatingSize: s.floatingSize, setFloatingSize: s.setFloatingSize,
  })));
  const lkRoom = screenRoom ?? room;

  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ mouseX: number; mouseY: number; elX: number; elY: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ mouseX: number; mouseY: number; w: number; h: number } | null>(null);

  // ── Attach LiveKit video track ──
  const attachTrack = useCallback(() => {
    if (!lkRoom || !videoRef.current) return;
    let track: Track | undefined;
    if (participantId === lkRoom.localParticipant.identity) {
      for (const pub of lkRoom.localParticipant.videoTrackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare && pub.track) { track = pub.track; break; }
      }
    } else {
      const p = lkRoom.remoteParticipants.get(participantId);
      if (p) {
        for (const pub of p.videoTrackPublications.values()) {
          if (pub.source === Track.Source.ScreenShare && pub.track) {
            track = pub.track;
            const rpub = pub as RemoteTrackPublication;
            requestAnimationFrame(() => {
              rpub.setVideoDimensions({ width: 640, height: 360 });
              rpub.setVideoQuality(VideoQuality.MEDIUM);
            });
            break;
          }
        }
      }
    }
    if (track && videoRef.current) track.attach(videoRef.current);
  }, [lkRoom, participantId]);

  useEffect(() => {
    if (!lkRoom) return;
    attachTrack();
    const onSub = (track: Track, _pub: RemoteTrackPublication, participant: { identity: string }) => {
      if (participant.identity === participantId && track.kind === Track.Kind.Video) attachTrack();
    };
    lkRoom.on(RoomEvent.TrackSubscribed, onSub);
    return () => {
      lkRoom.off(RoomEvent.TrackSubscribed, onSub);
      if (videoRef.current) {
        const findTrack = (): Track | undefined => {
          if (participantId === lkRoom.localParticipant.identity) {
            for (const pub of lkRoom.localParticipant.videoTrackPublications.values()) {
              if (pub.source === Track.Source.ScreenShare && pub.track) return pub.track;
            }
          } else {
            const p = lkRoom.remoteParticipants.get(participantId);
            if (p) for (const pub of p.videoTrackPublications.values()) {
              if (pub.source === Track.Source.ScreenShare && pub.track) return pub.track;
            }
          }
        };
        const t = findTrack();
        if (t && videoRef.current) t.detach(videoRef.current);
      }
    };
  }, [lkRoom, participantId, attachTrack]);

  // ── Drag logic ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, elX: rect.left, elY: rect.top };
    setDragging(true);
    setDragOffset(null);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.mouseX;
      const dy = e.clientY - dragStart.current.mouseY;
      setDragOffset({ x: dragStart.current.elX + dx, y: dragStart.current.elY + dy });
    };
    const onUp = (e: MouseEvent) => {
      setDragging(false);
      setDragOffset(null);
      dragStart.current = null;
      // Snap to nearest corner
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cx = e.clientX;
      const cy = e.clientY;
      const newCorner: Corner =
        cx < vw / 2 && cy < vh / 2 ? "top-left" :
        cx >= vw / 2 && cy < vh / 2 ? "top-right" :
        cx < vw / 2 ? "bottom-left" : "bottom-right";
      setFloatingCorner(newCorner);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
  }, [dragging, setFloatingCorner]);

  // ── Resize logic ──
  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStart.current = { mouseX: e.clientX, mouseY: e.clientY, w: floatingSize.width, h: floatingSize.height };
    setResizing(true);
  }, [floatingSize]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      if (!resizeStart.current) return;
      const corner = floatingCorner;
      // Resize direction depends on which corner the PiP is in
      const dx = corner.includes("right")
        ? resizeStart.current.mouseX - e.clientX   // dragging left to grow
        : e.clientX - resizeStart.current.mouseX;   // dragging right to grow
      const dy = corner.includes("bottom")
        ? resizeStart.current.mouseY - e.clientY
        : e.clientY - resizeStart.current.mouseY;
      // Maintain 16:9 aspect ratio based on the larger axis
      const delta = Math.max(dx, dy);
      const newW = Math.max(200, Math.min(800, resizeStart.current.w + delta));
      const newH = Math.round(newW * 9 / 16);
      setFloatingSize({ width: newW, height: newH });
    };
    const onUp = () => {
      setResizing(false);
      resizeStart.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
  }, [resizing, floatingCorner, setFloatingSize]);

  // While dragging, use absolute position; otherwise use CSS class for corner
  const style: React.CSSProperties = dragOffset
    ? { position: "fixed", left: dragOffset.x, top: dragOffset.y, width: floatingSize.width, height: floatingSize.height, transition: "none" }
    : { width: floatingSize.width, height: floatingSize.height };

  return (
    <div
      ref={containerRef}
      className={`floating-stream-pip ${dragging ? "dragging" : ""} corner-${floatingCorner}`}
      style={style}
      onMouseDown={onMouseDown}
      onDoubleClick={onGoToStreams}
    >
      <video ref={videoRef} autoPlay playsInline className="floating-stream-video" />
      <div className="floating-stream-overlay">
        <span className="floating-stream-label">{username}</span>
        <button
          className="floating-stream-close"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); dismissFloating(); }}
          title="Close"
        >
          <X size={12} />
        </button>
      </div>
      {/* Resize handle — corner opposite to the PiP's snapped corner */}
      <div
        className={`floating-stream-resize corner-${floatingCorner}`}
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
