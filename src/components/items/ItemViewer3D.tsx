/**
 * ItemViewer3D — inline inspection view.
 * For cards: CSS 3D with perspective + drag rotation.
 * For rings: Three.js canvas with full 360° rotation (handled by RingRenderer).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { CardRenderer } from "./CardRenderer.js";
import { RingRenderer } from "./RingRenderer.js";
import { seedToPattern, type DopplerType } from "./dopplerPattern.js";
import { bannerBackground } from "../../lib/avatarColor.js";
import type { ItemRarity, ItemType } from "../../types/shared.js";
import { RARITY_COLORS } from "../../types/shared.js";

interface ItemViewer3DProps {
  name: string;
  rarity: ItemRarity;
  type: ItemType;
  previewCss: string | null;
  cardSeries: string | null;
  cardNumber: string | null;
  isHolographic: boolean;
  patternSeed: number | null;
  onClose: () => void;
}

export function ItemViewer3D({
  name,
  rarity,
  type,
  previewCss,
  cardSeries,
  cardNumber,
  isHolographic,
  patternSeed,
  onClose,
}: ItemViewer3DProps) {
  // CSS rotation only used for cards (rings handle their own via Three.js)
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const idleActive = useRef(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafId = useRef<number>(0);

  const isRing = type === "ring_style";
  const isBanner = type === "profile_banner";

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    idleActive.current = false;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 100;
        const my = ((e.clientY - rect.top) / rect.height) * 100;
        containerRef.current.style.setProperty("--mouse-x", `${mx}%`);
        containerRef.current.style.setProperty("--mouse-y", `${my}%`);
      }

      if (!dragging.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setRotation((prev) => ({
        x: prev.x - dy * 0.4,
        y: prev.y + dx * 0.4,
      }));
    },
    []
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    // Resume idle rotation after 3 seconds of inactivity
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { idleActive.current = true; }, 3000);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Idle rotation animation for cards (CS2-style)
  useEffect(() => {
    if (isRing) return; // rings handle their own via Three.js
    let lastTime = performance.now();
    function tick() {
      rafId.current = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      if (idleActive.current && !dragging.current) {
        setRotation((prev) => ({
          x: Math.sin(now * 0.0006) * 8, // gentle tilt ±8°
          y: prev.y + 18 * dt, // ~18° per second
        }));
      }
    }
    tick();
    return () => {
      cancelAnimationFrame(rafId.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [isRing]);

  const color = RARITY_COLORS[rarity] ?? "#888";
  const dopplerType: DopplerType = previewCss === "gamma_doppler" ? "gamma_doppler" : "doppler";
  const pattern = patternSeed != null ? seedToPattern(patternSeed, dopplerType) : null;
  const rarityLabel = rarity === "ultra_rare" ? "Ultra Rare" : rarity.charAt(0).toUpperCase() + rarity.slice(1);
  const rareGlow = pattern?.isRare && pattern.glowColor ? pattern.glowColor : null;

  return (
    <div className={`item-viewer-3d${rareGlow ? " viewer-rare-glow" : ""}`} style={rareGlow ? { "--viewer-glow": rareGlow } as React.CSSProperties : undefined}>
      <button className="item-viewer-3d-back" onClick={onClose}>
        <ChevronLeft size={16} /> Back
      </button>

      {isRing ? (
        /* Ring: Three.js canvas with its own rotation handling */
        <div className="item-viewer-3d-stage">
          <RingRenderer
            name={name}
            rarity={rarity}
            previewCss={previewCss}
            patternSeed={patternSeed}
          />
        </div>
      ) : (
        /* Card / Banner: CSS 3D with drag rotation */
        <div
          ref={containerRef}
          className="item-viewer-3d-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ cursor: dragging.current ? "grabbing" : "grab" }}
        >
          <div
            className="item-viewer-3d-object"
            style={{
              transform: `perspective(800px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
            }}
          >
            {isBanner ? (
              <div
                className="banner-renderer"
                style={{
                  background: bannerBackground(previewCss, patternSeed) ?? `linear-gradient(135deg, ${color}, ${color}44)`,
                }}
              >
                <div className="banner-renderer-shine" />
              </div>
            ) : (
              <CardRenderer
                name={name}
                rarity={rarity}
                cardSeries={cardSeries}
                cardNumber={cardNumber}
                isHolographic={isHolographic}
              />
            )}
          </div>
        </div>
      )}

      {/* Info panel */}
      <div className="item-viewer-3d-info">
        <span className="item-viewer-3d-name">{name}</span>
        <span className="item-viewer-3d-rarity" style={{ color }}>
          {rarityLabel}
        </span>
        {pattern && (
          <span className={`item-viewer-3d-pattern ${pattern.isRare ? "rare" : ""}`}>
            Pattern: {pattern.patternName}
            {patternSeed != null && <span className="item-viewer-3d-seed"> (#{patternSeed})</span>}
          </span>
        )}
        {isHolographic && <span className="item-viewer-3d-holo-badge">Holographic</span>}
      </div>
    </div>
  );
}
