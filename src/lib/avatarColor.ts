// Generate a consistent color from a string (username or userId)
const AVATAR_COLORS = [
  "#e06c75",
  "#e5c07b",
  "#98c379",
  "#56b6c2",
  "#61afef",
  "#c678dd",
  "#d19a66",
  "#be5046",
  "#7ec8e3",
  "#c3e88d",
];

export function avatarColor(name: string | null | undefined): string {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

import { seedToPattern, RING_GRADIENTS, type DopplerType } from "./dopplerPattern.js";
import type { CSSProperties } from "react";

/**
 * Returns CSS class string for an avatar ring based on user preferences.
 * Falls back to role-based defaults when ringStyle is "default".
 */
export function ringClass(
  ringStyle: string | undefined,
  ringSpin: boolean | undefined,
  role?: string,
  hasActivity?: boolean,
  ringPatternSeed?: number | null,
): string {
  const style = ringStyle ?? "default";
  const spin = ringSpin ?? false;

  const classes: string[] = [];

  if (ringPatternSeed != null) {
    classes.push("ring-style-doppler");
    // Check if this is a rare pattern → add glow class
    const dopplerType: DopplerType = style === "gamma_doppler" ? "gamma_doppler" : "doppler";
    const pattern = seedToPattern(ringPatternSeed, dopplerType);
    if (pattern.isRare) classes.push("ring-rare-glow");
  } else if (style === "default") {
    if (role === "owner") classes.push("chroma");
    else if (hasActivity) classes.push("active");
  } else {
    classes.push(`ring-style-${style}`);
  }

  if (spin) classes.push("ring-spin-active");

  return classes.join(" ");
}

/**
 * Returns inline style with the Doppler gradient as a CSS variable.
 * Pass the ringStyle to distinguish doppler vs gamma_doppler.
 * Also sets --ring-glow for rare patterns.
 */
export function ringGradientStyle(ringPatternSeed: number | null | undefined, ringStyle?: string): CSSProperties | undefined {
  if (ringPatternSeed == null) return undefined;
  const dopplerType: DopplerType = ringStyle === "gamma_doppler" ? "gamma_doppler" : "doppler";
  const pattern = seedToPattern(ringPatternSeed, dopplerType);
  const style: Record<string, string> = { "--ring-doppler-bg": pattern.background };
  if (pattern.glowColor) {
    style["--ring-glow"] = pattern.glowColor;
  }
  return style as unknown as CSSProperties;
}

/** Static banner gradients for non-doppler banners. */
const BANNER_GRADIENTS: Record<string, string> = {
  sunset: "linear-gradient(135deg, #ff6b35, #f7c59f, #efefd0)",
  aurora: "linear-gradient(135deg, #00c9ff, #92fe9d, #f0f, #00c9ff)",
  cityscape: "linear-gradient(to bottom, #0f0c29, #302b63, #24243e)",
  space: "linear-gradient(135deg, #000428, #004e92)",
};

/** Image-based banners: previewCss → image URL served from /banners/ */
const BANNER_IMAGES: Record<string, string> = {
  wyrm_manuscript: "/banners/wyrm_manuscript.jpg",
};

/**
 * Returns the CSS background for a user's equipped banner.
 * Returns undefined if no banner is equipped.
 */
export function bannerBackground(
  bannerCss: string | null | undefined,
  bannerPatternSeed: number | null | undefined,
): string | undefined {
  if (!bannerCss) return undefined;
  const isDoppler = bannerCss === "doppler" || bannerCss === "gamma_doppler";
  if (isDoppler && bannerPatternSeed != null) {
    const dopplerType: DopplerType = bannerCss === "gamma_doppler" ? "gamma_doppler" : "doppler";
    return seedToPattern(bannerPatternSeed, dopplerType).background;
  }
  if (isDoppler) return RING_GRADIENTS[bannerCss];
  if (BANNER_IMAGES[bannerCss]) return `url(${BANNER_IMAGES[bannerCss]}) center/cover no-repeat`;
  return BANNER_GRADIENTS[bannerCss];
}
