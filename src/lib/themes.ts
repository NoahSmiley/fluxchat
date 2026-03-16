export interface ThemeColors {
  "--bg-primary": string;
  "--bg-secondary": string;
  "--bg-tertiary": string;
  "--bg-hover": string;
  "--bg-input": string;
  "--text-primary": string;
  "--text-secondary": string;
  "--text-muted": string;
  "--accent": string;
  "--accent-hover": string;
  "--danger": string;
  "--border": string;
  "--radius": string;
  "--radius-lg": string;
}

export interface PresetTheme {
  type: "preset";
  id: "liminal" | "minimal";
  name: string;
  colors: ThemeColors;
}

export interface CustomTheme {
  type: "custom";
  id: string;
  name: string;
  colors: ThemeColors;
}

export type ActiveTheme =
  | { type: "preset"; id: "liminal" | "minimal" }
  | { type: "custom"; id: string };

export const LIMINAL_THEME: PresetTheme = {
  type: "preset",
  id: "liminal",
  name: "Liminal",
  colors: {
    "--bg-primary": "#050507",
    "--bg-secondary": "#0a0a0d",
    "--bg-tertiary": "#0c0c10",
    "--bg-hover": "#141418",
    "--bg-input": "#0e0e12",
    "--text-primary": "#e4e4e7",
    "--text-secondary": "#71717a",
    "--text-muted": "#52525b",
    "--accent": "#22d3ee",
    "--accent-hover": "#06b6d4",
    "--danger": "#ff4444",
    "--border": "#1a1a1f",
    "--radius": "12px",
    "--radius-lg": "18px",
  },
};

export const MINIMAL_THEME: PresetTheme = {
  type: "preset",
  id: "minimal",
  name: "Minimal",
  colors: {
    "--bg-primary": "#000000",
    "--bg-secondary": "#000000",
    "--bg-tertiary": "#0a0a0a",
    "--bg-hover": "#0f0f0f",
    "--bg-input": "#050505",
    "--text-primary": "#f5f5f5",
    "--text-secondary": "#777777",
    "--text-muted": "#444444",
    "--accent": "#ffffff",
    "--accent-hover": "#cccccc",
    "--danger": "#ff4444",
    "--border": "#0f0f0f",
    "--radius": "2px",
    "--radius-lg": "4px",
  },
};

export const PRESET_THEMES: PresetTheme[] = [LIMINAL_THEME, MINIMAL_THEME];

export const THEME_COLOR_LABELS: Record<keyof ThemeColors, string> = {
  "--bg-primary": "Background",
  "--bg-secondary": "Surface",
  "--bg-tertiary": "Surface Alt",
  "--bg-hover": "Hover",
  "--bg-input": "Input",
  "--text-primary": "Text",
  "--text-secondary": "Text Secondary",
  "--text-muted": "Text Muted",
  "--accent": "Accent",
  "--accent-hover": "Accent Hover",
  "--danger": "Danger",
  "--border": "Border",
  "--radius": "Radius",
  "--radius-lg": "Radius Large",
};

export function resolveThemeColors(
  activeTheme: ActiveTheme,
  customThemes: CustomTheme[],
): ThemeColors | null {
  if (activeTheme.type === "preset") {
    if (activeTheme.id === "liminal") return null; // use CSS :root defaults
    if (activeTheme.id === "minimal") return MINIMAL_THEME.colors;
  }
  const custom = customThemes.find((t) => t.id === activeTheme.id);
  return custom ? custom.colors : null;
}
