/**
 * ItemPreview — replaces emoji typeIcon() with visual item previews.
 * Sizes: sm=28px, md=48px, lg=80px
 * Ring gradients rendered as inline divs (not CSS ::before).
 */

import { seedToPattern, RING_GRADIENTS, type DopplerType } from "./dopplerPattern.js";
import { BANNER_IMAGES } from "../../lib/avatarColor.js";
import type { ItemType, ItemRarity } from "../../types/shared.js";
import { RARITY_COLORS } from "../../types/shared.js";

interface ItemPreviewProps {
  type: ItemType;
  rarity: ItemRarity;
  previewCss: string | null;
  cardSeries?: string | null;
  cardNumber?: string | null;
  isHolographic?: boolean;
  patternSeed?: number | null;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZES = { sm: 28, md: 48, lg: 80, xl: 100 } as const;

// Card art gradients keyed by card number
const CARD_ART: Record<string, string> = {
  "1": "linear-gradient(135deg, #1a1a2e, #16213e, #0f3460)",
  "2": "linear-gradient(135deg, #0d1117, #161b22, #21262d)",
  "3": "linear-gradient(135deg, #2d1b69, #11001c, #5c2d91)",
  "4": "linear-gradient(135deg, #1a1a2e, #0f0f23, #16213e)",
  "5": "linear-gradient(135deg, #0a192f, #172a45, #1f4068)",
  "6": "linear-gradient(135deg, #1b0000, #3d0000, #8b0000)",
  "7": "linear-gradient(135deg, #ffd700, #ff8c00, #ff6347)",
  "8": "linear-gradient(135deg, #0c0c1d, #1a1a3e, #2a2a5e)",
  "9": "linear-gradient(135deg, #004d40, #00695c, #00897b)",
  "10": "linear-gradient(135deg, #4a0080, #7b1fa2, #e040fb)",
};

// Badge SVG paths
const BADGE_ICONS: Record<string, string> = {
  diamond: "M12 2L2 12l10 10 10-10L12 2z",
  skull: "M12 2C8 2 4 5 4 9c0 3 2 5 3 6v3h2v-2h6v2h2v-3c1-1 3-3 3-6 0-4-4-7-8-7zm-2 11a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm4 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z",
  crown: "M12 2l3 7 7-3-3 7 3 7H2l3-7-3-7 7 3z",
  flame: "M12 23c-4 0-7-3-7-7 0-3 2-5 4-8l3-4 3 4c2 3 4 5 4 8 0 4-3 7-7 7z",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.27 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z",
  bolt: "M13 2L3 14h8l-1 8 10-12h-8l1-8z",
};

export function ItemPreview({
  type,
  rarity,
  previewCss,
  cardSeries,
  cardNumber,
  isHolographic,
  patternSeed,
  size = "md",
}: ItemPreviewProps) {
  const px = SIZES[size];
  const color = RARITY_COLORS[rarity] ?? "#888";

  if (type === "ring_style") {
    const dopplerType: DopplerType = previewCss === "gamma_doppler" ? "gamma_doppler" : "doppler";
    const doppler = patternSeed != null ? seedToPattern(patternSeed, dopplerType) : null;
    const ringGrad = previewCss ? RING_GRADIENTS[previewCss] : undefined;
    const bg = doppler?.background ?? ringGrad ?? "conic-gradient(#888, #555, #888)";
    const band = Math.max(Math.round(px * 0.14), 3);
    const maskGrad = `radial-gradient(circle at center, transparent ${px / 2 - band}px, #000 ${px / 2 - band + 0.5}px)`;
    const glowColor = doppler?.glowColor;

    return (
      <div
        className={`item-preview-ring${glowColor ? " rare-glow" : ""}`}
        style={{
          width: px,
          height: px,
          flexShrink: 0,
          position: "relative",
          ...(glowColor ? { "--ring-glow": glowColor } as React.CSSProperties : {}),
        }}
      >
        {/* Shadow underneath for 3D depth */}
        <div
          style={{
            position: "absolute",
            bottom: -2,
            left: "10%",
            width: "80%",
            height: "18%",
            borderRadius: "50%",
            background: "rgba(0,0,0,0.4)",
            filter: "blur(4px)",
            pointerEvents: "none",
          }}
        />
        {/* Ring donut shape via mask */}
        <div
          className="item-preview-ring-band"
          style={{
            width: px,
            height: px,
            borderRadius: "50%",
            background: bg,
            mask: maskGrad,
            WebkitMask: maskGrad,
          }}
        />
        {/* 3D lighting: top highlight + bottom shadow on the band */}
        <div
          className="item-preview-ring-sheen"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse 80% 35% at 40% 15%, rgba(255,255,255,0.5), transparent 55%), " +
              "radial-gradient(ellipse 60% 25% at 55% 85%, rgba(0,0,0,0.35), transparent 50%), " +
              "radial-gradient(ellipse 30% 60% at 12% 50%, rgba(255,255,255,0.12), transparent 50%), " +
              "radial-gradient(ellipse 30% 60% at 88% 50%, rgba(0,0,0,0.2), transparent 50%)",
            mask: maskGrad,
            WebkitMask: maskGrad,
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  if (type === "trading_card") {
    const art = CARD_ART[cardNumber ?? "1"] ?? CARD_ART["1"];
    return (
      <div
        className={`item-preview-card ${isHolographic ? "holo" : ""}`}
        style={{
          width: px,
          height: px * 1.4,
          background: art,
          borderColor: color,
        }}
      >
        {cardNumber && <span className="item-preview-card-number">#{cardNumber}</span>}
        {isHolographic && <div className="item-preview-card-holo-sheen" />}
      </div>
    );
  }

  if (type === "name_color") {
    return (
      <div className="item-preview-name-color" style={{ width: px, height: px }}>
        <span
          style={{
            background: previewCss ?? color,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            fontWeight: 700,
            fontSize: px * 0.5,
          }}
        >
          Aa
        </span>
      </div>
    );
  }

  if (type === "chat_badge") {
    const path = BADGE_ICONS[previewCss ?? "star"] ?? BADGE_ICONS.star;
    return (
      <div className="item-preview-badge" style={{ width: px, height: px }}>
        <svg viewBox="0 0 24 24" width={px * 0.65} height={px * 0.65}>
          <path d={path} fill={color} />
        </svg>
      </div>
    );
  }

  if (type === "profile_banner") {
    const bannerGradients: Record<string, string> = {
      sunset: "linear-gradient(135deg, #ff6b35, #f7c59f, #efefd0)",
      aurora: "linear-gradient(135deg, #00c9ff, #92fe9d, #f0f, #00c9ff)",
      cityscape: "linear-gradient(to bottom, #0f0c29, #302b63, #24243e)",
      space: "linear-gradient(135deg, #000428, #004e92)",
    };

    // Doppler banners use the pattern system
    const isDoppler = previewCss === "doppler" || previewCss === "gamma_doppler";
    let bg: string;
    let glowColor: string | undefined;
    if (isDoppler && patternSeed != null) {
      const dopplerType: DopplerType = previewCss === "gamma_doppler" ? "gamma_doppler" : "doppler";
      const pattern = seedToPattern(patternSeed, dopplerType);
      bg = pattern.background;
      glowColor = pattern.glowColor;
    } else if (isDoppler) {
      bg = RING_GRADIENTS[previewCss!] ?? bannerGradients.sunset;
    } else if (previewCss && BANNER_IMAGES[previewCss]) {
      bg = `url(${BANNER_IMAGES[previewCss]}) center/cover no-repeat`;
    } else {
      bg = bannerGradients[previewCss ?? "sunset"] ?? bannerGradients.sunset;
    }

    return (
      <div
        className={`item-preview-banner${glowColor ? " rare-glow" : ""}`}
        style={{
          width: px * 1.6,
          height: px,
          background: bg,
          borderColor: color,
          ...(glowColor ? { "--ring-glow": glowColor } as React.CSSProperties : {}),
        }}
      />
    );
  }

  if (type === "message_effect") {
    return (
      <div className="item-preview-effect" style={{ width: px, height: px }}>
        <div className="item-preview-effect-dots" style={{ color }} />
      </div>
    );
  }

  // fallback
  return (
    <div
      className="item-preview-generic"
      style={{ width: px, height: px, borderColor: color }}
    />
  );
}
