import { useState, useRef, useEffect, type FormEvent } from "react";
import { useSpotifyStore } from "../../stores/spotify.js";
import { useYouTubeStore } from "../../stores/youtube.js";
import { useAuthStore } from "../../stores/auth.js";
import { Play, Pause, SkipForward, Plus, Search, X, Music, LogOut, Volume2, VolumeX } from "lucide-react";
import { MusicVisualizer } from "./MusicVisualizer.js";

export function MusicPanel({ voiceChannelId }: { voiceChannelId: string }) {
  const { user } = useAuthStore();
  const {
    account, session, queue, isHost, playerState,
    searchResults, searchLoading: spotifySearchLoading, volume,
    searchSource,
    searchInput,
    startSession, loadSession, endSession, addTrackToQueue, removeFromQueue,
    play, pause, skip, seek, setVolume, searchTracks,
    setSearchInput, setSearchSource,
  } = useSpotifyStore();
  const {
    youtubeTrack, youtubePaused, youtubeProgress, youtubeDuration,
    youtubeSearchResults, searchLoading: youtubeSearchLoading, searchError,
    searchYouTube, addYouTubeToQueue,
  } = useYouTubeStore();
  const searchLoading = spotifySearchLoading || youtubeSearchLoading;
  const [vibeMode, setVibeMode] = useState(false);
  const konamiRef = useRef<string[]>([]);

  const spotifyTrack = playerState?.track_window?.current_track;
  const activeSource = youtubeTrack ? "youtube" : spotifyTrack ? "spotify" : null;
  const currentTrackName = activeSource === "youtube" ? youtubeTrack!.name : spotifyTrack?.name;
  const currentTrackArtist = activeSource === "youtube"
    ? youtubeTrack!.artist
    : spotifyTrack?.artists.map(a => a.name).join(", ");
  const albumArtUrl = activeSource === "youtube" ? youtubeTrack!.imageUrl : spotifyTrack?.album.images[0]?.url;
  const isPaused = activeSource === "youtube" ? youtubePaused : (playerState?.paused ?? true);
  const hasTrack = activeSource !== null;

  // Konami code: ↑↑↓↓←→←→
  useEffect(() => {
    const KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight"];
    function onKey(e: KeyboardEvent) {
      konamiRef.current.push(e.key);
      // Keep only the last N keys
      if (konamiRef.current.length > KONAMI.length) {
        konamiRef.current = konamiRef.current.slice(-KONAMI.length);
      }
      if (konamiRef.current.length === KONAMI.length && konamiRef.current.every((k, i) => k === KONAMI[i])) {
        setVibeMode((v) => !v);
        konamiRef.current = [];
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchInput.trim()) return;
    if (searchSource === "youtube") {
      searchYouTube(searchInput.trim());
    } else {
      searchTracks(searchInput.trim());
    }
  }

  if (!account?.linked) {
    return (
      <div className="music-panel">
        <div className="music-panel-empty">
          <Music size={48} />
          <p>Link your Spotify account in Settings to start a jam session.</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="music-panel">
        <div className="music-panel-empty">
          <Music size={48} />
          <h3>Jam Session</h3>
          <p>Start a jam session to play music with everyone in this voice channel.</p>
          <button className="btn-spotify" onClick={() => startSession(voiceChannelId)}>
            Start Jam
          </button>
        </div>
      </div>
    );
  }

  // Shared search UI (used in both empty state and collapsible search)
  const searchUI = (
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
      <form onSubmit={handleSearch} className="music-search-form">
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

  const progressMs = activeSource === "youtube" ? youtubeProgress : (playerState?.position ?? 0);
  const durationMs = activeSource === "youtube" ? youtubeDuration : (playerState?.duration ?? 0);
  const progressPct = durationMs > 0 ? (progressMs / durationMs) * 100 : 0;

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(Math.round(pct * durationMs));
  }

  return (
    <div className={`music-panel ${vibeMode ? "vibe-mode" : ""}`}>
      {/* Fullscreen shader visualizer */}
      {vibeMode && hasTrack && (
        <MusicVisualizer isPaused={isPaused} albumArtUrl={albumArtUrl} onClose={() => setVibeMode(false)} />
      )}

      {/* Blurred album backdrop (hidden in vibe mode) */}
      {albumArtUrl && !vibeMode && (
        <div className="music-backdrop" style={{ backgroundImage: `url(${albumArtUrl})` }} />
      )}

      {/* ── Empty state: session started but nothing playing ── */}
      {!hasTrack && (
        <div className="music-empty-session">
          <div className="music-empty-hero">
            <div className="music-empty-vinyl">
              <div className="music-empty-vinyl-grooves" />
              <div className="music-empty-vinyl-label">
                <Music size={24} />
              </div>
              <div className="music-vinyl-center" />
            </div>
            <div className="music-empty-text">
              <h3>Jam session is live</h3>
              <p>Search for a track to get the party started</p>
            </div>
          </div>
          {searchUI}
        </div>
      )}

      {/* ── Now Playing (only when track active) ── */}
      {hasTrack && !vibeMode && (
        <div className="music-now-playing">
          {albumArtUrl && (
            <div className={`music-vinyl ${isPaused ? "paused" : "spinning"}`}>
              <div className="music-vinyl-grooves" />
              <img src={albumArtUrl} alt="" className="music-album-art" />
              <div className="music-vinyl-center" />
            </div>
          )}
          <div className="music-track-info">
            <span className="music-track-name">{currentTrackName}</span>
            <span className="music-track-artist">{currentTrackArtist}</span>
          </div>

          {/* Progress bar */}
          <div className="music-progress-row">
            <span className="music-progress-time">{formatTime(progressMs)}</span>
            <div className="music-progress-bar" onClick={handleSeek}>
              <div className="music-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="music-progress-time">{formatTime(durationMs)}</span>
          </div>

          {/* Controls */}
          <div className="music-controls">
            <div className="music-control-buttons">
              {isPaused ? (
                <button className="music-control-btn" onClick={() => play()} title="Resume">
                  <Play size={18} />
                </button>
              ) : (
                <button className="music-control-btn" onClick={() => pause()} title="Pause">
                  <Pause size={18} />
                </button>
              )}
              <button className="music-control-btn" onClick={() => skip()} title="Skip">
                <SkipForward size={18} />
              </button>
            </div>
            <div className="music-volume">
              <button
                className="music-volume-btn"
                onClick={() => setVolume(volume > 0 ? 0 : 0.5)}
                title={volume === 0 ? "Unmute" : "Mute"}
              >
                {volume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(Math.sqrt(volume) * 100)}
                onChange={(e) => {
                  const linear = parseInt(e.target.value) / 100;
                  setVolume(linear * linear);
                }}
                className="volume-slider"
                title={`Volume: ${Math.round(volume * 100)}%`}
              />
            </div>
          </div>
        </div>
      )}

      {/* Vibe mode overlay */}
      {hasTrack && vibeMode && (
        <div className="music-now-playing vibe-overlay">
          <div className="music-track-info">
            <span className="music-track-name">{currentTrackName}</span>
            <span className="music-track-artist">{currentTrackArtist}</span>
          </div>
        </div>
      )}
      {hasTrack && vibeMode && (
        <div className="music-controls vibe-overlay-controls">
          <div className="music-control-buttons">
            {isPaused ? (
              <button className="music-control-btn" onClick={() => play()} title="Resume">
                <Play size={18} />
              </button>
            ) : (
              <button className="music-control-btn" onClick={() => pause()} title="Pause">
                <Pause size={18} />
              </button>
            )}
            <button className="music-control-btn" onClick={() => skip()} title="Skip">
              <SkipForward size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Search — always visible when a track is playing */}
      {hasTrack && searchUI}

      {/* Queue */}
      <div className="music-queue">
        <h4 className="music-queue-title">Queue ({queue.length})</h4>
        {queue.length === 0 ? (
          <p className="music-queue-empty">
            {hasTrack ? "Queue is empty — search to add more tracks" : "Tracks you add will appear here"}
          </p>
        ) : (
          <div className="music-queue-list">
            {queue.map((item, i) => (
              <div key={item.id} className="music-queue-item">
                <span className={`music-queue-source-badge ${item.source === "youtube" ? "youtube" : "spotify"}`}>
                  {item.source === "youtube"
                    ? <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
                    : <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                  }
                </span>
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
                    onClick={() => play(item.trackUri, item.source)}
                    title="Play"
                  >
                    <Play size={14} />
                  </button>
                )}
                <button
                  className="music-queue-item-remove"
                  onClick={() => removeFromQueue(item.id)}
                  title="Remove"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* End session (host only) */}
      {isHost && (
        <button className="music-end-session" onClick={endSession}>
          <LogOut size={14} /> End Jam
        </button>
      )}
    </div>
  );
}
