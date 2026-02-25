import { useState, useEffect, useMemo } from "react";
import { Heart, Volume2, VolumeX } from "lucide-react";
import * as api from "@/lib/api/index.js";
import { gateway } from "@/lib/ws.js";
import type { SoundboardSound } from "@/types/shared.js";
import { API_BASE } from "@/lib/serverUrl.js";
import { useAuthStore } from "@/stores/auth.js";
import { useChatStore } from "@/stores/chat/index.js";
import { renderEmoji } from "@/lib/emoji.js";

/** Fire-and-forget audio preview at a given volume. */
export function previewSoundAudio(url: string, volume: number) {
  const audio = new Audio(url);
  audio.volume = Math.min(1, Math.max(0, volume));
  audio.play().catch(() => {});
}

export function SoundboardPanel({ serverId, channelId }: { serverId: string; channelId: string }) {
  const customEmojis = useChatStore((s) => s.customEmojis);
  const [sounds, setSounds] = useState<SoundboardSound[]>([]);
  const [loading, setLoading] = useState(true);
  const [masterVolume, setMasterVolume] = useState(() => {
    const stored = localStorage.getItem("soundboard-master-volume");
    return stored !== null ? parseFloat(stored) : 1;
  });
  const user = useAuthStore(s => s.user);

  function handleMasterVolume(v: number) {
    setMasterVolume(v);
    localStorage.setItem("soundboard-master-volume", String(v));
  }

  useEffect(() => {
    api.getSoundboardSounds(serverId)
      .then(setSounds)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serverId]);

  function handlePlay(sound: SoundboardSound) {
    gateway.send({ type: "play_sound", channelId, soundId: sound.id });
  }

  function handlePreview(e: React.MouseEvent, sound: SoundboardSound) {
    e.stopPropagation();
    previewSoundAudio(`${API_BASE}/files/${sound.audioAttachmentId}/${sound.audioFilename}`, sound.volume * masterVolume);
  }

  function handleToggleFavorite(e: React.MouseEvent, sound: SoundboardSound) {
    e.stopPropagation();
    const wasFavorited = sound.favorited;
    setSounds(prev =>
      prev.map(s => s.id === sound.id ? { ...s, favorited: !wasFavorited } : s)
    );
    if (wasFavorited) {
      api.unfavoriteSoundboardSound(serverId, sound.id).catch(() => {
        setSounds(prev =>
          prev.map(s => s.id === sound.id ? { ...s, favorited: true } : s)
        );
      });
    } else {
      api.favoriteSoundboardSound(serverId, sound.id).catch(() => {
        setSounds(prev =>
          prev.map(s => s.id === sound.id ? { ...s, favorited: false } : s)
        );
      });
    }
  }

  if (loading) {
    return <div className="soundboard-panel"><p className="soundboard-empty">Loading…</p></div>;
  }

  if (sounds.length === 0) {
    return <div className="soundboard-panel"><p className="soundboard-empty">No sounds added yet. Admins can add sounds in Server Settings → Soundboard.</p></div>;
  }

  function renderSound(sound: SoundboardSound, keyPrefix: string) {
    const icon = sound.emoji ? (
      <span className="soundboard-btn-emoji" dangerouslySetInnerHTML={{ __html: renderEmoji(sound.emoji, customEmojis, API_BASE) }} />
    ) : null;

    return (
      <button
        key={`${keyPrefix}${sound.id}`}
        className="soundboard-btn"
        onClick={() => handlePlay(sound)}
        title={sound.name}
      >
        <div className="soundboard-btn-spacer" />
        <div className="soundboard-btn-row">
          <div className="soundboard-mini-btn" onClick={(e) => handlePreview(e, sound)}>
            <Volume2 size={15} />
          </div>
          <div className="soundboard-btn-icon">{icon}</div>
          <div
            className={`soundboard-mini-btn${sound.favorited ? " favorited" : ""}`}
            onClick={(e) => handleToggleFavorite(e, sound)}
          >
            <Heart size={15} fill={sound.favorited ? "currentColor" : "none"} />
          </div>
        </div>
        <span className="soundboard-btn-name">{sound.name}</span>
      </button>
    );
  }

  const myUsername = user?.username;

  const { favorites, ownSounds, otherGroups, hasTopSection } = useMemo(() => {
    const s = [...sounds].sort((a, b) => a.name.localeCompare(b.name));
    const favs = s.filter(x => x.favorited);
    const own = myUsername ? s.filter(x => x.creatorUsername === myUsername) : [];

    const groupMap = new Map<string, SoundboardSound[]>();
    for (const sound of s) {
      if (sound.creatorUsername === myUsername) continue;
      if (!groupMap.has(sound.creatorUsername)) groupMap.set(sound.creatorUsername, []);
      groupMap.get(sound.creatorUsername)!.push(sound);
    }
    const groups = [...groupMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([username, snds]) => ({ username, snds }));

    return { favorites: favs, ownSounds: own, otherGroups: groups, hasTopSection: favs.length > 0 || own.length > 0 };
  }, [sounds, myUsername]);

  return (
    <div className="soundboard-panel">
      <div className="soundboard-volume-row">
        <span className="soundboard-volume-title">Soundboard Volume</span>
        <div className="soundboard-volume-control">
          {masterVolume === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />}
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={masterVolume}
            onChange={e => handleMasterVolume(parseFloat(e.target.value))}
            className="soundboard-volume-slider"
          />
          <span className="soundboard-volume-label">{Math.round(masterVolume * 100)}%</span>
        </div>
      </div>
      {hasTopSection && (
        <div className="soundboard-top-section">
          {favorites.length > 0 && (
            <div className="soundboard-group">
              <span className="soundboard-group-label">Favorites</span>
              <div className="soundboard-grid">
                {favorites.map(sound => renderSound(sound, "fav-"))}
              </div>
            </div>
          )}
          {ownSounds.length > 0 && (
            <div className="soundboard-group">
              <span className="soundboard-group-label">{myUsername}</span>
              <div className="soundboard-grid">
                {ownSounds.map(sound => renderSound(sound, ""))}
              </div>
            </div>
          )}
        </div>
      )}
      {hasTopSection && otherGroups.length > 0 && <div className="soundboard-divider" />}
      {otherGroups.map(({ username, snds }) => (
        <div key={username} className="soundboard-group">
          <span className="soundboard-group-label">{username}</span>
          <div className="soundboard-grid">
            {snds.map(sound => renderSound(sound, ""))}
          </div>
        </div>
      ))}
    </div>
  );
}
