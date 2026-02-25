/** Escape special regex characters in a string */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Word-boundary @everyone mention */
export const EVERYONE_MENTION_RE = /(?<![a-zA-Z0-9_])@everyone(?![a-zA-Z0-9_])/i;

/** Word-boundary @here mention */
export const HERE_MENTION_RE = /(?<![a-zA-Z0-9_])@here(?![a-zA-Z0-9_])/i;

/** Returns true if `content` contains an @mention directed at `username` (@everyone, @here, or @username). */
export function isUserMentioned(content: string, username: string): boolean {
  if (EVERYONE_MENTION_RE.test(content)) return true;
  if (HERE_MENTION_RE.test(content)) return true;
  const escaped = escapeRegex(username);
  return new RegExp(`(?<![a-zA-Z0-9_])@${escaped}(?![a-zA-Z0-9_])`, "i").test(content);
}
