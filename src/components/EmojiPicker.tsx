import { useState, useEffect, useLayoutEffect, useRef, useMemo, useDeferredValue } from "react";
import { ChevronDown } from "lucide-react";
import twemoji from "twemoji";
import data from "@emoji-mart/data";
import type { CustomEmoji } from "../types/shared.js";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { getEmojiFavorites } from "../lib/api.js";
import { API_BASE } from "../lib/serverUrl.js";
import { TWEMOJI_OPTIONS } from "../lib/emoji.js";

// ── emoji-mart data types ──────────────────────────────────────────────────

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

const emojiData = data as unknown as EmojiData;

// ── Module-level caches ────────────────────────────────────────────────────

/** Memoize twemoji.parse — runs once per unique emoji char across all picker opens. */
const _twemojiCache = new Map<string, string>();
function parseTwemoji(native: string): string {
  let cached = _twemojiCache.get(native);
  if (!cached) {
    cached = twemoji.parse(native, TWEMOJI_OPTIONS);
    _twemojiCache.set(native, cached);
  }
  return cached;
}

/** Precompute category nav icon HTML once at module load (not per render). */
const catNavHtml: string[] = emojiData.categories.map((cat) => {
  const firstId = cat.emojis[0];
  const native = emojiData.emojis[firstId]?.skins[0]?.native ?? "😀";
  return parseTwemoji(native);
});

/** Reverse map: native char → emoji id, for tooltip labels. */
const _nativeToId = new Map<string, string>();
for (const [id, entry] of Object.entries(emojiData.emojis)) {
  _nativeToId.set(entry.skins[0].native, id);
}

/** Favorites cache — persists between picker opens so re-open is instant. */
let _favCache: { standard: Set<string>; customIds: Set<string> } | null = null;

/** Call this once after the user logs in to prefetch favorites into cache. */
export function prefetchEmojiFavorites(): void {
  getEmojiFavorites()
    .then((favs) => {
      _favCache = { standard: new Set(favs.standard), customIds: new Set(favs.customIds) };
    })
    .catch(() => {});
}

// ── Category display names ─────────────────────────────────────────────────

const CATEGORY_NAMES: Record<string, string> = {
  people: "Smileys & People",
  nature: "Animals & Nature",
  foods: "Food & Drink",
  activity: "Activities",
  places: "Travel & Places",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
};

// ── Props ──────────────────────────────────────────────────────────────────

interface EmojiPickerProps {
  serverId: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** "above" (default) = above trigger, right-aligned. "right" = right of trigger, fixed-positioned to escape overflow:hidden ancestors. */
  placement?: "above" | "right";
}

// ── Lazy section renderer ─────────────────────────────────────────────────

