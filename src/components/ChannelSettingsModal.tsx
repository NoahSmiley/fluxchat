import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import type { Channel } from "../types/shared.js";
import * as api from "../lib/api.js";
import { useChatStore } from "../stores/chat.js";
import { useVoiceStore } from "../stores/voice.js";

interface Props {
  channel: Channel;
  serverId: string;
  onClose: () => void;
}

function DeleteConfirmDialog({
  channelName,
  isCategory,
  onConfirm,
  onCancel,
  deleting,
}: {
  channelName: string;
  isCategory: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText === channelName;

  return (
    <div className="modal-overlay" style={{ zIndex: 110 }} onClick={onCancel}>
      <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="delete-confirm-icon">
          <AlertTriangle size={32} />
        </div>
        <h3>Delete {isCategory ? "Category" : "Channel"}</h3>
        <p className="delete-confirm-text">
          Are you sure you want to delete <strong>#{channelName}</strong>?{" "}
          {isCategory
            ? "All channels inside this category and their messages will be permanently removed."
            : "All messages in this channel will be permanently removed."
          }{" "}
          This action cannot be undone.
        </p>
        <div className="delete-confirm-input">
          <label>Type <strong>{channelName}</strong> to confirm</label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={channelName}
            autoFocus
          />
        </div>
        <div className="delete-confirm-actions">
          <button type="button" className="btn-small" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!matches || deleting}
            onClick={onConfirm}
          >
            {deleting ? "Deleting..." : "Delete Channel"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChannelSettingsModal({ channel, serverId, onClose }: Props) {
  const [name, setName] = useState(channel.name);
  const [bitrate, setBitrate] = useState(channel.bitrate ?? 256_000);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const updates: { name?: string; bitrate?: number | null } = {};

      if (name.trim() !== channel.name) {
        updates.name = name.trim();
      }

      if (channel.type === "voice") {
        const newBitrate = bitrate;
        if (newBitrate !== (channel.bitrate ?? 256_000)) {
          updates.bitrate = newBitrate;
        }
      }

      if (Object.keys(updates).length > 0) {
        const updated = await api.updateChannel(serverId, channel.id, updates);
        // Update in chat store
        const { channels } = useChatStore.getState();
        useChatStore.setState({
          channels: channels.map((c) => (c.id === channel.id ? updated : c)),
        });

        // If bitrate changed and we're connected to this channel, apply live
        if (updates.bitrate !== undefined) {
          const { connectedChannelId, applyBitrate } = useVoiceStore.getState();
          if (connectedChannelId === channel.id) {
            applyBitrate(updates.bitrate ?? 256_000);
          }
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update channel");
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteChannel(serverId, channel.id);
      const { channels, activeChannelId, selectChannel } = useChatStore.getState();
      const remaining = channels.filter((c) => c.id !== channel.id);
      useChatStore.setState({ channels: remaining });

      // If this was the active channel, switch to another
      if (activeChannelId === channel.id && remaining.length > 0) {
        selectChannel(remaining[0].id);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete channel");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <>
      <div className="modal-overlay channel-settings-modal" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Channel Settings</h3>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSave}>
            <div className="field">
              <span>Channel Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))}
              />
            </div>

            {channel.type === "voice" && (
              <div className="channel-settings-section">
                <h4>Voice Settings</h4>
                <div className="channel-settings-row">
                  <div className="audio-setting-slider-label">
                    <label>Bitrate</label>
                    <span className="channel-settings-value">{bitrate / 1000} kbps</span>
                  </div>
                  <input
                    type="range"
                    min="8000"
                    max="384000"
                    step="8000"
                    value={bitrate}
                    onChange={(e) => setBitrate(parseInt(e.target.value))}
                    className="settings-slider"
                  />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>
                Delete Channel
              </button>
              <button type="button" className="btn-small" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving} style={{ width: "auto", padding: "8px 24px" }}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showDeleteConfirm && (
        <DeleteConfirmDialog
          channelName={channel.name}
          isCategory={channel.type === "category"}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          deleting={deleting}
        />
      )}
    </>
  );
}
