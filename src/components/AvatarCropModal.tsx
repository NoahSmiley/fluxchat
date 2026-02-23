import { useEffect, useRef, useState, useCallback } from "react";

interface AvatarCropModalProps {
  imageUrl: string;
  onConfirm: (croppedDataUrl: string) => void;
  onCancel: () => void;
}

const OUTPUT_SIZE = 256;
const CANVAS_SIZE = 300;

export function AvatarCropModal({ imageUrl, onConfirm, onCancel }: AvatarCropModalProps) {
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
      const scale = CANVAS_SIZE / Math.min(img.width, img.height);
      setZoom(scale);
      setOffset({
        x: (CANVAS_SIZE - img.width * scale) / 2,
        y: (CANVAS_SIZE - img.height * scale) / 2,
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

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.drawImage(img, offset.x, offset.y, img.width * zoom, img.height * zoom);

    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
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
    setZoom((z) => Math.max(0.1, z + delta * z));
  }

  function handleZoomSlider(e: React.ChangeEvent<HTMLInputElement>) {
    const img = imgRef.current;
    if (!img) return;
    const minScale = CANVAS_SIZE / Math.max(img.width, img.height);
    const maxScale = minScale * 5;
    const val = parseFloat(e.target.value);
    setZoom(minScale + (maxScale - minScale) * (val / 100));
  }

  function getZoomSliderValue(): number {
    const img = imgRef.current;
    if (!img) return 50;
    const minScale = CANVAS_SIZE / Math.max(img.width, img.height);
    const maxScale = minScale * 5;
    return ((zoom - minScale) / (maxScale - minScale)) * 100;
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img) return;

    const out = document.createElement("canvas");
    out.width = OUTPUT_SIZE;
    out.height = OUTPUT_SIZE;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    const scale = OUTPUT_SIZE / CANVAS_SIZE;
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      img,
      offset.x * scale,
      offset.y * scale,
      img.width * zoom * scale,
      img.height * zoom * scale,
    );

    onConfirm(out.toDataURL("image/png"));
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Crop Avatar</h3>
        <div className="crop-canvas-container">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
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
