import { useState, useEffect, useLayoutEffect, useRef, useMemo, useDeferredValue, useCallback } from "react";
import type { CustomEmoji } from "@/types/shared.js";
import { useChatStore } from "@/stores/chat/index.js";
import { useAuthStore } from "@/stores/auth.js";
import { getEmojiFavorites, addStandardFavorite, removeStandardFavorite, addCustomFavorite, removeCustomFavorite } from "@/lib/api/index.js";
import ContextMenu from "./ContextMenu.js";
import { favCache } from "@/lib/emojiCache.js";
import { emojiData } from "./emojiPickerData.js";
import { EmojiPickerTabs } from "./EmojiPickerTabs.js";
import { EmojiSearchInput, EmojiSearchResults } from "./EmojiSearch.js";
import { EmojiGrid } from "./EmojiGrid.js";

interface EmojiPickerProps {
  serverId: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  /** "above" (default) = above trigger, right-aligned. "right" = right of trigger, fixed-positioned to escape overflow:hidden ancestors. "auto" = fixed-positioned, prefers above trigger, falls back to below if not enough room. */
  placement?: "above" | "right" | "auto";
}

export default function EmojiPicker({ serverId, onSelect, onClose, placement = "above" }: EmojiPickerProps) {
  const customEmojis = useChatStore((s) => s.customEmojis);
  const user = useAuthStore((s) => s.user);

  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const isSearchPending = search !== deferredSearch;

  const [stdFavs, setStdFavs] = useState<Set<string>>(() => favCache.data?.standard ?? new Set());
  const [customFavIds, setCustomFavIds] = useState<Set<string>>(() => favCache.data?.customIds ?? new Set());
  const [emojiCtxMenu, setEmojiCtxMenu] = useState<{
    x: number; y: number;
    isFav: boolean;
    type: "standard" | "custom";
    native?: string;
    emoji?: CustomEmoji;
  } | null>(null);
  const [activeCatIdx, setActiveCatIdx] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catNavRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // For "right" and "auto" placement: use position:fixed computed from the trigger wrapper,
  // bypassing overflow:hidden ancestors and scroll containers.
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties | undefined>(
    () => (placement === "right" || placement === "auto")
      ? { position: "fixed", top: -9999, left: -9999, opacity: 0 }
      : undefined,
  );

  useLayoutEffect(() => {
    if (placement !== "right" && placement !== "auto") return;
    const el = panelRef.current;
    if (!el) return;
    const parent = el.parentElement as HTMLElement | null;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const panelW = 320;
    const panelH = 420;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;

    let left: number;
    let top: number;

    if (placement === "right") {
      left = parentRect.right + gap;
      top = parentRect.top;
      if (left + panelW > vw - 8) left = parentRect.left - panelW - gap;
      if (left < 8) left = 8;
      if (top + panelH > vh - 8) top = Math.max(8, vh - panelH - 8);
      if (top < 8) top = 8;
    } else {
      const actualH = el.getBoundingClientRect().height || panelH;
      const spaceAbove = parentRect.top - gap;
      const spaceBelow = vh - parentRect.bottom - gap;
      if (spaceAbove >= actualH || spaceAbove >= spaceBelow) {
        top = parentRect.top - actualH - gap;
      } else {
        top = parentRect.bottom + gap;
      }
      if (top + actualH > vh - 8) top = vh - actualH - 8;
      if (top < 8) top = 8;
      left = parentRect.right - panelW;
      if (left < 8) left = 8;
      if (left + panelW > vw - 8) left = vw - panelW - 8;
    }

    setPanelStyle({ position: "fixed", left, top, bottom: "auto", right: "auto", opacity: 1 });
  }, [placement]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("emoji-picker-collapsed");
      if (stored !== null) return new Set(JSON.parse(stored));
      return new Set(emojiData.categories.map((cat) => cat.id));
    } catch { return new Set(emojiData.categories.map((cat) => cat.id)); }
  });

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      localStorage.setItem("emoji-picker-collapsed", JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  // Load favorites on mount
  useEffect(() => {
    getEmojiFavorites()
      .then((favs) => {
        const std = new Set(favs.standard);
        const cust = new Set(favs.customIds);
        favCache.data = { standard: std, customIds: cust };
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

  // Dismiss on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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
    if (user) {
      const myIdx = groups.findIndex((g) => g.uploaderId === user.id);
      if (myIdx > 0) {
        const [mine] = groups.splice(myIdx, 1);
        groups.unshift(mine);
      }
    }
    return groups;
  }, [customEmojis, user]);

  const hasFavs = stdFavs.size > 0 || customFavIds.size > 0;
  const standardCats = emojiData.categories;
  const totalSections = 1 + standardCats.length + uploaderGroups.length;

  if (sectionRefs.current.length !== totalSections) {
    sectionRefs.current = Array(totalSections).fill(null);
  }

  const scrollToSection = useCallback((idx: number) => {
    sectionRefs.current[idx]?.scrollIntoView({ block: "start", behavior: "smooth" });
    setActiveCatIdx(idx);
  }, []);

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

  const handleEmojiContextMenu = useCallback((e: React.MouseEvent, info: {
    isFav: boolean;
    type: "standard" | "custom";
    native?: string;
    emoji?: CustomEmoji;
  }) => {
    setEmojiCtxMenu({ x: e.clientX, y: e.clientY, ...info });
  }, []);

  return (
    <>
    <div
      className="emoji-picker-panel"
      ref={panelRef}
      style={panelStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search */}
      <EmojiSearchInput search={search} onSearchChange={setSearch} searchRef={searchRef} />

      {/* Category nav */}
      {search.trim().length < 2 && (
        <EmojiPickerTabs
          activeCatIdx={activeCatIdx}
          standardCats={standardCats}
          uploaderGroups={uploaderGroups}
          catNavRef={catNavRef}
          onScrollToSection={scrollToSection}
        />
      )}

      {/* Scrollable content */}
      <div className="emoji-picker-scroll" ref={scrollRef}>
        {search.trim().length >= 2 ? (
          <EmojiSearchResults
            isSearchPending={isSearchPending}
            searchResults={searchResults}
            deferredSearch={deferredSearch}
            onSelect={onSelect}
            stdFavs={stdFavs}
            customFavIds={customFavIds}
            onEmojiContextMenu={handleEmojiContextMenu}
          />
        ) : (
          <EmojiGrid
            standardCats={standardCats}
            uploaderGroups={uploaderGroups}
            customEmojis={customEmojis}
            stdFavs={stdFavs}
            customFavIds={customFavIds}
            collapsed={collapsed}
            hasFavs={hasFavs}
            scrollRef={scrollRef}
            sectionRefs={sectionRefs}
            onSelect={onSelect}
            onToggleSection={toggleSection}
            onEmojiContextMenu={handleEmojiContextMenu}
          />
        )}
      </div>
    </div>

    {emojiCtxMenu && (
      <ContextMenu
        x={emojiCtxMenu.x}
        y={emojiCtxMenu.y}
        onClose={() => setEmojiCtxMenu(null)}
        items={[{
          label: emojiCtxMenu.isFav ? "Remove from favorites" : "Add to favorites",
          onClick: async () => {
            const isFav = emojiCtxMenu.isFav;
            if (emojiCtxMenu.type === "standard") {
              const native = emojiCtxMenu.native!;
              if (isFav) await removeStandardFavorite(native);
              else await addStandardFavorite(native);
              const next = new Set(stdFavs);
              if (isFav) next.delete(native); else next.add(native);
              setStdFavs(next);
              favCache.data = { standard: next, customIds: new Set(customFavIds) };
            } else {
              const emojiId = emojiCtxMenu.emoji!.id;
              if (isFav) await removeCustomFavorite(emojiId);
              else await addCustomFavorite(emojiId);
              const next = new Set(customFavIds);
              if (isFav) next.delete(emojiId); else next.add(emojiId);
              setCustomFavIds(next);
              favCache.data = { standard: new Set(stdFavs), customIds: next };
            }
            setEmojiCtxMenu(null);
          },
        }]}
      />
    )}
    </>
  );
}
