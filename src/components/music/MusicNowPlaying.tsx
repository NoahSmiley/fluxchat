import { Play, Pause, SkipForward, Volume2, VolumeX } from "lucide-react";

export interface MusicNowPlayingProps {
  currentTrackName: string | undefined;
  currentTrackArtist: string | undefined;
  albumArtUrl: string | undefined;
  isPaused: boolean;
  vibeMode: boolean;
  progressMs: number;
  durationMs: number;
  volume: number;
  play: (trackUri?: string, source?: string) => Promise<void>;
  pause: () => void;
  skip: (trackUri?: string) => void;
  seek: (ms: number) => void;
  setVolume: (vol: number) => void;
}

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function MusicNowPlaying({
  currentTrackName,
  currentTrackArtist,
  albumArtUrl,
  isPaused,
  vibeMode,
  progressMs,
  durationMs,
  volume,
  play,
  pause,
  skip,
  seek,
  setVolume,
}: MusicNowPlayingProps) {
  const progressPct = durationMs > 0 ? (progressMs / durationMs) * 100 : 0;

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    if (durationMs <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(Math.round(pct * durationMs));
  }

  return (
    <>
      {/* Normal now-playing view (hidden in vibe mode) */}
      {!vibeMode && (
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
      {vibeMode && (
        <div className="music-now-playing vibe-overlay">
          <div className="music-track-info">
            <span className="music-track-name">{currentTrackName}</span>
            <span className="music-track-artist">{currentTrackArtist}</span>
          </div>
        </div>
      )}
      {vibeMode && (
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
    </>
  );
}
