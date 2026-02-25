import twemoji from "twemoji";
import data from "@emoji-mart/data";
import { TWEMOJI_OPTIONS } from "@/lib/emoji.js";

interface EmojiSkin {
  native: string;
}
interface EmojiEntry {
  id: string;
  name: string;
  keywords?: string[];
  skins: EmojiSkin[];
}
interface EmojiCategory {
  id: string;
  emojis: string[];
}
interface EmojiData {
  categories: EmojiCategory[];
  emojis: Record<string, EmojiEntry>;
}

export const emojiData = data as unknown as EmojiData;

/** Memoize twemoji.parse -- runs once per unique emoji char across all picker opens. */
const _twemojiCache = new Map<string, string>();
export function parseTwemoji(native: string): string {
  let cached = _twemojiCache.get(native);
  if (!cached) {
    cached = twemoji.parse(native, TWEMOJI_OPTIONS);
    _twemojiCache.set(native, cached);
  }
  return cached;
}

/** Precompute category nav icon HTML once at module load (not per render). */
export const catNavHtml: string[] = emojiData.categories.map((cat) => {
  const firstId = cat.emojis[0];
  const native = emojiData.emojis[firstId]?.skins[0]?.native ?? "\u{1F600}";
  return parseTwemoji(native);
});

/** Reverse map: native char -> emoji id, for tooltip labels. */
export const nativeToId = new Map<string, string>();
for (const [id, entry] of Object.entries(emojiData.emojis)) {
  nativeToId.set(entry.skins[0].native, id);
}

export const CATEGORY_NAMES: Record<string, string> = {
  people: "Smileys & People",
  nature: "Animals & Nature",
  foods: "Food & Drink",
  activity: "Activities",
  places: "Travel & Places",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
};
