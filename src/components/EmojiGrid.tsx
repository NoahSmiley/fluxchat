import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import type { CustomEmoji } from "../types/shared.js";
import { API_BASE } from "../lib/serverUrl.js";
import {
  emojiData,
  parseTwemoji,
  nativeToId,
  CATEGORY_NAMES,
} from "./emojiPickerData.js";

interface UploaderGroup {
  uploaderId: string;
  uploaderUsername: string;
  uploaderImage: string | null;
  emojis: CustomEmoji[];
}

interface EmojiGridProps {
  standardCats: typeof emojiData.categories;
  uploaderGroups: UploaderGroup[];
  customEmojis: CustomEmoji[];
  stdFavs: Set<string>;
  customFavIds: Set<string>;
  collapsed: Set<string>;
  hasFavs: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sectionRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onSelect: (emoji: string) => void;
  onToggleSection: (id: string) => void;
  onEmojiContextMenu: (e: React.MouseEvent, info: {
    isFav: boolean;
    type: "standard" | "custom";
    native?: string;
    emoji?: CustomEmoji;
  }) => void;
}

export function EmojiGrid({
  standardCats,
  uploaderGroups,
  customEmojis,
  stdFavs,
  customFavIds,
  collapsed,
  hasFavs,
  scrollRef,
  sectionRefs,
  onSelect,
  onToggleSection,
  onEmojiContextMenu,
}: EmojiGridProps) {
  return (
    <>
      {/* Favorites */}
      <div ref={(el) => { sectionRefs.current[0] = el; }}>
        <div className="emoji-picker-section-header" onClick={() => onToggleSection("favorites")} style={{ cursor: "pointer", userSelect: "none" }}>
          <span dangerouslySetInnerHTML={{ __html: parseTwemoji("\u2764\uFE0F") }} /> Favorites
          <ChevronDown size={10} style={{ marginLeft: "auto", transform: collapsed.has("favorites") ? "rotate(-90deg)" : undefined, transition: "transform 0.15s" }} />
        </div>
        {!collapsed.has("favorites") && (
          hasFavs ? (
            <LazySection estimatedHeight={32} scrollContainer={scrollRef}>
              <div className="emoji-picker-grid">
                {Array.from(stdFavs).map((native) => (
                  <StandardCell key={native} native={native} onSelect={onSelect} isFav={stdFavs.has(native)} onContextMenu={onEmojiContextMenu} />
                ))}
                {Array.from(customFavIds).map((id) => {
                  const emoji = customEmojis.find((e) => e.id === id);
                  if (!emoji) return null;
                  return <CustomCell key={id} emoji={emoji} onSelect={onSelect} isFav={customFavIds.has(emoji.id)} onContextMenu={onEmojiContextMenu} />;
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
          <div className="emoji-picker-section-header" onClick={() => onToggleSection(cat.id)} style={{ cursor: "pointer", userSelect: "none" }}>
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
                  return <StandardCell key={id} native={native} onSelect={onSelect} isFav={stdFavs.has(native)} onContextMenu={onEmojiContextMenu} />;
                })}
              </div>
            </LazySection>
          )}
        </div>
      ))}

      {/* Custom emoji sections by uploader */}
      {uploaderGroups.map((group, i) => (
        <div key={group.uploaderId} ref={(el) => { sectionRefs.current[1 + standardCats.length + i] = el; }}>
          <div className="emoji-picker-section-header" onClick={() => onToggleSection(group.uploaderId)} style={{ cursor: "pointer", userSelect: "none" }}>
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
                  <CustomCell key={emoji.id} emoji={emoji} onSelect={onSelect} isFav={customFavIds.has(emoji.id)} onContextMenu={onEmojiContextMenu} />
                ))}
              </div>
            </LazySection>
          )}
        </div>
      ))}
    </>
  );
}

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

function StandardCell({
  native,
  onSelect,
  isFav,
  onContextMenu,
}: {
  native: string;
  onSelect: (emoji: string) => void;
  isFav: boolean;
  onContextMenu: (e: React.MouseEvent, info: {
    isFav: boolean;
    type: "standard" | "custom";
    native?: string;
    emoji?: CustomEmoji;
  }) => void;
}) {
  const id = nativeToId.get(native);
  return (
    <button
      className="emoji-cell"
      onClick={() => onSelect(native)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, { isFav, type: "standard", native });
      }}
      title={id ? `:${id}:` : native}
    >
      <span dangerouslySetInnerHTML={{ __html: parseTwemoji(native) }} />
    </button>
  );
}

function CustomCell({
  emoji,
  onSelect,
  isFav,
  onContextMenu,
}: {
  emoji: CustomEmoji;
  onSelect: (emoji: string) => void;
  isFav: boolean;
  onContextMenu: (e: React.MouseEvent, info: {
    isFav: boolean;
    type: "standard" | "custom";
    native?: string;
    emoji?: CustomEmoji;
  }) => void;
}) {
  const url = `${API_BASE}/files/${emoji.attachmentId}/${emoji.filename}`;
  return (
    <button
      className="emoji-cell"
      onClick={() => onSelect(`:${emoji.name}:`)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, { isFav, type: "custom", emoji });
      }}
      title={`:${emoji.name}:`}
    >
      <img src={url} alt={`:${emoji.name}:`} className="custom-emoji" />
    </button>
  );
}
