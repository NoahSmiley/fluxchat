import { lazy, Suspense } from "react";
import type { Channel } from "@/types/shared.js";

const SearchBar = lazy(() => import("./SearchBar.js").then(m => ({ default: m.SearchBar })));

interface ChatHeaderProps {
  channels: Channel[];
  activeChannelId: string | null;
  searchResults: unknown[] | null;
  searchQuery: string;
  searchFilters: {
    fromUsername?: string;
    inChannelName?: string;
    has?: string;
    mentionsUsername?: string;
    before?: string;
    on?: string;
    after?: string;
  };
}

export function ChatHeader({
  channels,
  activeChannelId,
  searchResults,
  searchQuery,
  searchFilters,
}: ChatHeaderProps) {
  return (
    <>
      <div className="chat-header">
        <span className="chat-header-channel">{channels.find((c) => c.id === activeChannelId)?.name}</span>
        <div className="chat-header-actions">
          <Suspense fallback={null}><SearchBar /></Suspense>
        </div>
      </div>

      {searchResults && (
        <div className="search-results-banner">
          {(() => {
            const parts: string[] = [];
            if (searchQuery) parts.push(`"${searchQuery}"`);
            if (searchFilters.fromUsername) parts.push(`from ${searchFilters.fromUsername}`);
            if (searchFilters.inChannelName) parts.push(`in #${searchFilters.inChannelName}`);
            if (searchFilters.has) parts.push(`has: ${searchFilters.has}`);
            if (searchFilters.mentionsUsername) parts.push(`mentions @${searchFilters.mentionsUsername}`);
            if (searchFilters.before) parts.push(`before ${searchFilters.before}`);
            if (searchFilters.on) parts.push(`on ${searchFilters.on}`);
            if (searchFilters.after) parts.push(`after ${searchFilters.after}`);
            return `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}${parts.length > 0 ? " — " + parts.join(", ") : ""}`;
          })()}
        </div>
      )}
    </>
  );
}
