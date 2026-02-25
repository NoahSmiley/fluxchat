import twemoji from "twemoji";
import data from "@emoji-mart/data";
import type { CustomEmoji } from "@/types/shared.js";

interface EmojiSkin { native: string; }
interface EmojiEntry { skins: EmojiSkin[]; }
const _emojiData = data as unknown as { emojis: Record<string, EmojiEntry> };
const _nativeToId = new Map<string, string>();
for (const [id, entry] of Object.entries(_emojiData.emojis)) {
  _nativeToId.set(entry.skins[0].native, id);
}

export const TWEMOJI_OPTIONS = {
  folder: "svg",
  ext: ".svg",
  base: "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/",
  // Inject data-emoji-id so message hover tooltips can read the :name:
  attributes: (rawText: string) => {
    const id = _nativeToId.get(rawText);
    return id ? { "data-emoji-id": `:${id}:` } : {};
  },
};

/**
 * Returns a `:name:` label for an emoji. Custom/standard-by-id pass through;
 * native unicode chars are looked up in the reverse map.
 */
export function getEmojiLabel(emoji: string): string {
  if (emoji.startsWith(":") && emoji.endsWith(":")) return emoji;
  const id = _nativeToId.get(emoji);
  return id ? `:${id}:` : emoji;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const URL_REGEX = /https?:\/\/[^\s<]+/g;
const MENTION_REGEX = /@([a-zA-Z0-9_-]+)/g;
const EMOJI_SEQ_RE = /\p{Extended_Pictographic}(\u200D\p{Extended_Pictographic}|\uFE0F|\u20E3|[\u{1F3FB}-\u{1F3FF}])*/gu;

/**
 * Returns true if `text` consists only of emoji (standard + custom) and whitespace,
 * with at most `maxCount` total emoji (default 10).
 */
export function isEmojiOnly(text: string, customEmojis: CustomEmoji[], maxCount = 10): boolean {
  if (!text.trim()) return false;
  let customCount = 0;
  let s = text.replace(/:([a-zA-Z0-9_]+):/g, (_, name) => {
    if (customEmojis.some((e) => e.name === name)) { customCount++; return ""; }
    return `:${name}:`;
  });
  EMOJI_SEQ_RE.lastIndex = 0;
  const stdCount = (s.match(EMOJI_SEQ_RE) ?? []).length;
  s = s.replace(EMOJI_SEQ_RE, "");
  if (s.replace(/\s/g, "").length !== 0) return false;
  const total = customCount + stdCount;
  return total > 0 && total <= maxCount;
}

/**
 * Process a plain text segment: escape HTML, replace :name: custom emoji, apply Twemoji.
 */
function processPlain(text: string, customEmojis: CustomEmoji[], apiBase: string): string {
  const escaped = escapeHtml(text);
  const withCustom = escaped.replace(/:([a-zA-Z0-9_]+):/g, (match, name) => {
    const found = customEmojis.find((e) => e.name === name);
    if (!found) return match;
    const url = `${apiBase}/files/${found.attachmentId}/${found.filename}`;
    return `<img src="${url}" alt=":${name}:" class="custom-emoji" title=":${name}:" data-uploader="${escapeHtml(found.uploaderUsername)}">`;
  });
  return twemoji.parse(withCustom, TWEMOJI_OPTIONS as any);
}

/**
 * Renders message content as HTML:
 * 1. Detects URLs → clickable <a> links
 * 2. Detects @mentions → <span class="mention"> (when memberUsernames provided)
 * 3. HTML-escapes plain text (XSS protection)
 * 4. Replaces :name: with <img> for known custom emoji
 * 5. Applies Twemoji to remaining Unicode emoji in plain text
 */
export function renderMessageContent(
  text: string,
  customEmojis: CustomEmoji[],
  apiBase: string,
  memberUsernames?: Set<string>,
): string {
  if (!text) return "";

  const segments: { start: number; end: number; type: "url" | "mention"; raw: string }[] = [];

  URL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_REGEX.exec(text)) !== null) {
    segments.push({ start: m.index, end: m.index + m[0].length, type: "url", raw: m[0] });
  }

  if (memberUsernames) {
    MENTION_REGEX.lastIndex = 0;
    while ((m = MENTION_REGEX.exec(text)) !== null) {
      if (m[1] === "everyone" || m[1] === "here" || memberUsernames.has(m[1])) {
        segments.push({ start: m.index, end: m.index + m[0].length, type: "mention", raw: m[0] });
      }
    }
  }

  segments.sort((a, b) => a.start - b.start);

  let result = "";
  let lastIndex = 0;

  for (const seg of segments) {
    if (seg.start < lastIndex) continue;
    if (seg.start > lastIndex) {
      result += processPlain(text.slice(lastIndex, seg.start), customEmojis, apiBase);
    }
    if (seg.type === "url") {
      const escaped = escapeHtml(seg.raw);
      result += `<a href="${escaped}" target="_blank" rel="noopener noreferrer">${escaped}</a>`;
    } else {
      result += `<span class="mention">${escapeHtml(seg.raw)}</span>`;
    }
    lastIndex = seg.end;
  }

  if (lastIndex < text.length) {
    result += processPlain(text.slice(lastIndex), customEmojis, apiBase);
  }

  return result;
}

/**
 * Renders a single emoji value (Unicode char or ":name:" for custom) as an HTML string.
 * Safe to use with dangerouslySetInnerHTML.
 */
export function renderEmoji(
  emoji: string,
  customEmojis: CustomEmoji[],
  apiBase: string,
): string {
  if (emoji.startsWith(":") && emoji.endsWith(":")) {
    const name = emoji.slice(1, -1);
    const found = customEmojis.find((e) => e.name === name);
    if (found) {
      const url = `${apiBase}/files/${found.attachmentId}/${found.filename}`;
      return `<img src="${url}" alt="${escapeHtml(emoji)}" class="custom-emoji" title="${escapeHtml(emoji)}">`;
    }
    return escapeHtml(emoji);
  }
  return twemoji.parse(emoji, TWEMOJI_OPTIONS as any);
}
