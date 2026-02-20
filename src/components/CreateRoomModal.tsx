import { useState, type FormEvent } from "react";
import * as api from "../lib/api.js";

interface Props {
  serverId: string;
  onClose: () => void;
}

export function CreateRoomModal({ serverId, onClose }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setError("");

    try {
      await api.createRoom(serverId, name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
      setCreating(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create Room</h3>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <span>Room Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Chill Zone"
              autoFocus
              maxLength={64}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-small" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim() || creating} style={{ width: "auto", padding: "8px 24px" }}>
              {creating ? "Creating..." : "Create Room"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
