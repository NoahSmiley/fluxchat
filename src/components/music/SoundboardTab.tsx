import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import * as api from "@/lib/api/index.js";
import type { SoundboardSound } from "@/types/shared.js";
import { useChatStore } from "@/stores/chat/index.js";
import { SoundboardAddForm } from "./SoundboardAddForm.js";
import { SoundboardEditForm } from "./SoundboardEditForm.js";
import { SoundboardListItem } from "./SoundboardListItem.js";

// ── Main SoundboardTab ────────────────────────────────────────────────────

type View = "list" | "add" | "edit";

export function SoundboardTab({ serverId }: { serverId: string }) {
  const customEmojis = useChatStore((s) => s.customEmojis);
  const [view, setView] = useState<View>("list");
  const [sounds, setSounds] = useState<SoundboardSound[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit state
  const [editingSound, setEditingSound] = useState<SoundboardSound | null>(null);

  useEffect(() => {
    api.getSoundboardSounds(serverId)
      .then((loadedSounds) => {
        setSounds(loadedSounds);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serverId]);

  async function handleDelete(soundId: string) {
    try {
      await api.deleteSoundboardSound(serverId, soundId);
      setSounds((prev) => prev.filter((s) => s.id !== soundId));
    } catch {
      // ignore
    }
  }

  function handleEditStart(sound: SoundboardSound) {
    setEditingSound(sound);
    setView("edit");
  }

  if (view === "edit" && editingSound) {
    return (
      <SoundboardEditForm
        serverId={serverId}
        sound={editingSound}
        customEmojis={customEmojis}
        onSave={(updated) => {
          setSounds((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
          setEditingSound(null);
          setView("list");
        }}
        onCancel={() => {
          setEditingSound(null);
          setView("list");
        }}
      />
    );
  }

  if (view === "add") {
    return (
      <SoundboardAddForm
        serverId={serverId}
        customEmojis={customEmojis}
        onSave={(sound) => {
          setSounds((prev) => [...prev, sound]);
          setView("list");
        }}
        onCancel={() => setView("list")}
      />
    );
  }

  return (
    <div className="soundboard-tab">
      <div className="soundboard-list-header">
        <p className="settings-card-desc">Sounds available in voice channels on this server.</p>
        <button className="btn-small btn-primary" onClick={() => setView("add")}>
          <Plus size={12} /> Add Sound
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>Loading...</p>
      ) : sounds.length === 0 ? (
        <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No sounds yet. Add one above.</p>
      ) : (
        <div className="soundboard-list">
          {sounds.map((sound) => (
            <SoundboardListItem
              key={sound.id}
              sound={sound}
              customEmojis={customEmojis}
              onEdit={handleEditStart}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
