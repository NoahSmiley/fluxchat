import { useState, useRef, useEffect, type FormEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSpotifyStore } from "@/stores/spotify/index.js";
import { useYouTubeStore } from "@/stores/youtube.js";
import { useAuthStore } from "@/stores/auth.js";
import { Music, LogOut } from "lucide-react";
import { MusicVisualizer } from "./MusicVisualizer.js";
import { MusicNowPlaying } from "./MusicNowPlaying.js";
import { MusicSearch } from "./MusicSearch.js";
import { MusicQueue } from "./MusicQueue.js";

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
  } = useSpotifyStore(useShallow((s) => ({
    account: s.account, session: s.session, queue: s.queue, isHost: s.isHost, playerState: s.playerState,
    searchResults: s.searchResults, searchLoading: s.searchLoading, volume: s.volume,
    searchSource: s.searchSource, searchInput: s.searchInput,
    startSession: s.startSession, loadSession: s.loadSession, endSession: s.endSession,
    addTrackToQueue: s.addTrackToQueue, removeFromQueue: s.removeFromQueue,
    play: s.play, pause: s.pause, skip: s.skip, seek: s.seek, setVolume: s.setVolume,
    searchTracks: s.searchTracks, setSearchInput: s.setSearchInput, setSearchSource: s.setSearchSource,
  })));
  const {
    youtubeTrack, youtubePaused, youtubeProgress, youtubeDuration,
    youtubeSearchResults, searchLoading: youtubeSearchLoading, searchError,
    searchYouTube, addYouTubeToQueue,
  } = useYouTubeStore(useShallow((s) => ({
    youtubeTrack: s.youtubeTrack, youtubePaused: s.youtubePaused, youtubeProgress: s.youtubeProgress,
    youtubeDuration: s.youtubeDuration, youtubeSearchResults: s.youtubeSearchResults,
    searchLoading: s.searchLoading, searchError: s.searchError,
    searchYouTube: s.searchYouTube, addYouTubeToQueue: s.addYouTubeToQueue,
  })));
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

  const progressMs = activeSource === "youtube" ? youtubeProgress : (playerState?.position ?? 0);
  const durationMs = activeSource === "youtube" ? youtubeDuration : (playerState?.duration ?? 0);

  // Konami code: arrow sequence toggles vibe mode
  useEffect(() => {
    const KONAMI = ["ArrowUp","ArrowUp","ArrowDown","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight"];
    function onKey(e: KeyboardEvent) {
      konamiRef.current.push(e.key);
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

  // ── Not linked ──
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

  // ── No session ──
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

  const searchUI = (
    <MusicSearch
      searchSource={searchSource}
      searchInput={searchInput}
      searchLoading={searchLoading}
      searchError={searchError}
      searchResults={searchResults}
      youtubeSearchResults={youtubeSearchResults}
      setSearchSource={setSearchSource}
      setSearchInput={setSearchInput}
      onSearch={handleSearch}
      play={play}
      addTrackToQueue={addTrackToQueue}
      addYouTubeToQueue={addYouTubeToQueue}
    />
  );

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

      {/* Empty state: session started but nothing playing */}
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

      {/* Now Playing (only when track active) */}
      {hasTrack && (
        <MusicNowPlaying
          currentTrackName={currentTrackName}
          currentTrackArtist={currentTrackArtist}
          albumArtUrl={albumArtUrl}
          isPaused={isPaused}
          vibeMode={vibeMode}
          progressMs={progressMs}
          durationMs={durationMs}
          volume={volume}
          play={play}
          pause={pause}
          skip={skip}
          seek={seek}
          setVolume={setVolume}
        />
      )}

      {/* Search (always visible when a track is playing) */}
      {hasTrack && searchUI}

      {/* Queue */}
      <MusicQueue
        queue={queue}
        hasTrack={hasTrack}
        play={play}
        removeFromQueue={removeFromQueue}
      />

      {/* End session (host only) */}
      {isHost && (
        <button className="music-end-session" onClick={endSession}>
          <LogOut size={14} /> End Jam
        </button>
      )}
    </div>
  );
}
