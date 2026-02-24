import type { CustomEmoji } from "../types/shared.js";
import { parseTwemoji, nativeToId } from "./emojiPickerData.js";
import { API_BASE } from "../lib/serverUrl.js";

interface SearchResults {
  customMatches: { type: "custom"; emoji: CustomEmoji }[];
  stdMatches: { type: "standard"; native: string; name: string }[];
}

interface EmojiSearchInputProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

export function EmojiSearchInput({ search, onSearchChange, searchRef }: EmojiSearchInputProps) {
  return (
    <div className="emoji-picker-search">
      <input
        ref={searchRef}
        className="emoji-picker-search-input"
        placeholder="Search emoji..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </div>
  );
}

interface EmojiSearchResultsProps {
  isSearchPending: boolean;
  searchResults: SearchResults | null;
  deferredSearch: string;
  onSelect: (emoji: string) => void;
  stdFavs: Set<string>;
  customFavIds: Set<string>;
  onEmojiContextMenu: (e: React.MouseEvent, info: {
    isFav: boolean;
    type: "standard" | "custom";
    native?: string;
    emoji?: CustomEmoji;
  }) => void;
}

export function EmojiSearchResults({
  isSearchPending,
  searchResults,
  deferredSearch,
  onSelect,
  stdFavs,
  customFavIds,
  onEmojiContextMenu,
}: EmojiSearchResultsProps) {
  if (isSearchPending) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "24px 0" }}>
        <div className="loading-spinner" style={{ width: 20, height: 20 }} />
      </div>
    );
  }

  if (!searchResults) return null;

  return (
    <div>
      {searchResults.customMatches.length > 0 && (
        <>
          <div className="emoji-picker-section-header">Custom Emoji</div>
          <div className="emoji-picker-grid">
            {searchResults.customMatches.map(({ emoji }) => (
              <SearchCustomCell
                key={emoji.id}
                emoji={emoji}
                onSelect={onSelect}
                isFav={customFavIds.has(emoji.id)}
                onContextMenu={onEmojiContextMenu}
              />
            ))}
          </div>
        </>
      )}
      {searchResults.stdMatches.length > 0 && (
        <>
          <div className="emoji-picker-section-header">Standard Emoji</div>
          <div className="emoji-picker-grid">
            {searchResults.stdMatches.map(({ native }) => (
              <SearchStandardCell
                key={native}
                native={native}
                onSelect={onSelect}
                isFav={stdFavs.has(native)}
                onContextMenu={onEmojiContextMenu}
              />
            ))}
          </div>
        </>
      )}
      {searchResults.customMatches.length === 0 && searchResults.stdMatches.length === 0 && (
        <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
          No results for "{deferredSearch}"
        </div>
      )}
    </div>
  );
}

function SearchStandardCell({
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

function SearchCustomCell({
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
