import { Play, Pencil, Trash2 } from "lucide-react";
import type { SoundboardSound, CustomEmoji } from "@/types/shared.js";
import { API_BASE } from "@/lib/serverUrl.js";
import { renderEmoji } from "@/lib/emoji.js";
import { previewSoundAudio } from "./SoundboardPanel.js";

interface SoundboardListItemProps {
  sound: SoundboardSound;
  customEmojis: CustomEmoji[];
  onEdit: (sound: SoundboardSound) => void;
  onDelete: (soundId: string) => void;
}

export function SoundboardListItem({ sound, customEmojis, onEdit, onDelete }: SoundboardListItemProps) {
  const audioUrl = `${API_BASE}/files/${sound.audioAttachmentId}/${sound.audioFilename}`;

  return (
    <div className="soundboard-list-item">
      <div className="soundboard-list-icon">
        {sound.emoji ? (
          <span className="soundboard-btn-emoji" dangerouslySetInnerHTML={{ __html: renderEmoji(sound.emoji, customEmojis, API_BASE) }} />
        ) : null}
      </div>
      <div className="soundboard-list-info">
        <span className="soundboard-list-name">{sound.name}</span>
        <span className="soundboard-list-vol">{Math.round(sound.volume * 100)}%</span>
      </div>
      <button
        className="icon-btn"
        title="Preview"
        onClick={() => previewSoundAudio(audioUrl, sound.volume)}
      >
        <Play size={13} />
      </button>
      <button
        className="icon-btn"
        title="Edit"
        onClick={() => onEdit(sound)}
      >
        <Pencil size={13} />
      </button>
      <button
        className="icon-btn danger"
        title="Delete"
        onClick={() => onDelete(sound.id)}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
