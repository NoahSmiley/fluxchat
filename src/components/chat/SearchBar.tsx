import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { Search, User, Hash, Paperclip, AtSign, X, Image, Video, Link, Volume2, FileText, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../../stores/chat.js";
import { avatarColor } from "../../lib/avatarColor.js";

type DropdownMode = "main" | "from" | "in" | "has" | "mentions" | "before" | "on" | "after";

interface AppliedFilter {
  fromUser: { id: string; username: string; image: string | null } | null;
  inChannel: { id: string; name: string } | null;
  hasType: string | null;
  mentionsUser: { id: string; username: string; image: string | null } | null;
}

const HAS_OPTIONS = [
  { value: "image",  label: "Image",  Icon: Image },
  { value: "video",  label: "Video",  Icon: Video },
  { value: "link",   label: "Link",   Icon: Link },
  { value: "sound",  label: "Sound",  Icon: Volume2 },
  { value: "file",   label: "File",   Icon: FileText },
  { value: "event",  label: "Event",  Icon: CalendarDays },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const KEYWORD_REGEX = /(from|in|has|mentions|before|on|after):(\S*)$/i;

function isDateMode(mode: DropdownMode): mode is "before" | "on" | "after" {
  return mode === "before" || mode === "on" || mode === "after";
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

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

  // Date picker local state (shared across before/on/after modes)
  const todayInit = new Date();
  const [pickerYear, setPickerYear] = useState(todayInit.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(todayInit.getMonth());
  const [pickerDay, setPickerDay] = useState(todayInit.getDate());

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Filtered member list for from:/mentions:
  const filteredMembers = useMemo(() => {
    const q = filterSubquery.toLowerCase();
    return members
      .filter((m) => q === "" || m.username.toLowerCase().includes(q))
      .slice(0, 8);
  }, [members, filterSubquery]);

  const filteredChannels = useMemo(() => {
    const q = filterSubquery.toLowerCase();
    return textChannels
      .filter((c) => q === "" || c.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [textChannels, filterSubquery]);

  // Main menu options (hide ones already applied)
  const mainOptions = useMemo(() => {
    const opts = [
      { type: "from"     as DropdownMode, label: "From a specific user",             hint: "from: user",             Icon: User },
      { type: "in"       as DropdownMode, label: "Sent in a specific channel",       hint: "in: channel",            Icon: Hash },
      { type: "has"      as DropdownMode, label: "Includes a specific type of data", hint: "has: link, image...",    Icon: Paperclip },
      { type: "mentions" as DropdownMode, label: "Mentions a specific user",         hint: "mentions: user",         Icon: AtSign },
      { type: "before"   as DropdownMode, label: "Sent before a date",               hint: "before: YYYY-MM-DD",     Icon: CalendarDays },
      { type: "on"       as DropdownMode, label: "Sent on a specific date",          hint: "on: YYYY-MM-DD",         Icon: CalendarDays },
      { type: "after"    as DropdownMode, label: "Sent after a date",                hint: "after: YYYY-MM-DD",      Icon: CalendarDays },
    ];
    return opts.filter((o) => {
      if (o.type === "from"     && fromUser)    return false;
      if (o.type === "in"       && inChannel)   return false;
      if (o.type === "has"      && hasType)     return false;
      if (o.type === "mentions" && mentionsUser) return false;
      if (o.type === "before"   && beforeDate)  return false;
      if (o.type === "on"       && onDate)      return false;
      if (o.type === "after"    && afterDate)   return false;
      return true;
    });
  }, [fromUser, inChannel, hasType, mentionsUser, beforeDate, onDate, afterDate]);

  function initPickerToday() {
    const t = new Date();
    setPickerYear(t.getFullYear());
    setPickerMonth(t.getMonth());
    setPickerDay(t.getDate());
  }

  function initPickerFromSubquery(sub: string) {
    const m = sub.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = parseInt(m[1]);
      const mo = parseInt(m[2]) - 1;
      const d = parseInt(m[3]);
      setPickerYear(y);
      setPickerMonth(mo);
      setPickerDay(Math.min(d, daysInMonth(y, mo)));
    } else {
      initPickerToday();
    }
  }

  function handleInputChange(value: string) {
    setInputValue(value);
    const match = value.match(KEYWORD_REGEX);
    if (match) {
      const kw = match[1].toLowerCase() as DropdownMode;
      setDropdownMode(kw);
      setFilterSubquery(match[2]);
      setSelectedIndex(-1);
      setIsOpen(true);
      if (isDateMode(kw)) initPickerFromSubquery(match[2]);
    } else {
      setDropdownMode("main");
      setFilterSubquery("");
      setSelectedIndex(-1);
    }
  }

  function stripKeywordFromInput(keyword: string) {
    return inputValue.replace(new RegExp(`(^|\\s)${keyword}:\\S*$`, "i"), "$1").trim();
  }

  function selectFrom(member: { userId: string; username: string; image: string | null }) {
    setFromUser({ id: member.userId, username: member.username, image: member.image });
    setInputValue(stripKeywordFromInput("from"));
    setDropdownMode("main");
    setFilterSubquery("");
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }

  function selectIn(channel: { id: string; name: string }) {
    setInChannel({ id: channel.id, name: channel.name });
    setInputValue(stripKeywordFromInput("in"));
    setDropdownMode("main");
    setFilterSubquery("");
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }

  function selectHas(value: string) {
    setHasType(value);
    setInputValue(stripKeywordFromInput("has"));
    setDropdownMode("main");
    setFilterSubquery("");
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }

  function selectMentions(member: { userId: string; username: string; image: string | null }) {
    setMentionsUser({ id: member.userId, username: member.username, image: member.image });
    setInputValue(stripKeywordFromInput("mentions"));
    setDropdownMode("main");
    setFilterSubquery("");
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }

  function applyDatePicker() {
    const maxD = daysInMonth(pickerYear, pickerMonth);
    const safeDay = Math.min(pickerDay, maxD);
    const dateStr = formatDate(pickerYear, pickerMonth, safeDay);
    if (dropdownMode === "before") {
      setBeforeDate(dateStr);
      setInputValue(stripKeywordFromInput("before"));
    } else if (dropdownMode === "on") {
      setOnDate(dateStr);
      setInputValue(stripKeywordFromInput("on"));
    } else if (dropdownMode === "after") {
      setAfterDate(dateStr);
      setInputValue(stripKeywordFromInput("after"));
    }
    setDropdownMode("main");
    setFilterSubquery("");
    setSelectedIndex(-1);
    inputRef.current?.focus();
  }

  function handlePickerMonthChange(newMonth: number) {
    setPickerMonth(newMonth);
    const maxD = daysInMonth(pickerYear, newMonth);
    if (pickerDay > maxD) setPickerDay(maxD);
  }

  function handlePickerYearChange(delta: number) {
    const newYear = pickerYear + delta;
    setPickerYear(newYear);
    const maxD = daysInMonth(newYear, pickerMonth);
    if (pickerDay > maxD) setPickerDay(maxD);
  }

  function handlePickerDayChange(delta: number) {
    const maxD = daysInMonth(pickerYear, pickerMonth);
    setPickerDay((d) => Math.max(1, Math.min(maxD, d + delta)));
  }

  function selectMainOption(mode: DropdownMode) {
    setDropdownMode(mode);
    setFilterSubquery("");
    setSelectedIndex(-1);
    if (isDateMode(mode)) initPickerToday();
    const kw = mode + ":";
    if (!inputValue.endsWith(kw)) {
      setInputValue((v) => (v ? v + " " + kw : kw));
    }
    inputRef.current?.focus();
  }

  function handleSubmit() {
    // username or @username → search for messages from that user + messages containing their name
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
    setFromUser(null);
    setInChannel(null);
    setHasType(null);
    setMentionsUser(null);
    setBeforeDate(null);
    setOnDate(null);
    setAfterDate(null);
    setInputValue("");
    setIsOpen(false);
    inputRef.current?.focus();
  }

  // Compute dropdown items for keyboard navigation
  const dropdownItems: { action: () => void }[] = useMemo(() => {
    switch (dropdownMode) {
      case "from":     return filteredMembers.map((m) => ({ action: () => selectFrom(m) }));
      case "in":       return filteredChannels.map((c) => ({ action: () => selectIn(c) }));
      case "has":      return HAS_OPTIONS.map((o) => ({ action: () => selectHas(o.value) }));
      case "mentions": return filteredMembers.map((m) => ({ action: () => selectMentions(m) }));
      case "before":
      case "on":
      case "after":    return [{ action: applyDatePicker }];
      default:         return mainOptions.map((o) => ({ action: () => selectMainOption(o.type) }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropdownMode, filteredMembers, filteredChannels, mainOptions, pickerYear, pickerMonth, pickerDay]);

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) {
      if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, dropdownItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isDateMode(dropdownMode)) {
        applyDatePicker();
      } else if (selectedIndex >= 0 && dropdownItems[selectedIndex]) {
        dropdownItems[selectedIndex].action();
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
          <span className="search-filter-tag">
            from: <strong>{fromUser.username}</strong>
            <button onMouseDown={(e) => { e.preventDefault(); setFromUser(null); }} title="Remove filter"><X size={11} /></button>
          </span>
        )}
        {inChannel && (
          <span className="search-filter-tag">
            in: <strong>#{inChannel.name}</strong>
            <button onMouseDown={(e) => { e.preventDefault(); setInChannel(null); }} title="Remove filter"><X size={11} /></button>
          </span>
        )}
        {hasType && (
          <span className="search-filter-tag">
            has: <strong>{hasType}</strong>
            <button onMouseDown={(e) => { e.preventDefault(); setHasType(null); }} title="Remove filter"><X size={11} /></button>
          </span>
        )}
        {mentionsUser && (
          <span className="search-filter-tag">
            mentions: <strong>{mentionsUser.username}</strong>
            <button onMouseDown={(e) => { e.preventDefault(); setMentionsUser(null); }} title="Remove filter"><X size={11} /></button>
          </span>
        )}
        {beforeDate && (
          <span className="search-filter-tag">
            before: <strong>{beforeDate}</strong>
            <button onMouseDown={(e) => { e.preventDefault(); setBeforeDate(null); }} title="Remove filter"><X size={11} /></button>
          </span>
        )}
        {onDate && (
          <span className="search-filter-tag">
            on: <strong>{onDate}</strong>
            <button onMouseDown={(e) => { e.preventDefault(); setOnDate(null); }} title="Remove filter"><X size={11} /></button>
          </span>
        )}
        {afterDate && (
          <span className="search-filter-tag">
            after: <strong>{afterDate}</strong>
            <button onMouseDown={(e) => { e.preventDefault(); setAfterDate(null); }} title="Remove filter"><X size={11} /></button>
          </span>
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
        <div className="search-filter-dropdown">
          {/* Main menu */}
          {dropdownMode === "main" && mainOptions.length > 0 && (
            <>
              <div className="search-filter-section-label">Filters</div>
              {mainOptions.map((opt, i) => (
                <button
                  key={opt.type}
                  className={`search-filter-option ${i === selectedIndex ? "selected" : ""}`}
                  onMouseDown={(e) => { e.preventDefault(); selectMainOption(opt.type); }}
                >
                  <div className="search-filter-option-left">
                    <div className="search-filter-option-icon">
                      <opt.Icon size={14} />
                    </div>
                    <div className="search-filter-option-text">
                      <span className="search-filter-option-label">{opt.label}</span>
                      <span className="search-filter-option-hint">{opt.hint}</span>
                    </div>
                  </div>
                  <span className="search-filter-option-keyword">{opt.type}:</span>
                </button>
              ))}
            </>
          )}

          {/* From user / Mentions picker */}
          {(dropdownMode === "from" || dropdownMode === "mentions") && (
            <>
              <div className="search-filter-section-label">
                {dropdownMode === "from" ? "From User" : "Mentions User"}
              </div>
              {filteredMembers.length === 0 ? (
                <div className="search-filter-empty">No users found</div>
              ) : (
                filteredMembers.map((m, i) => {
                  const status = userStatuses[m.userId] ?? "offline";
                  return (
                    <button
                      key={m.userId}
                      className={`search-filter-item ${i === selectedIndex ? "selected" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        dropdownMode === "from" ? selectFrom(m) : selectMentions(m);
                      }}
                    >
                      <div className="search-filter-avatar-wrapper">
                        {m.image ? (
                          <img src={m.image} alt={m.username} className="search-filter-avatar" />
                        ) : (
                          <span className="search-filter-avatar search-filter-avatar-fallback" style={{ background: avatarColor(m.username) }}>
                            {m.username.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className={`search-filter-status-dot ${status}`} />
                      </div>
                      <span className="search-filter-item-name">{m.username}</span>
                    </button>
                  );
                })
              )}
            </>
          )}

          {/* In channel picker */}
          {dropdownMode === "in" && (
            <>
              <div className="search-filter-section-label">In Channel</div>
              {filteredChannels.length === 0 ? (
                <div className="search-filter-empty">No channels found</div>
              ) : (
                filteredChannels.map((c, i) => (
                  <button
                    key={c.id}
                    className={`search-filter-item ${i === selectedIndex ? "selected" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); selectIn(c); }}
                  >
                    <Hash size={13} className="search-filter-channel-icon" />
                    <span className="search-filter-item-name">{c.name}</span>
                  </button>
                ))
              )}
            </>
          )}

          {/* Has type picker */}
          {dropdownMode === "has" && (
            <>
              <div className="search-filter-section-label">Media / Content Type</div>
              <div className="search-has-options">
                {HAS_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.value}
                    className={`search-filter-item search-has-item ${i === selectedIndex ? "selected" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); selectHas(opt.value); }}
                  >
                    <opt.Icon size={13} />
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Date picker (before / on / after) */}
          {isDateMode(dropdownMode) && (
            <>
              <div className="search-filter-section-label">
                {dropdownMode === "before" ? "Before Date" : dropdownMode === "on" ? "On Date" : "After Date"}
              </div>
              <div className="search-date-picker">
                <div className="search-date-picker-fields">
                  <div className="search-date-picker-field">
                    <span className="search-date-picker-label">Year</span>
                    <div className="search-date-stepper">
                      <button onMouseDown={(e) => { e.preventDefault(); handlePickerYearChange(-1); }}><ChevronLeft size={11} /></button>
                      <span>{pickerYear}</span>
                      <button onMouseDown={(e) => { e.preventDefault(); handlePickerYearChange(1); }}><ChevronRight size={11} /></button>
                    </div>
                  </div>
                  <div className="search-date-picker-field">
                    <span className="search-date-picker-label">Month</span>
                    <select
                      className="search-date-select"
                      value={pickerMonth}
                      onChange={(e) => handlePickerMonthChange(parseInt(e.target.value))}
                    >
                      {MONTH_NAMES.map((name, idx) => (
                        <option key={idx} value={idx}>{name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="search-date-picker-field">
                    <span className="search-date-picker-label">Day</span>
                    <div className="search-date-stepper">
                      <button onMouseDown={(e) => { e.preventDefault(); handlePickerDayChange(-1); }}><ChevronLeft size={11} /></button>
                      <span>{String(pickerDay).padStart(2, "0")}</span>
                      <button onMouseDown={(e) => { e.preventDefault(); handlePickerDayChange(1); }}><ChevronRight size={11} /></button>
                    </div>
                  </div>
                </div>
                <div className="search-date-preview">{formatDate(pickerYear, pickerMonth, pickerDay)}</div>
                <button
                  className="search-date-apply"
                  onMouseDown={(e) => { e.preventDefault(); applyDatePicker(); }}
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  );
}
