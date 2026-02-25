import { useState } from "react";
import { Play, X } from "lucide-react";
import * as api from "@/lib/api/index.js";
import type { SoundboardSound, CustomEmoji } from "@/types/shared.js";
import { API_BASE } from "@/lib/serverUrl.js";
import { renderEmoji } from "@/lib/emoji.js";
import { previewSoundAudio } from "./SoundboardPanel.js";
import { lazy, Suspense } from "react";
const EmojiPicker = lazy(() => import("@/components/EmojiPicker.js"));

interface SoundboardEditFormProps {
  serverId: string;
  sound: SoundboardSound;
  customEmojis: CustomEmoji[];
  onSave: (updated: SoundboardSound) => void;
  onCancel: () => void;
}

export function SoundboardEditForm({ serverId, sound, customEmojis, onSave, onCancel }: SoundboardEditFormProps) {
  const [editName, setEditName] = useState(sound.name);
  const [editEmoji, setEditEmoji] = useState(sound.emoji ?? "");
  const [editVolume, setEditVolume] = useState(sound.volume);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const audioUrl = `${API_BASE}/files/${sound.audioAttachmentId}/${sound.audioFilename}`;

  async function handleEditSave() {
    if (!editName.trim()) return;
    setEditSaving(true);
    setEditError("");
    try {
      const updated = await api.updateSoundboardSound(serverId, sound.id, {
        name: editName.trim(),
        emoji: editEmoji.trim() || undefined,
        volume: editVolume,
      });
      onSave(updated);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="soundboard-add-form">
      <div className="soundboard-add-header">
        <h3>Edit Sound</h3>
        <button className="icon-btn" onClick={onCancel}><X size={16} /></button>
      </div>

      {editError && <div className="auth-error">{editError}</div>}

      {/* Audio file — locked */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Audio File</span>
        <div className="soundboard-file-locked">
          <span>{sound.audioFilename}</span>
        </div>
      </div>

      {/* Name */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Name</span>
        <input
          type="text"
          placeholder="e.g. Airhorn"
          value={editName}
          maxLength={32}
          onChange={(e) => setEditName(e.target.value)}
          className="settings-input"
          autoFocus
        />
      </div>

      {/* Emoji */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Emoji</span>
        <div style={{ position: "relative", display: "inline-block" }}>
          <div
            className="emoji-picker-trigger"
            onClick={() => setShowEmojiPicker((o) => !o)}
            title="Choose emoji"
          >
            {editEmoji
              ? <span dangerouslySetInnerHTML={{ __html: renderEmoji(editEmoji, customEmojis, API_BASE) }} />
              : <span className="emoji-placeholder">🎵</span>}
          </div>
          {showEmojiPicker && (
            <Suspense fallback={null}>
              <EmojiPicker
                serverId={serverId}
                placement="right"
                onSelect={(e) => { setEditEmoji(e); setShowEmojiPicker(false); }}
                onClose={() => setShowEmojiPicker(false)}
              />
            </Suspense>
          )}
        </div>
      </div>

      {/* Volume */}
      <div className="settings-row settings-row-col">
        <span className="settings-row-label">Volume — {Math.round(editVolume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={editVolume}
          onChange={(e) => setEditVolume(parseFloat(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          className="btn-small"
          onClick={() => previewSoundAudio(audioUrl, editVolume)}
        >
          <Play size={12} /> Preview
        </button>
        <button
          className="btn-small btn-primary"
          onClick={handleEditSave}
          disabled={editSaving || !editName.trim()}
        >
          {editSaving ? "Saving..." : "Save Sound"}
        </button>
      </div>
    </div>
  );
}
