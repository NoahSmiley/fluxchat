import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../../stores/chat/index.js";
import { SearchFilterTag } from "./SearchFilterTag.js";
import { SearchFilterDropdown, isDateMode, type DropdownMode, type SearchFilterDropdownHandle } from "./SearchFilterDropdown.js";

interface AppliedFilter {
  fromUser: { id: string; username: string; image: string | null } | null;
  inChannel: { id: string; name: string } | null;
  hasType: string | null;
  mentionsUser: { id: string; username: string; image: string | null } | null;
}

const KEYWORD_REGEX = /(from|in|has|mentions|before|on|after):(\S*)$/i;

export function SearchBar() {
  const {
    members, channels, userStatuses,
    searchResults, searchFilters,
    searchMessages, searchUserActivity, clearSearch,
  } = useChatStore(useShallow((s) => ({
    members: s.members, channels: s.channels, userStatuses: s.userStatuses,
    searchResults: s.searchResults, searchFilters: s.searchFilters,
    searchMessages: s.searchMessages, searchUserActivity: s.searchUserActivity, clearSearch: s.clearSearch,
  })));

  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownMode, setDropdownMode] = useState<DropdownMode>("main");
  const [filterSubquery, setFilterSubquery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const [fromUser, setFromUser] = useState<AppliedFilter["fromUser"]>(null);
  const [inChannel, setInChannel] = useState<AppliedFilter["inChannel"]>(null);
  const [hasType, setHasType] = useState<string | null>(null);
  const [mentionsUser, setMentionsUser] = useState<AppliedFilter["mentionsUser"]>(null);
  const [beforeDate, setBeforeDate] = useState<string | null>(null);
  const [onDate, setOnDate] = useState<string | null>(null);
  const [afterDate, setAfterDate] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<SearchFilterDropdownHandle>(null);

  // Reset local state when search is cleared externally (channel switch etc.)
  useEffect(() => {
    if (
      searchResults === null &&
      !searchFilters.fromUserId && !searchFilters.inChannelId &&
      !searchFilters.has && !searchFilters.mentionsUserId &&
      !searchFilters.before && !searchFilters.on && !searchFilters.after
    ) {
      setFromUser(null);
      setInChannel(null);
      setHasType(null);
      setMentionsUser(null);
      setBeforeDate(null);
      setOnDate(null);
      setAfterDate(null);
      setInputValue("");
    }
  }, [searchResults, searchFilters]);

  // Text channels only for in: filter
  const textChannels = useMemo(
    () => channels.filter((c) => c.type === "text"),
    [channels]
  );

  function handleInputChange(value: string) {
    setInputValue(value);
    const match = value.match(KEYWORD_REGEX);
    if (match) {
      const kw = match[1].toLowerCase() as DropdownMode;
      setDropdownMode(kw);
      setFilterSubquery(match[2]);
      setSelectedIndex(-1);
      setIsOpen(true);
    } else {
      setDropdownMode("main");
      setFilterSubquery("");
      setSelectedIndex(-1);
    }
  }

  function stripKeywordFromInput(keyword: string) {
    return inputValue.replace(new RegExp(`(^|\\s)${keyword}:\\S*$`, "i"), "$1").trim();
  }

  function resetDropdownAfterSelect(keyword: string) {
    setInputValue(stripKeywordFromInput(keyword));
    setDropdownMode("main");
    setFilterSubquery("");
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }

  function selectFrom(member: { userId: string; username: string; image: string | null }) {
    setFromUser({ id: member.userId, username: member.username, image: member.image });
    resetDropdownAfterSelect("from");
  }

  function selectIn(channel: { id: string; name: string }) {
    setInChannel({ id: channel.id, name: channel.name });
    resetDropdownAfterSelect("in");
  }

  function selectHas(value: string) {
    setHasType(value);
    resetDropdownAfterSelect("has");
  }

  function selectMentions(member: { userId: string; username: string; image: string | null }) {
    setMentionsUser({ id: member.userId, username: member.username, image: member.image });
    resetDropdownAfterSelect("mentions");
  }

  function applyDate(dateStr: string) {
    if (dropdownMode === "before") setBeforeDate(dateStr);
    else if (dropdownMode === "on") setOnDate(dateStr);
    else if (dropdownMode === "after") setAfterDate(dateStr);
    resetDropdownAfterSelect(dropdownMode);
  }

  function selectMainOption(mode: DropdownMode) {
    setDropdownMode(mode);
    setFilterSubquery("");
    setSelectedIndex(-1);
    const kw = mode + ":";
    if (!inputValue.endsWith(kw)) {
      setInputValue((v) => (v ? v + " " + kw : kw));
    }
    inputRef.current?.focus();
  }

  function handleSubmit() {
    // username or @username -> search for messages from that user + messages containing their name
    const trimmed = inputValue.trim();
    if (!trimmed.match(KEYWORD_REGEX)) {
      const uname = trimmed.replace(/^@/, "").toLowerCase();
      if (uname) {
        const match = members.find((m) => m.username.toLowerCase() === uname);
        if (match) {
          searchUserActivity(match.userId, match.username);
          setInputValue("");
          setIsOpen(false);
          return;
        }
      }
    }

    const hasAnyFilter = !!(fromUser || inChannel || hasType || mentionsUser || beforeDate || onDate || afterDate);
    const hasText = !!inputValue.trim() && !inputValue.match(KEYWORD_REGEX);
    if (!hasText && !hasAnyFilter) return;
    setIsOpen(false);
    searchMessages(hasText ? inputValue.trim() : "", {
      fromUserId: fromUser?.id,
      fromUsername: fromUser?.username,
      inChannelId: inChannel?.id,
      inChannelName: inChannel?.name,
      has: hasType ?? undefined,
      mentionsUserId: mentionsUser?.id,
      mentionsUsername: mentionsUser?.username,
      before: beforeDate ?? undefined,
      on: onDate ?? undefined,
      after: afterDate ?? undefined,
    });
  }

  function handleClear() {
    clearSearch();
    setFromUser(null); setInChannel(null); setHasType(null); setMentionsUser(null);
    setBeforeDate(null); setOnDate(null); setAfterDate(null);
    setInputValue(""); setIsOpen(false); inputRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
      return;
    }
    const itemCount = dropdownRef.current?.getItemCount() ?? 0;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, itemCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isDateMode(dropdownMode)) {
        dropdownRef.current?.executeItem(0);
      } else if (selectedIndex >= 0) {
        dropdownRef.current?.executeItem(selectedIndex);
      } else {
        setIsOpen(false);
        handleSubmit();
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  const anyTagActive = !!(fromUser || inChannel || hasType || mentionsUser || beforeDate || onDate || afterDate);

  return (
    <div className="search-bar" ref={containerRef}>
      <div
        className="search-bar-inner"
        onClick={() => { setIsOpen(true); inputRef.current?.focus(); }}
      >
        {/* Active filter tags */}
        {fromUser && (
          <SearchFilterTag label="from" value={fromUser.username} onRemove={() => setFromUser(null)} />
        )}
        {inChannel && (
          <SearchFilterTag label="in" value={`#${inChannel.name}`} onRemove={() => setInChannel(null)} />
        )}
        {hasType && (
          <SearchFilterTag label="has" value={hasType} onRemove={() => setHasType(null)} />
        )}
        {mentionsUser && (
          <SearchFilterTag label="mentions" value={mentionsUser.username} onRemove={() => setMentionsUser(null)} />
        )}
        {beforeDate && (
          <SearchFilterTag label="before" value={beforeDate} onRemove={() => setBeforeDate(null)} />
        )}
        {onDate && (
          <SearchFilterTag label="on" value={onDate} onRemove={() => setOnDate(null)} />
        )}
        {afterDate && (
          <SearchFilterTag label="after" value={afterDate} onRemove={() => setAfterDate(null)} />
        )}

        <input
          ref={inputRef}
          type="text"
          placeholder="Search..."
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onBlur={(e) => {
            if (!containerRef.current?.contains(e.relatedTarget as Node)) {
              setTimeout(() => setIsOpen(false), 150);
            }
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Search / Clear button */}
      {searchResults !== null ? (
        <button type="button" className="search-bar-action-btn" onClick={handleClear} title="Clear search">
          <X size={13} />
        </button>
      ) : (
        <button
          type="button"
          className="search-bar-action-btn"
          onClick={handleSubmit}
          title="Search"
          disabled={!anyTagActive && !inputValue.trim()}
        >
          <Search size={13} />
        </button>
      )}

      {/* Filter dropdown */}
      {isOpen && (
        <SearchFilterDropdown
          ref={dropdownRef}
          dropdownMode={dropdownMode}
          selectedIndex={selectedIndex}
          filterSubquery={filterSubquery}
          members={members}
          textChannels={textChannels}
          userStatuses={userStatuses}
          fromUser={fromUser}
          inChannel={inChannel}
          hasType={hasType}
          mentionsUser={mentionsUser}
          beforeDate={beforeDate}
          onDate={onDate}
          afterDate={afterDate}
          onSelectMainOption={selectMainOption}
          onSelectFrom={selectFrom}
          onSelectIn={selectIn}
          onSelectHas={selectHas}
          onSelectMentions={selectMentions}
          onApplyDate={applyDate}
        />
      )}

    </div>
  );
}
