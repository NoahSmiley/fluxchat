/** Deterministic Doppler pattern from a seed (0-999).
 *
 *  Two ring types:
 *    - Doppler: purple / deep blue / red metallic.  Specials: Ruby, Sapphire
 *    - Gamma Doppler: green / cyan / blue metallic.  Specials: Emerald, Diamond
 *
 *  The ring TYPE is stored in the catalog item (`doppler` or `gamma_doppler`).
 *  The seed determines the exact color mix and whether it's a rare special pattern.
 */

export type DopplerType = "doppler" | "gamma_doppler";

interface DopplerPattern {
  background: string;
  isRare: boolean;
  patternName: string;
  /** Neon glow color for rare patterns (used on avatar rings + inventory previews). */
  glowColor?: string;
}

function hash(seed: number): number {
  let h = seed * 2654435761;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return (h >>> 16) ^ h;
}

function val(seed: number, offset: number, min: number, max: number): number {
  const raw = ((hash(seed + offset * 1000) & 0xffff) / 0xffff);
  return min + raw * (max - min);
}

const DOPPLER_HUE_RANGES = [
  [260, 310],  // purple
  [210, 260],  // deep blue
  [330, 390],  // red (wraps around 360 → normalize later)
] as const;

function dopplerHue(seed: number, offset: number): number {
  const rangeIdx = Math.floor(val(seed, offset + 10, 0, 3)) % 3;
  const [lo, hi] = DOPPLER_HUE_RANGES[rangeIdx];
  const h = val(seed, offset, lo, hi);
  return h >= 360 ? h - 360 : h;
}

/** Check if all three hues fall in a narrow red band → Ruby */
function isRuby(h1: number, h2: number, h3: number): boolean {
  return [h1, h2, h3].every(h => h <= 25 || h >= 340);
}

/** Check if all three hues fall in a narrow blue band → Sapphire */
function isSapphire(h1: number, h2: number, h3: number): boolean {
  return [h1, h2, h3].every(h => h >= 210 && h <= 250);
}

function seedToDoppler(seed: number): DopplerPattern {
  const h1 = dopplerHue(seed, 0);
  const h2 = dopplerHue(seed, 1);
  const h3 = dopplerHue(seed, 2);
  const angle = val(seed, 3, 0, 360);

  if (isRuby(h1, h2, h3)) return RARE_PATTERNS.ruby;
  if (isSapphire(h1, h2, h3)) return RARE_PATTERNS.sapphire;

  return {
    background: buildGradient([h1, h2, h3], angle),
    isRare: false,
    patternName: "Doppler",
  };
}

const GAMMA_HUE_RANGES = [
  [100, 155],  // green
  [155, 200],  // cyan
  [200, 230],  // blue
] as const;

function gammaHue(seed: number, offset: number): number {
  const rangeIdx = Math.floor(val(seed, offset + 10, 0, 3)) % 3;
  const [lo, hi] = GAMMA_HUE_RANGES[rangeIdx];
  return val(seed, offset, lo, hi);
}

/** Check if all three hues fall in a tight green band → Emerald */
function isEmerald(h1: number, h2: number, h3: number): boolean {
  return [h1, h2, h3].every(h => h >= 110 && h <= 155);
}

/** Diamond: all hues in a very narrow cyan-white band */
function isDiamond(h1: number, h2: number, h3: number): boolean {
  return [h1, h2, h3].every(h => h >= 175 && h <= 200);
}

function seedToGammaDoppler(seed: number): DopplerPattern {
  const h1 = gammaHue(seed, 0);
  const h2 = gammaHue(seed, 1);
  const h3 = gammaHue(seed, 2);
  const angle = val(seed, 3, 0, 360);

  if (isEmerald(h1, h2, h3)) return RARE_PATTERNS.emerald;
  if (isDiamond(h1, h2, h3)) return RARE_PATTERNS.diamond;

  return {
    background: buildGradient([h1, h2, h3], angle),
    isRare: false,
    patternName: "Gamma Doppler",
  };
}

function buildGradient(hues: number[], angle: number): string {
  const [h1, h2, h3] = hues;
  const light1 = `hsl(${h1}, 85%, 55%)`;
  const mid1   = `hsl(${h1}, 80%, 30%)`;
  const light2 = `hsl(${h2}, 85%, 50%)`;
  const mid2   = `hsl(${h2}, 75%, 25%)`;
  const accent  = `hsl(${h3}, 90%, 45%)`;
  return `linear-gradient(${angle}deg, ${mid1} 0%, ${light1} 18%, ${mid2} 35%, ${light2} 52%, ${accent} 70%, ${mid1} 88%, ${light1} 100%)`;
}

const RARE_PATTERNS: Record<string, DopplerPattern> = {
  ruby: {
    background: "linear-gradient(135deg, hsl(0, 80%, 12%) 0%, hsl(355, 90%, 28%) 15%, hsl(350, 95%, 45%) 30%, hsl(0, 85%, 55%) 45%, hsl(5, 95%, 48%) 55%, hsl(355, 88%, 32%) 70%, hsl(350, 90%, 25%) 85%, hsl(0, 80%, 12%) 100%)",
    isRare: true,
    patternName: "Ruby",
    glowColor: "rgba(255, 40, 40, 0.5)",
  },
  sapphire: {
    background: "linear-gradient(135deg, hsl(225, 80%, 12%) 0%, hsl(220, 90%, 28%) 15%, hsl(215, 95%, 48%) 30%, hsl(225, 85%, 58%) 45%, hsl(230, 95%, 50%) 55%, hsl(220, 88%, 35%) 70%, hsl(215, 90%, 25%) 85%, hsl(225, 80%, 12%) 100%)",
    isRare: true,
    patternName: "Sapphire",
    glowColor: "rgba(60, 100, 255, 0.5)",
  },
  emerald: {
    background: "linear-gradient(135deg, hsl(140, 80%, 10%) 0%, hsl(145, 90%, 22%) 15%, hsl(150, 90%, 38%) 30%, hsl(140, 85%, 50%) 45%, hsl(135, 95%, 42%) 55%, hsl(145, 88%, 28%) 70%, hsl(150, 90%, 20%) 85%, hsl(140, 80%, 10%) 100%)",
    isRare: true,
    patternName: "Emerald",
    glowColor: "rgba(40, 220, 100, 0.5)",
  },
  diamond: {
    background: "linear-gradient(135deg, hsl(185, 90%, 18%) 0%, hsl(182, 95%, 32%) 15%, hsl(180, 100%, 45%) 30%, hsl(185, 95%, 52%) 45%, hsl(188, 100%, 48%) 55%, hsl(182, 90%, 35%) 70%, hsl(180, 95%, 25%) 85%, hsl(185, 90%, 18%) 100%)",
    isRare: true,
    patternName: "Diamond",
    glowColor: "rgba(0, 220, 240, 0.5)",
  },
};

/** Resolve a seed into a pattern, given the ring type (doppler or gamma_doppler). */
export function seedToPattern(seed: number, type: DopplerType = "doppler"): DopplerPattern {
  return type === "gamma_doppler" ? seedToGammaDoppler(seed) : seedToDoppler(seed);
}

/** Ring style gradients — base catalog gradients (used when no pattern seed). */
export const RING_GRADIENTS: Record<string, string> = {
  doppler: "conic-gradient(#8000ff, #0040ff, #ff0040, #8000ff)",
  gamma_doppler: "conic-gradient(#00ff88, #00ccff, #0066ff, #00ff88)",
};
