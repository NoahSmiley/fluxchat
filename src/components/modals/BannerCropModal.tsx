import { useEffect, useRef, useState, useCallback } from "react";

interface BannerCropModalProps {
  imageUrl: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

const OUTPUT_W = 900;
const OUTPUT_H = 300;
const CANVAS_W = 400;
const CANVAS_H = Math.round(CANVAS_W * (OUTPUT_H / OUTPUT_W));
const ASPECT = OUTPUT_W / OUTPUT_H;

export function BannerCropModal({ imageUrl, onConfirm, onCancel }: BannerCropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      // Fill the canvas: scale so the image covers the rectangle
      const scaleW = CANVAS_W / img.width;
      const scaleH = CANVAS_H / img.height;
      const scale = Math.max(scaleW, scaleH);
      setZoom(scale);
      setOffset({
        x: (CANVAS_W - img.width * scale) / 2,
        y: (CANVAS_H - img.height * scale) / 2,
      });
      setImgLoaded(true);
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(img, offset.x, offset.y, img.width * zoom, img.height * zoom);
  }, [offset, zoom]);

  useEffect(() => {
    if (imgLoaded) draw();
  }, [imgLoaded, draw]);

  function handleMouseDown(e: React.MouseEvent) {
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  }

  function handleMouseUp() {
    setDragging(false);
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom((z) => Math.max(0.01, z + delta * z));
  }

  function handleZoomSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const img = imgRef.current;
    if (!img) return;
    const minScale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
    const maxScale = minScale * 5;
    const val = parseFloat(e.target.value);
    setZoom(minScale + (maxScale - minScale) * (val / 100));
  }

  function getZoomSliderValue(): number {
    const img = imgRef.current;
    if (!img) return 50;
    const minScale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
    const maxScale = minScale * 5;
    return ((zoom - minScale) / (maxScale - minScale)) * 100;
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img) return;

    const out = document.createElement("canvas");
    out.width = OUTPUT_W;
    out.height = OUTPUT_H;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    const scale = OUTPUT_W / CANVAS_W;
    ctx.drawImage(
      img,
      offset.x * scale,
      offset.y * scale,
      img.width * zoom * scale,
      img.height * zoom * scale,
    );

    onConfirm(out.toDataURL("image/jpeg", 0.85));
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal banner-crop-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Crop Header</h3>
        <div className="banner-crop-canvas-container">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            style={{ cursor: dragging ? "grabbing" : "grab" }}
          />
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
