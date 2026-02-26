import { useState, useEffect, useRef, useCallback } from "react";
import { Settings } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useGalleryStore, type GalleryImage, type FocusPoint } from "@/stores/gallery.js";
import { ART_SETS } from "@/lib/galleryPresets.js";
import { getFileUrl } from "@/lib/api/messages.js";
import { GalleryPopover } from "./GalleryPopover.js";

function GalleryResizeHandle() {
  const setGalleryHeight = useGalleryStore((s) => s.setGalleryHeight);
  const dragging = useRef(false);
  const lastY = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    lastY.current = e.clientY;

    const startHeight = useGalleryStore.getState().galleryHeight;
    let currentHeight = startHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientY - lastY.current;
      lastY.current = ev.clientY;
      currentHeight = Math.max(60, Math.min(300, currentHeight + delta));
      setGalleryHeight(currentHeight);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [setGalleryHeight]);

  return <div className="gallery-resize-handle" onMouseDown={onMouseDown} />;
}

interface ChannelSidebarHeaderProps {
  serverName: string;
  isOwnerOrAdmin: boolean;
  onOpenSettings: () => void;
}

function isVideoMedia(img: GalleryImage): boolean {
  return img.mediaType === "video";
}

function getFocusPos(focus: FocusPoint | undefined): string {
  const x = focus?.x ?? 50;
  const y = focus?.y ?? 50;
  return `${x}% ${y}%`;
}

function galleryBgStyle(img: GalleryImage, focus: FocusPoint | undefined): React.CSSProperties {
  if (img.css) return { background: img.css };
  if (img.attachmentId && img.filename) {
    return {
      backgroundImage: `url(${getFileUrl(img.attachmentId, img.filename)})`,
      backgroundSize: "cover",
      backgroundPosition: getFocusPos(focus),
    };
  }
  if (img.dataUrl && !isVideoMedia(img)) {
    return {
      backgroundImage: `url(${img.dataUrl})`,
      backgroundSize: "cover",
      backgroundPosition: getFocusPos(focus),
    };
  }
  return {};
}

export function resolveCurrentImage(
  mode: string,
  singleImage: GalleryImage | null,
  activeSetId: string | null,
  currentSetIndex: number,
): GalleryImage | null {
  if (mode === "single") return singleImage;
  if (mode === "set" && activeSetId) {
    const artSet = ART_SETS.find((s) => s.id === activeSetId);
    if (artSet && artSet.images.length > 0) {
      return artSet.images[currentSetIndex % artSet.images.length];
    }
    // Check subscribed sets
    const { subscribedSets } = useGalleryStore.getState();
    const subSet = subscribedSets.find((s) => s.id === activeSetId);
    if (subSet && subSet.images.length > 0) {
      const img = subSet.images[currentSetIndex % subSet.images.length];
      return { id: img.id, name: img.name, attachmentId: img.attachmentId, filename: img.filename };
    }
  }
  return null;
}

export function ChannelSidebarHeader({ serverName, isOwnerOrAdmin, onOpenSettings }: ChannelSidebarHeaderProps) {
  const { mode, singleImage, activeSetId, currentSetIndex, galleryHeight, focusPoints } = useGalleryStore(
    useShallow((s) => ({
      mode: s.mode,
      singleImage: s.singleImage,
      activeSetId: s.activeSetId,
      currentSetIndex: s.currentSetIndex,
      galleryHeight: s.galleryHeight,
      focusPoints: s.focusPoints,
    })),
  );
  const rotateIfNeeded = useGalleryStore((s) => s.rotateIfNeeded);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Rotate on mount and periodically
  useEffect(() => {
    rotateIfNeeded();
    const interval = setInterval(rotateIfNeeded, 60_000);
    return () => clearInterval(interval);
  }, [rotateIfNeeded]);

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [popoverOpen]);

  const currentImage = resolveCurrentImage(mode, singleImage, activeSetId, currentSetIndex);
  const galleryActive = mode !== "off" && currentImage !== null;
  const currentFocus = currentImage ? focusPoints[currentImage.id] : undefined;

  const handleHeaderClick = useCallback(() => {
    if (galleryActive) {
      setPopoverOpen((v) => !v);
    } else if (isOwnerOrAdmin) {
      onOpenSettings();
    }
  }, [galleryActive, isOwnerOrAdmin, onOpenSettings]);

  if (!galleryActive) {
    return (
      <div ref={wrapperRef} style={{ position: "relative" }}>
        <div
          className="channel-sidebar-header"
          onClick={isOwnerOrAdmin ? onOpenSettings : undefined}
          style={{ cursor: isOwnerOrAdmin ? "pointer" : "default" }}
        >
          <span className="channel-sidebar-header-title">{serverName}</span>
          {isOwnerOrAdmin && (
            <button
              className="channel-sidebar-header-btn"
              title="Server Settings"
              onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
            >
              <Settings size={14} />
            </button>
          )}
        </div>
        {popoverOpen && <GalleryPopover onClose={() => setPopoverOpen(false)} />}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <div
        className="channel-sidebar-header gallery-active"
        onClick={handleHeaderClick}
        style={{ height: galleryHeight }}
      >
        {isVideoMedia(currentImage) ? (
          <video
            className="gallery-bg-video"
            src={currentImage.dataUrl}
            autoPlay
            loop
            muted
            playsInline
            style={{ objectPosition: getFocusPos(currentFocus) }}
          />
        ) : (
          <div className="gallery-bg" style={galleryBgStyle(currentImage, currentFocus)} />
        )}
        <GalleryResizeHandle />
      </div>
      {popoverOpen && <GalleryPopover onClose={() => setPopoverOpen(false)} />}
    </div>
  );
}
