import { Play, X } from "lucide-react";
import type { QueueItem } from "../../types/shared.js";

export interface MusicQueueProps {
  queue: QueueItem[];
  hasTrack: boolean;
  play: (trackUri?: string, source?: string) => Promise<void>;
  removeFromQueue: (itemId: string) => Promise<void>;
}

const SpotifyIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
);

const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
);

export function MusicQueue({ queue, hasTrack, play, removeFromQueue }: MusicQueueProps) {
  return (
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
                {item.source === "youtube" ? <YouTubeIcon /> : <SpotifyIcon />}
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
  );
}
