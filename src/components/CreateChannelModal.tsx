import { useState, type FormEvent } from "react";
import type { ChannelType } from "../types/shared.js";
import * as api from "../lib/api.js";
import { useChatStore } from "../stores/chat.js";
import { Volume2, Gamepad2 } from "lucide-react";

interface Props {
  serverId: string;
  defaultType: ChannelType;
  onClose: () => void;
}

export function CreateChannelModal({ serverId, defaultType, onClose }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>(defaultType);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setError("");

    try {
      const channel = await api.createChannel(serverId, { name: name.trim(), type });
      // Refresh channels list
      const { channels } = useChatStore.getState();
      useChatStore.setState({ channels: [...channels, channel] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
      setCreating(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create Channel</h3>

        {error && <div className="auth-error">{error}</div>}

        <div className="channel-type-select">
          <button
            className={`channel-type-option ${type === "text" ? "selected" : ""}`}
            onClick={() => setType("text")}
            type="button"
          >
            # Text
          </button>
          <button
            className={`channel-type-option ${type === "voice" ? "selected" : ""}`}
            onClick={() => setType("voice")}
            type="button"
          >
            <Volume2 size={16} style={{ display: "inline", verticalAlign: "middle" }} /> Voice
          </button>
          <button
            className={`channel-type-option ${type === "game" ? "selected" : ""}`}
            onClick={() => setType("game")}
            type="button"
          >
            <Gamepad2 size={16} style={{ display: "inline", verticalAlign: "middle" }} /> Game
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <span>Channel Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
              placeholder={type === "game" ? "counter-strike-2" : type === "text" ? "new-channel" : "voice-chat"}
              autoFocus
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-small" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim() || creating} style={{ width: "auto", padding: "8px 24px" }}>
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
