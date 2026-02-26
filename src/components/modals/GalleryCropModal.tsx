import { useEffect, useRef, useState, useCallback } from "react";
import { useGalleryStore } from "@/stores/gallery.js";

interface GalleryCropModalProps {
  imageUrl: string;
  imageId: string;
  onConfirm: (focusX: number, focusY: number) => void;
  onCancel: () => void;
}

const PREVIEW_WIDTH = 400;
const PREVIEW_HEIGHT = 160;

export function GalleryCropModal({ imageUrl, imageId, onConfirm, onCancel }: GalleryCropModalProps) {
  const existingFocus = useGalleryStore((s) => s.focusPoints[imageId]);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.width, h: img.height });

      // Fit to fill the preview area
      const scaleW = PREVIEW_WIDTH / img.width;
      const scaleH = PREVIEW_HEIGHT / img.height;
      const scale = Math.max(scaleW, scaleH);
      setZoom(scale);

      // Center, then apply existing focus point offset
      const fx = existingFocus?.x ?? 50;
      const fy = existingFocus?.y ?? 50;
      const centeredX = (PREVIEW_WIDTH - img.width * scale) / 2;
      const centeredY = (PREVIEW_HEIGHT - img.height * scale) / 2;
      // Focus: 50% = centered; deviations shift the image
      const maxShiftX = (img.width * scale - PREVIEW_WIDTH) / 2;
      const maxShiftY = (img.height * scale - PREVIEW_HEIGHT) / 2;
      setOffset({
        x: centeredX + (50 - fx) / 50 * maxShiftX,
        y: centeredY + (50 - fy) / 50 * maxShiftY,
      });

      setImgLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl, existingFocus]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };

    const onMouseMove = (ev: MouseEvent) => {
      setOffset({
        x: dragStart.current.ox + (ev.clientX - dragStart.current.x),
        y: dragStart.current.oy + (ev.clientY - dragStart.current.y),
      });
    };
    const onMouseUp = () => {
      setDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [offset]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom((z) => {
      const img = imgRef.current;
      if (!img) return z;
      const minScale = Math.max(PREVIEW_WIDTH / img.width, PREVIEW_HEIGHT / img.height);
      return Math.max(minScale, z + delta * z);
    });
  }, []);

  const handleZoomSlider = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const minScale = Math.max(PREVIEW_WIDTH / img.width, PREVIEW_HEIGHT / img.height);
    const maxScale = minScale * 4;
    const val = parseFloat(e.target.value);
    setZoom(minScale + (maxScale - minScale) * (val / 100));
  }, []);

  const getZoomSliderValue = useCallback((): number => {
    const img = imgRef.current;
    if (!img) return 0;
    const minScale = Math.max(PREVIEW_WIDTH / img.width, PREVIEW_HEIGHT / img.height);
    const maxScale = minScale * 4;
    if (maxScale === minScale) return 0;
    return Math.max(0, Math.min(100, ((zoom - minScale) / (maxScale - minScale)) * 100));
  }, [zoom]);

  const handleConfirm = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;

    // Convert offset + zoom back to focus point (0-100%)
    const scaledW = img.width * zoom;
    const scaledH = img.height * zoom;
    const centeredX = (PREVIEW_WIDTH - scaledW) / 2;
    const centeredY = (PREVIEW_HEIGHT - scaledH) / 2;
    const maxShiftX = (scaledW - PREVIEW_WIDTH) / 2;
    const maxShiftY = (scaledH - PREVIEW_HEIGHT) / 2;

    let fx = 50;
    let fy = 50;
    if (maxShiftX > 0) {
      fx = 50 - ((offset.x - centeredX) / maxShiftX) * 50;
    }
    if (maxShiftY > 0) {
      fy = 50 - ((offset.y - centeredY) / maxShiftY) * 50;
    }

    fx = Math.max(0, Math.min(100, fx));
    fy = Math.max(0, Math.min(100, fy));

    onConfirm(fx, fy);
  }, [offset, zoom, onConfirm]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal gallery-crop-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Position Image</h3>
        <p className="gallery-crop-hint">Drag to reposition. Scroll or use the slider to zoom.</p>
        <div
          ref={containerRef}
          className="gallery-crop-preview"
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          style={{ cursor: dragging ? "grabbing" : "grab" }}
        >
          {imgLoaded && imgRef.current && (
            <img
              src={imageUrl}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: offset.x,
                top: offset.y,
                width: imgSize.w * zoom,
                height: imgSize.h * zoom,
                pointerEvents: "none",
              }}
            />
          )}
        </div>
        <div className="crop-zoom-row">
          <span>Zoom</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={getZoomSliderValue()}
            onChange={handleZoomSlider}
            className="settings-slider"
          />
        </div>
        <div className="modal-actions">
          <button className="btn-small" onClick={onCancel}>Cancel</button>
          <button className="btn-primary btn-small" onClick={handleConfirm}>Save</button>
        </div>
      </div>
    </div>
  );
}
