import { useVoiceStore } from "../../stores/voice/index.js";
import { Music, Square, Volume1, VolumeX } from "lucide-react";

// ── Lobby Music Bar (Easter Egg) ──
export function LobbyMusicBar() {
  const lobbyMusicPlaying = useVoiceStore((s) => s.lobbyMusicPlaying);
  const lobbyMusicVolume = useVoiceStore((s) => s.lobbyMusicVolume);
  const setLobbyMusicVolume = useVoiceStore((s) => s.setLobbyMusicVolume);
  const stopLobbyMusicAction = useVoiceStore((s) => s.stopLobbyMusicAction);

  if (!lobbyMusicPlaying) return null;

  return (
    <div className="lobby-music-bar">
      <div className="lobby-music-info">
        <Music size={16} className="lobby-music-icon" />
        <span className="lobby-music-label">Waiting Room Music</span>
      </div>
      <div className="lobby-music-controls">
        <button
          className="lobby-music-mute-btn"
          onClick={() => setLobbyMusicVolume(lobbyMusicVolume > 0 ? 0 : 0.15)}
          title={lobbyMusicVolume === 0 ? "Unmute" : "Mute"}
        >
          {lobbyMusicVolume === 0 ? <VolumeX size={16} /> : <Volume1 size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max="50"
          value={Math.round(lobbyMusicVolume * 100)}
          onChange={(e) => setLobbyMusicVolume(parseInt(e.target.value) / 100)}
          className="volume-slider lobby-music-slider"
          title={`Volume: ${Math.round(lobbyMusicVolume * 100)}%`}
        />
        <button
          className="lobby-music-stop-btn"
          onClick={stopLobbyMusicAction}
          title="Stop"
        >
          <Square size={14} />
        </button>
      </div>
    </div>
  );
}
