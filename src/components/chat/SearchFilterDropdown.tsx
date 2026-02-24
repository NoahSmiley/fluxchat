import { useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { User, Hash, Paperclip, AtSign, CalendarDays, Image, Video, Link, Volume2, FileText } from "lucide-react";
import { avatarColor } from "@/lib/avatarColor.js";
import { SearchDatePicker, type SearchDatePickerHandle } from "./SearchDatePicker.js";

export type DropdownMode = "main" | "from" | "in" | "has" | "mentions" | "before" | "on" | "after";

export function isDateMode(mode: DropdownMode): mode is "before" | "on" | "after" {
  return mode === "before" || mode === "on" || mode === "after";
}

export const HAS_OPTIONS = [
  { value: "image",  label: "Image",  Icon: Image },
  { value: "video",  label: "Video",  Icon: Video },
  { value: "link",   label: "Link",   Icon: Link },
  { value: "sound",  label: "Sound",  Icon: Volume2 },
  { value: "file",   label: "File",   Icon: FileText },
  { value: "event",  label: "Event",  Icon: CalendarDays },
];

interface MemberItem {
  userId: string;
  username: string;
  image: string | null;
}

interface ChannelItem {
  id: string;
  name: string;
}

export interface SearchFilterDropdownHandle {
  getItemCount: () => number;
  executeItem: (index: number) => void;
}

export interface SearchFilterDropdownProps {
  dropdownMode: DropdownMode;
  selectedIndex: number;
  filterSubquery: string;
  members: MemberItem[];
  textChannels: ChannelItem[];
  userStatuses: Record<string, string>;
  fromUser: { id: string; username: string; image: string | null } | null;
  inChannel: { id: string; name: string } | null;
  hasType: string | null;
  mentionsUser: { id: string; username: string; image: string | null } | null;
  beforeDate: string | null;
  onDate: string | null;
  afterDate: string | null;
  onSelectMainOption: (mode: DropdownMode) => void;
  onSelectFrom: (member: MemberItem) => void;
  onSelectIn: (channel: ChannelItem) => void;
  onSelectHas: (value: string) => void;
  onSelectMentions: (member: MemberItem) => void;
  onApplyDate: (dateStr: string) => void;
}

export const SearchFilterDropdown = forwardRef<SearchFilterDropdownHandle, SearchFilterDropdownProps>(
  function SearchFilterDropdown({
    dropdownMode,
    selectedIndex,
    filterSubquery,
    members,
    textChannels,
    userStatuses,
    fromUser,
    inChannel,
    hasType,
    mentionsUser,
    beforeDate,
    onDate,
    afterDate,
    onSelectMainOption,
    onSelectFrom,
    onSelectIn,
    onSelectHas,
    onSelectMentions,
    onApplyDate,
  }, ref) {

    const datePickerRef = useRef<SearchDatePickerHandle>(null);

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

    const getItemCount = useCallback((): number => {
      switch (dropdownMode) {
        case "from":
        case "mentions": return filteredMembers.length;
        case "in":       return filteredChannels.length;
        case "has":      return HAS_OPTIONS.length;
        case "before":
        case "on":
        case "after":    return 1;
        default:         return mainOptions.length;
      }
    }, [dropdownMode, filteredMembers.length, filteredChannels.length, mainOptions.length]);

    const executeItem = useCallback((index: number): void => {
      switch (dropdownMode) {
        case "from":
          if (filteredMembers[index]) onSelectFrom(filteredMembers[index]);
          break;
        case "mentions":
          if (filteredMembers[index]) onSelectMentions(filteredMembers[index]);
          break;
        case "in":
          if (filteredChannels[index]) onSelectIn(filteredChannels[index]);
          break;
        case "has":
          if (HAS_OPTIONS[index]) onSelectHas(HAS_OPTIONS[index].value);
          break;
        case "before":
        case "on":
        case "after":
          datePickerRef.current?.apply();
          break;
        default:
          if (mainOptions[index]) onSelectMainOption(mainOptions[index].type);
          break;
      }
    }, [dropdownMode, filteredMembers, filteredChannels, mainOptions, onSelectFrom, onSelectMentions, onSelectIn, onSelectHas, onSelectMainOption]);

    useImperativeHandle(ref, () => ({ getItemCount, executeItem }), [getItemCount, executeItem]);

    // Compute the initial date string for the date picker from the subquery
    const dateInitial = isDateMode(dropdownMode) ? (filterSubquery || null) : null;

    return (
      <div className="search-filter-dropdown">
        {/* Main menu */}
        {dropdownMode === "main" && mainOptions.length > 0 && (
          <>
            <div className="search-filter-section-label">Filters</div>
            {mainOptions.map((opt, i) => (
              <button
                key={opt.type}
                className={`search-filter-option ${i === selectedIndex ? "selected" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); onSelectMainOption(opt.type); }}
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
                      dropdownMode === "from" ? onSelectFrom(m) : onSelectMentions(m);
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
                  onMouseDown={(e) => { e.preventDefault(); onSelectIn(c); }}
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
                  onMouseDown={(e) => { e.preventDefault(); onSelectHas(opt.value); }}
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
          <SearchDatePicker
            ref={datePickerRef}
            mode={dropdownMode}
            onApply={onApplyDate}
            initialDate={dateInitial}
          />
        )}
      </div>
    );
  }
);
