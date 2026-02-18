/**
 * CardRenderer — full-size trading card for the 3D viewer.
 * Rarity-colored frame, procedural art, card number, series, holo shimmer.
 */

import type { ItemRarity } from "../../types/shared.js";
import { RARITY_COLORS } from "../../types/shared.js";

interface CardRendererProps {
  name: string;
  rarity: ItemRarity;
  cardSeries: string | null;
  cardNumber: string | null;
  isHolographic: boolean;
}

const CARD_ART: Record<string, string> = {
  "1": "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460, #e94560)",
  "2": "linear-gradient(135deg, #0d1117, #161b22, #21262d, #30363d)",
  "3": "linear-gradient(135deg, #2d1b69, #11001c, #5c2d91, #b146c2)",
  "4": "linear-gradient(135deg, #1a1a2e, #0f0f23, #16213e, #404258)",
  "5": "linear-gradient(135deg, #0a192f, #172a45, #1f4068, #2a6f97)",
  "6": "linear-gradient(135deg, #1b0000, #3d0000, #8b0000, #ff4444)",
  "7": "linear-gradient(135deg, #ffd700, #ff8c00, #ff6347, #ffd700)",
  "8": "linear-gradient(135deg, #0c0c1d, #1a1a3e, #2a2a5e, #4040a0)",
  "9": "linear-gradient(135deg, #004d40, #00695c, #00897b, #4db6ac)",
  "10": "linear-gradient(135deg, #4a0080, #7b1fa2, #e040fb, #ea80fc)",
};

export function CardRenderer({ name, rarity, cardSeries, cardNumber, isHolographic }: CardRendererProps) {
  const color = RARITY_COLORS[rarity] ?? "#888";
  const art = CARD_ART[cardNumber ?? "1"] ?? CARD_ART["1"];
  const seriesLabel = cardSeries ? cardSeries.charAt(0).toUpperCase() + cardSeries.slice(1) + " Set" : "";

  return (
    <div className={`card-renderer ${isHolographic ? "holo" : ""}`} style={{ borderColor: color }}>
      {/* Card art area */}
      <div className="card-renderer-art" style={{ background: art }}>
        {isHolographic && <div className="card-renderer-holo-overlay" />}
        {cardNumber && (
          <span className="card-renderer-number" style={{ color }}>
            #{cardNumber}
          </span>
        )}
      </div>

      {/* Card info area */}
      <div className="card-renderer-info">
        <span className="card-renderer-name">{name}</span>
        <div className="card-renderer-meta">
          {seriesLabel && <span className="card-renderer-series">{seriesLabel}</span>}
          <span className="card-renderer-rarity" style={{ color }}>
            {rarity === "ultra_rare" ? "Ultra Rare" : rarity.charAt(0).toUpperCase() + rarity.slice(1)}
          </span>
        </div>
      </div>
    </div>
  );
}
