import { useState, type FormEvent } from "react";
import { useSpotifyStore } from "../stores/spotify.js";
import { useAuthStore } from "../stores/auth.js";
import { Play, Pause, SkipForward, Plus, Search, X, Music, LogOut } from "lucide-react";
import type { SpotifyTrack } from "../types/shared.js";

export function MusicPanel({ voiceChannelId }: { voiceChannelId: string }) {
  const { user } = useAuthStore();
  const {
    account, session, queue, isHost, playerState,
    searchResults, searchLoading, volume,
    startSession, loadSession, endSession, addTrackToQueue,
    play, pause, skip, seek, setVolume, searchTracks,
  } = useSpotifyStore();

  const [searchInput, setSearchInput] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const currentTrack = playerState?.track_window?.current_track;
  const isPaused = playerState?.paused ?? true;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (searchInput.trim()) {
      searchTracks(searchInput.trim());
    }
  }

  async function handleAddToQueue(track: SpotifyTrack) {
    await addTrackToQueue(track);
  }

  function handlePlay(trackUri?: string) {
    play(trackUri);
  }

  // Not linked
  if (!account?.linked) {
    return (
      <div className="music-panel">
        <div className="music-panel-empty">
          <Music size={48} />
          <p>Link your Spotify account in Settings to use group listening.</p>
        </div>
      </div>
    );
  }

  // No session yet
  if (!session) {
    return (
      <div className="music-panel">
        <div className="music-panel-empty">
          <Music size={48} />
          <h3>Group Listening</h3>
          <p>Start a listening session to play music with everyone in this voice channel.</p>
          <button className="btn-spotify" onClick={() => startSession(voiceChannelId)}>
            Start Session
          </button>
        </div>
      </div>
    );
  }

  const albumArtUrl = currentTrack?.album.images[0]?.url;

  return (
    <div className="music-panel">
      {/* Blurred album backdrop */}
      {albumArtUrl && (
        <div className="music-backdrop" style={{ backgroundImage: `url(${albumArtUrl})` }} />
      )}

      {/* Now Playing */}
      {currentTrack && (
        <div className={`music-now-playing ${isPaused ? "paused" : ""}`}>
          {albumArtUrl && (
            <div className={`music-vinyl ${isPaused ? "paused" : "spinning"}`}>
              <div className="music-vinyl-grooves" />
              <img
                src={albumArtUrl}
                alt={currentTrack.album.name}
                className="music-album-art"
              />
              <div className="music-vinyl-center" />
            </div>
          )}
          <div className="music-track-info">
            <span className="music-track-name">{currentTrack.name}</span>
            <span className="music-track-artist">
              {currentTrack.artists.map((a) => a.name).join(", ")}
            </span>
          </div>
        </div>
      )}

      {/* Controls */}
      {currentTrack && (
        <div className="music-controls">
          <div className="music-control-buttons">
            {isPaused ? (
              <button
                className="music-control-btn"
                onClick={() => play()}
                title="Resume"
              >
                <Play size={20} />
              </button>
            ) : (
              <button
                className="music-control-btn"
                onClick={() => pause()}
                title="Pause"
              >
                <Pause size={20} />
              </button>
            )}
            <button
              className="music-control-btn"
              onClick={() => skip()}
              title="Skip"
            >
              <SkipForward size={20} />
            </button>
          </div>
          <div className="music-volume">
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
              className="volume-slider"
              title={`Volume: ${Math.round(volume * 100)}%`}
            />
          </div>
        </div>
      )}

      {/* Search toggle */}
      <div className="music-search-header">
        <button
          className={`music-search-toggle ${showSearch ? "active" : ""}`}
          onClick={() => setShowSearch(!showSearch)}
        >
          {showSearch ? <X size={16} /> : <Search size={16} />}
          {showSearch ? "Close Search" : "Search Tracks"}
        </button>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="music-search">
          <form onSubmit={handleSearch} className="music-search-form">
            <input
              type="text"
              placeholder="Search Spotify..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="music-search-input"
              autoFocus
            />
          </form>
          {searchLoading && <div className="music-search-loading">Searching...</div>}
          <div className="music-search-results">
            {searchResults.map((track) => (
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
                    onClick={() => handlePlay(track.uri)}
                    title="Play now"
                  >
                    <Play size={14} />
                  </button>
                  <button
                    className="music-search-item-add"
                    onClick={() => handleAddToQueue(track)}
                    title="Add to queue"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Queue */}
      <div className="music-queue">
        <h4 className="music-queue-title">Queue ({queue.length})</h4>
        {queue.length === 0 ? (
          <p className="music-queue-empty">No tracks in queue. Search and add some!</p>
        ) : (
          <div className="music-queue-list">
            {queue.map((item, i) => (
              <div key={item.id} className="music-queue-item">
                {item.trackImageUrl && (
                  <img src={item.trackImageUrl} alt="" className="music-queue-item-art" />
                )}
                <div className="music-queue-item-info">
                  <span className="music-queue-item-name">{item.trackName}</span>
                  <span className="music-queue-item-artist">{item.trackArtist}</span>
                </div>
                {i === 0 && (
                  <button
                    className="music-queue-item-play"
                    onClick={() => handlePlay(item.trackUri)}
                    title="Play"
                  >
                    <Play size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* End session (host only) */}
      {isHost && (
        <button className="music-end-session" onClick={endSession}>
          <LogOut size={14} /> End Session
        </button>
      )}
    </div>
  );
}
