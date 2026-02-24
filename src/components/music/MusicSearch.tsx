import { type FormEvent } from "react";
import { Play, Plus, Search } from "lucide-react";
import type { SpotifyTrack, YouTubeTrack } from "@/types/shared.js";

export interface MusicSearchProps {
  searchSource: "spotify" | "youtube";
  searchInput: string;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: SpotifyTrack[];
  youtubeSearchResults: YouTubeTrack[];
  setSearchSource: (source: "spotify" | "youtube") => void;
  setSearchInput: (input: string) => void;
  onSearch: (e: FormEvent) => void;
  play: (trackUri?: string, source?: string) => Promise<void>;
  addTrackToQueue: (track: SpotifyTrack) => Promise<void>;
  addYouTubeToQueue: (track: YouTubeTrack) => Promise<void>;
}

export function MusicSearch({
  searchSource,
  searchInput,
  searchLoading,
  searchError,
  searchResults,
  youtubeSearchResults,
  setSearchSource,
  setSearchInput,
  onSearch,
  play,
  addTrackToQueue,
  addYouTubeToQueue,
}: MusicSearchProps) {
  return (
    <div className="music-search">
      {/* Source tabs */}
      <div className="music-search-source-tabs">
        <button
          className={`music-source-tab ${searchSource === "spotify" ? "active" : ""}`}
          onClick={() => setSearchSource("spotify")}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
          Spotify
        </button>
        <button
          className={`music-source-tab ${searchSource === "youtube" ? "active" : ""}`}
          onClick={() => setSearchSource("youtube")}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          YouTube
        </button>
      </div>
      <form onSubmit={onSearch} className="music-search-form">
        <input
          type="text"
          placeholder={`Search ${searchSource === "spotify" ? "Spotify" : "YouTube"}...`}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="music-search-input"
          autoFocus
        />
        <button type="submit" className="music-search-btn" title="Search">
          <Search size={16} />
        </button>
      </form>
      {searchLoading && <div className="music-search-loading">Searching...</div>}
      {searchError && <div className="music-search-loading" style={{ color: "#ff6b6b" }}>{searchError}</div>}
      <div className="music-search-results">
        {searchSource === "spotify"
          ? searchResults.map((track) => (
              <div key={track.uri} className="music-search-item">
                {track.album.images[track.album.images.length - 1] && (
                  <img
                    src={track.album.images[track.album.images.length - 1].url}
                    alt=""
                    className="music-search-item-art"
                  />
                )}
                <div className="music-search-item-info">
                  <span className="music-search-item-name">{track.name}</span>
                  <span className="music-search-item-artist">
                    {track.artists.map((a) => a.name).join(", ")}
                  </span>
                </div>
                <div className="music-search-item-actions">
                  <button
                    className="music-search-item-play"
                    onClick={() => play(track.uri)}
                    title="Play now"
                  >
                    <Play size={14} />
                  </button>
                  <button
                    className="music-search-item-add"
                    onClick={() => addTrackToQueue(track)}
                    title="Add to queue"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ))
          : youtubeSearchResults.map((track) => (
              <div key={track.id} className="music-search-item">
                {track.thumbnail && (
                  <img src={track.thumbnail} alt="" className="music-search-item-art" />
                )}
                <div className="music-search-item-info">
                  <span className="music-search-item-name">{track.title}</span>
                  <span className="music-search-item-artist">{track.channel}</span>
                </div>
                <div className="music-search-item-actions">
                  <button className="music-search-item-play" onClick={() => play(track.id, "youtube")} title="Play now">
                    <Play size={14} />
                  </button>
                  <button className="music-search-item-add" onClick={() => addYouTubeToQueue(track)} title="Add to queue">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