function LazySection({
  children,
  estimatedHeight,
  scrollContainer,
}: {
  children: React.ReactNode;
  estimatedHeight: number;
  scrollContainer: React.RefObject<HTMLDivElement | null>;
}) {
  const [rendered, setRendered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rendered) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setRendered(true); },
      { root: scrollContainer.current, rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rendered, scrollContainer]);
  return (
    <div ref={ref} style={rendered ? undefined : { minHeight: estimatedHeight }}>
      {rendered ? children : null}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function EmojiPicker({ serverId, onSelect, onClose, placement = "above" }: EmojiPickerProps) {
  const customEmojis = useChatStore((s) => s.customEmojis);
  const user = useAuthStore((s) => s.user);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const isSearchPending = search !== deferredSearch;

  const [stdFavs, setStdFavs] = useState<Set<string>>(() => _favCache?.standard ?? new Set());
  const [customFavIds, setCustomFavIds] = useState<Set<string>>(() => _favCache?.customIds ?? new Set());
  const [activeCatIdx, setActiveCatIdx] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catNavRef = useRef<HTMLDivElement>(null);

  // For "right" placement: use position:fixed computed from the trigger wrapper,
  // bypassing overflow:hidden ancestors. Start invisible so layout effect fires first.
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | undefined>(
    () => placement === "right" ? { opacity: 0 } : undefined,
  );

  useLayoutEffect(() => {
    if (placement !== "right") return;
    const el = panelRef.current;
    if (!el) return;
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const panelW = 320;
    const panelH = 420; // max-height
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;

    let left = parentRect.right + gap;
    let top = parentRect.top;

    // Flip to left if no room on right
    if (left + panelW > vw - 8) {
      left = parentRect.left - panelW - gap;
    }
    // Clamp horizontal
    if (left < 8) left = 8;

    // Clamp vertical
    if (top + panelH > vh - 8) top = Math.max(8, vh - panelH - 8);
    if (top < 8) top = 8;

    setPanelStyle({ position: "fixed", left, top, bottom: "auto", right: "auto", opacity: 1 });
  }, [placement]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("emoji-picker-collapsed");
      if (stored !== null) return new Set(JSON.parse(stored));
      // Default: standard categories collapsed, favorites/custom groups expanded
      return new Set(emojiData.categories.map((cat) => cat.id));
    } catch { return new Set(emojiData.categories.map((cat) => cat.id)); }
  });

  function toggleSection(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("emoji-picker-collapsed", JSON.stringify(Array.from(next)));
      return next;
    });
  }


  // One ref per section: [favorites, ...categories, ...uploaderGroups]
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load favorites on mount (uses cache for instant display; refreshes in background)
  useEffect(() => {
    getEmojiFavorites()
      .then((favs) => {
        const std = new Set(favs.standard);
        const cust = new Set(favs.customIds);
        _favCache = { standard: std, customIds: cust };
        setStdFavs(std);
        setCustomFavIds(cust);
      })
      .catch(() => {});
  }, []);

  // Focus search on open
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Dismiss on outside click
  useEffect(() => {
    const handler = () => onClose();
    const timer = setTimeout(() => document.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handler);
    };
  }, [onClose]);

  // ── Custom emoji grouping ─────────────────────────────────────────────────

  const uploaderGroups = useMemo(() => {
    if (!customEmojis.length) return [];
    const groups: { uploaderId: string; uploaderUsername: string; uploaderImage: string | null; emojis: CustomEmoji[] }[] = [];
    const seen = new Map<string, number>();
    for (const emoji of customEmojis) {
      const existing = seen.get(emoji.uploaderId);
      if (existing !== undefined) {
        groups[existing].emojis.push(emoji);
      } else {
        seen.set(emoji.uploaderId, groups.length);
        groups.push({
          uploaderId: emoji.uploaderId,
          uploaderUsername: emoji.uploaderUsername,
          uploaderImage: emoji.uploaderImage,
          emojis: [emoji],
        });
      }
    }
    // Put logged-in user's group first
    if (user) {
      const myIdx = groups.findIndex((g) => g.uploaderId === user.id);
      if (myIdx > 0) {
        const [mine] = groups.splice(myIdx, 1);
        groups.unshift(mine);
      }
    }
    return groups;
  }, [customEmojis, user]);

  // ── Category nav sections ─────────────────────────────────────────────────
  // Order: favorites | standard categories | custom uploader groups
  const hasFavs = stdFavs.size > 0 || customFavIds.size > 0;
  const standardCats = emojiData.categories;
  const totalSections = 1 + standardCats.length + uploaderGroups.length;

  // Ensure sectionRefs array is sized correctly
  if (sectionRefs.current.length !== totalSections) {
    sectionRefs.current = Array(totalSections).fill(null);
  }

  function scrollToSection(idx: number) {
    sectionRefs.current[idx]?.scrollIntoView({ block: "start", behavior: "smooth" });
    setActiveCatIdx(idx);
  }

  // ── Search results ────────────────────────────────────────────────────────

  const searchResults = useMemo(() => {
    if (deferredSearch.trim().length < 2) return null;
    const q = deferredSearch.toLowerCase();
    const customMatches = customEmojis
      .filter((e) => e.name.toLowerCase().includes(q))
      .map((e) => ({ type: "custom" as const, emoji: e }));
    const stdMatches: { type: "standard"; native: string; name: string }[] = [];
    for (const [id, entry] of Object.entries(emojiData.emojis)) {
      if (id.toLowerCase().includes(q)) {
        stdMatches.push({ type: "standard", native: entry.skins[0].native, name: entry.name });
      }
    }
    return { customMatches, stdMatches };
  }, [deferredSearch, customEmojis]);

  // ── Emoji cell renderers ──────────────────────────────────────────────────

  function StandardCell({ native }: { native: string }) {
    const id = _nativeToId.get(native);
    return (
      <button className="emoji-cell" onClick={() => onSelect(native)} title={id ? `:${id}:` : native}>
        <span dangerouslySetInnerHTML={{ __html: parseTwemoji(native) }} />
      </button>
    );
  }

  function CustomCell({ emoji }: { emoji: CustomEmoji }) {
    const url = `${API_BASE}/files/${emoji.attachmentId}/${emoji.filename}`;
    return (
      <button className="emoji-cell" onClick={() => onSelect(`:${emoji.name}:`)} title={`:${emoji.name}:`}>
        <img src={url} alt={`:${emoji.name}:`} className="custom-emoji" />
      </button>
    );
  }

  // ── Category nav icon (precomputed HTML, no per-render parsing) ───────────

  function CatNavIcon({ idx }: { idx: number }) {
    return <span dangerouslySetInnerHTML={{ __html: catNavHtml[idx] }} />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="emoji-picker-panel"
      ref={panelRef}
      style={panelStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search */}
      <div className="emoji-picker-search">
        <input
          ref={searchRef}
          className="emoji-picker-search-input"
          placeholder="Search emoji..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Category nav */}
      {search.trim().length < 2 && (
        <div
          className="emoji-picker-category-nav"
          ref={catNavRef}
          onWheel={(e) => {
            if (catNavRef.current) {
              e.preventDefault();
              catNavRef.current.scrollLeft += e.deltaY;
            }
          }}
        >
          {/* Favorites icon */}
          <button
            className={`emoji-category-nav-btn${activeCatIdx === 0 ? " active" : ""}`}
            onClick={() => scrollToSection(0)}
            title="Favorites"
          >
            <span dangerouslySetInnerHTML={{ __html: parseTwemoji("❤️") }} />
          </button>
          {/* Standard category icons */}
          {standardCats.map((cat, i) => (
            <button
              key={cat.id}
              className={`emoji-category-nav-btn${activeCatIdx === i + 1 ? " active" : ""}`}
              onClick={() => scrollToSection(i + 1)}
              title={CATEGORY_NAMES[cat.id] ?? cat.id}
            >
              <CatNavIcon idx={i} />
            </button>
          ))}
          {/* Custom uploader group icons */}
          {uploaderGroups.map((g, i) => (
            <button
              key={g.uploaderId}
              className={`emoji-category-nav-btn${activeCatIdx === 1 + standardCats.length + i ? " active" : ""}`}
              onClick={() => scrollToSection(1 + standardCats.length + i)}
              title={g.uploaderUsername}
            >
              {g.uploaderImage ? (
                <img src={g.uploaderImage} alt={g.uploaderUsername} />
              ) : (
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                  {g.uploaderUsername.slice(0, 2).toUpperCase()}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Scrollable content */}
      <div className="emoji-picker-scroll" ref={scrollRef}>
        {search.trim().length >= 2 ? (
          isSearchPending ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "24px 0" }}>
              <div className="loading-spinner" style={{ width: 20, height: 20 }} />
            </div>
          ) : (
            /* ── Search results ── */
            <div>
              {searchResults!.customMatches.length > 0 && (
                <>
                  <div className="emoji-picker-section-header">Custom Emoji</div>
                  <div className="emoji-picker-grid">
                    {searchResults!.customMatches.map(({ emoji }) => (
                      <CustomCell key={emoji.id} emoji={emoji} />
                    ))}
                  </div>
                </>
              )}
              {searchResults!.stdMatches.length > 0 && (
                <>
                  <div className="emoji-picker-section-header">Standard Emoji</div>
                  <div className="emoji-picker-grid">
                    {searchResults!.stdMatches.map(({ native }) => (
                      <StandardCell key={native} native={native} />
                    ))}
                  </div>
                </>
              )}
              {searchResults!.customMatches.length === 0 && searchResults!.stdMatches.length === 0 && (
                <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  No results for "{deferredSearch}"
                </div>
              )}
            </div>
          )
        ) : (
          /* ── Sections ── */
          <>
            {/* Favorites */}
            <div ref={(el) => { sectionRefs.current[0] = el; }}>
              <div className="emoji-picker-section-header" onClick={() => toggleSection("favorites")} style={{ cursor: "pointer", userSelect: "none" }}>
                <span dangerouslySetInnerHTML={{ __html: parseTwemoji("❤️") }} /> Favorites
                <ChevronDown size={10} style={{ marginLeft: "auto", transform: collapsed.has("favorites") ? "rotate(-90deg)" : undefined, transition: "transform 0.15s" }} />
              </div>
              {!collapsed.has("favorites") && (
                hasFavs ? (
                  <LazySection estimatedHeight={32} scrollContainer={scrollRef}>
                    <div className="emoji-picker-grid">
                      {Array.from(stdFavs).map((native) => (
                        <StandardCell key={native} native={native} />
                      ))}
                      {Array.from(customFavIds).map((id) => {
                        const emoji = customEmojis.find((e) => e.id === id);
                        if (!emoji) return null;
                        return <CustomCell key={id} emoji={emoji} />;
                      })}
                    </div>
                  </LazySection>
                ) : (
                  <div style={{ padding: "8px 12px", color: "var(--text-muted)", fontSize: 12 }}>
                    No favorites yet
                  </div>
                )
              )}
            </div>

            {/* Standard emoji categories */}
            {standardCats.map((cat, i) => (
              <div key={cat.id} ref={(el) => { sectionRefs.current[i + 1] = el; }}>
                <div className="emoji-picker-section-header" onClick={() => toggleSection(cat.id)} style={{ cursor: "pointer", userSelect: "none" }}>
                  {CATEGORY_NAMES[cat.id] ?? cat.id}
                  <ChevronDown size={10} style={{ marginLeft: "auto", transform: collapsed.has(cat.id) ? "rotate(-90deg)" : undefined, transition: "transform 0.15s" }} />
                </div>
                {!collapsed.has(cat.id) && (
                  <LazySection estimatedHeight={Math.ceil(cat.emojis.length / 10) * 32} scrollContainer={scrollRef}>
                    <div className="emoji-picker-grid">
                      {cat.emojis.map((id) => {
                        const entry = emojiData.emojis[id];
                        if (!entry) return null;
                        const native = entry.skins[0].native;
                        return <StandardCell key={id} native={native} />;
                      })}
                    </div>
                  </LazySection>
                )}
              </div>
            ))}

            {/* Custom emoji sections by uploader */}
            {uploaderGroups.map((group, i) => (
              <div key={group.uploaderId} ref={(el) => { sectionRefs.current[1 + standardCats.length + i] = el; }}>
                <div className="emoji-picker-section-header" onClick={() => toggleSection(group.uploaderId)} style={{ cursor: "pointer", userSelect: "none" }}>
                  {group.uploaderImage ? (
                    <img src={group.uploaderImage} alt={group.uploaderUsername} />
                  ) : null}
                  {group.uploaderUsername}
                  <ChevronDown size={10} style={{ marginLeft: "auto", transform: collapsed.has(group.uploaderId) ? "rotate(-90deg)" : undefined, transition: "transform 0.15s" }} />
                </div>
                {!collapsed.has(group.uploaderId) && (
                  <LazySection estimatedHeight={Math.ceil(group.emojis.length / 10) * 32} scrollContainer={scrollRef}>
                    <div className="emoji-picker-grid">
                      {group.emojis.map((emoji) => (
                        <CustomCell key={emoji.id} emoji={emoji} />
                      ))}
                    </div>
                  </LazySection>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
