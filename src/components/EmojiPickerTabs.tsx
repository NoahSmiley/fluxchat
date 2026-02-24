import { parseTwemoji, catNavHtml, CATEGORY_NAMES, emojiData } from "./emojiPickerData.js";

interface UploaderGroup {
  uploaderId: string;
  uploaderUsername: string;
  uploaderImage: string | null;
}

interface EmojiPickerTabsProps {
  activeCatIdx: number;
  standardCats: typeof emojiData.categories;
  uploaderGroups: UploaderGroup[];
  catNavRef: React.RefObject<HTMLDivElement | null>;
  onScrollToSection: (idx: number) => void;
}

export function EmojiPickerTabs({
  activeCatIdx,
  standardCats,
  uploaderGroups,
  catNavRef,
  onScrollToSection,
}: EmojiPickerTabsProps) {
  return (
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
        onClick={() => onScrollToSection(0)}
        title="Favorites"
      >
        <span dangerouslySetInnerHTML={{ __html: parseTwemoji("\u2764\uFE0F") }} />
      </button>
      {/* Standard category icons */}
      {standardCats.map((cat, i) => (
        <button
          key={cat.id}
          className={`emoji-category-nav-btn${activeCatIdx === i + 1 ? " active" : ""}`}
          onClick={() => onScrollToSection(i + 1)}
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
          onClick={() => onScrollToSection(1 + standardCats.length + i)}
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
  );
}

function CatNavIcon({ idx }: { idx: number }) {
  return <span dangerouslySetInnerHTML={{ __html: catNavHtml[idx] }} />;
}
