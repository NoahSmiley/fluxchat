import { useState, type FormEvent } from "react";
import type { ChannelType } from "../types/shared.js";
import * as api from "../lib/api.js";
import { useChatStore } from "../stores/chat.js";
import { Volume2, Lock } from "lucide-react";

interface Props {
  serverId: string;
  defaultType: ChannelType;
  onClose: () => void;
}

export function CreateChannelModal({ serverId, defaultType, onClose }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>(defaultType);
  const [encrypted, setEncrypted] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setError("");

    try {
      const channel = await api.createChannel(serverId, {
        name: name.trim(),
        type,
        ...(type === "text" && encrypted ? { encrypted: true } : {}),
      });
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
            onClick={() => { setType("text"); }}
            type="button"
          >
            # Text
          </button>
          <button
            className={`channel-type-option ${type === "voice" ? "selected" : ""}`}
            onClick={() => { setType("voice"); setEncrypted(false); }}
            type="button"
          >
            <Volume2 size={16} style={{ display: "inline", verticalAlign: "middle" }} /> Voice
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <span>Channel Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
              placeholder={type === "text" ? "new-channel" : "voice-chat"}
              autoFocus
            />
          </div>

          {type === "text" && (
            <label className="encrypted-toggle" style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", cursor: "pointer", fontSize: 14 }}>
              <input
                type="checkbox"
                checked={encrypted}
                onChange={(e) => setEncrypted(e.target.checked)}
              />
              <Lock size={14} />
              <span>End-to-end encrypted</span>
            </label>
          )}
          {type === "text" && encrypted && (
            <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 8px" }}>
              Search will be limited to recent messages in encrypted channels.
            </p>
          )}

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
