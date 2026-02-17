// Generate a consistent color from a string (username or userId)
const AVATAR_COLORS = [
  "#e06c75", // soft red
  "#e5c07b", // warm yellow
  "#98c379", // green
  "#56b6c2", // cyan
  "#61afef", // blue
  "#c678dd", // purple
  "#d19a66", // orange
  "#be5046", // rust
  "#7ec8e3", // sky blue
  "#c3e88d", // lime
];

export function avatarColor(name: string | null | undefined): string {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Returns CSS class string for an avatar ring based on user preferences.
 * Falls back to role-based defaults when ringStyle is "default".
 */
export function ringClass(
  ringStyle: string | undefined,
  ringSpin: boolean | undefined,
  role?: string,
  hasActivity?: boolean,
): string {
  const style = ringStyle ?? "default";
  const spin = ringSpin ?? false;

  const classes: string[] = [];

  if (style === "default") {
    // Use existing role-based behavior
    if (role === "owner") classes.push("chroma");
    else if (hasActivity) classes.push("active");
  } else {
    classes.push(`ring-style-${style}`);
  }

  if (spin) classes.push("ring-spin-active");

  return classes.join(" ");
}
