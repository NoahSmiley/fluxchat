import { useUIStore } from "@/stores/ui.js";
import { resolveThemeColors, type ThemeColors } from "@/lib/themes.js";

const CSS_VAR_KEYS: (keyof ThemeColors)[] = [
  "--bg-primary",
  "--bg-secondary",
  "--bg-tertiary",
  "--bg-hover",
  "--bg-input",
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--accent",
  "--accent-hover",
  "--danger",
  "--border",
  "--radius",
  "--radius-lg",
];

function applyTheme() {
  const { activeTheme, customThemes } = useUIStore.getState();
  const root = document.documentElement;

  // Set data-theme attribute
  if (activeTheme.type === "preset") {
    root.setAttribute("data-theme", activeTheme.id);
  } else {
    root.setAttribute("data-theme", "custom");
  }

  const colors = resolveThemeColors(activeTheme, customThemes);

  if (colors === null) {
    // Liminal — remove all inline overrides, let :root in base.css take effect
    for (const key of CSS_VAR_KEYS) {
      root.style.removeProperty(key);
    }
    root.style.removeProperty("--bg-modifier-hover");
    root.style.removeProperty("--bg-modifier-active");
  } else {
    // Minimal or Custom — set CSS variables as inline styles
    for (const key of CSS_VAR_KEYS) {
      root.style.setProperty(key, colors[key]);
    }
    // Derive modifier colors from accent
    const accent = colors["--accent"];
    root.style.setProperty("--bg-modifier-hover", hexToRgba(accent, 0.06));
    root.style.setProperty("--bg-modifier-active", hexToRgba(accent, 0.1));
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function initThemeApplicator() {
  // Apply immediately on init
  applyTheme();
  // Subscribe to store changes
  useUIStore.subscribe(applyTheme);
}
