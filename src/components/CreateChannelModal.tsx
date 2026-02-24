import { useState, type FormEvent } from "react";
import type { ChannelType } from "../types/shared.js";
import * as api from "../lib/api.js";
import { useChatStore } from "../stores/chat.js";
import { Folder } from "lucide-react";

interface Props {
  serverId: string;
  defaultType: ChannelType;
  parentId?: string;
  onClose: () => void;
}

const MAX_CATEGORY_DEPTH = 3;

export function CreateChannelModal({ serverId, defaultType, parentId, onClose }: Props) {
  const channels = useChatStore((s) => s.channels);

  // Compute depth of the parent category (0 = root)
  let parentDepth = 0;
  if (parentId) {
    let current = parentId;
    while (current) {
      parentDepth++;
      const ch = channels.find((c) => c.id === current);
      current = ch?.parentId ?? "";
    }
  }
  const canCreateCategory = parentDepth < MAX_CATEGORY_DEPTH;

  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>(
    defaultType === "category" && !canCreateCategory ? "text" : defaultType
  );
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
        ...(parentId ? { parentId } : {}),
      });
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
          {canCreateCategory && (
            <button
              className={`channel-type-option ${type === "category" ? "selected" : ""}`}
              onClick={() => setType("category")}
              type="button"
            >
              <Folder size={16} style={{ display: "inline", verticalAlign: "middle" }} /> Category
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <span>Channel Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
              placeholder={type === "category" ? "category-name" : "new-channel"}
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
