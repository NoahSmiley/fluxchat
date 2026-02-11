import { useState, type FormEvent } from "react";
import { AlertTriangle, Copy, Check, RefreshCw } from "lucide-react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";

interface Props {
  serverId: string;
  onClose: () => void;
}

function DeleteConfirmDialog({
  serverName,
  onConfirm,
  onCancel,
  deleting,
}: {
  serverName: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  const [confirmText, setConfirmText] = useState("");
  const matches = confirmText === serverName;

  return (
    <div className="modal-overlay" style={{ zIndex: 110 }} onClick={onCancel}>
      <div className="modal delete-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="delete-confirm-icon">
          <AlertTriangle size={32} />
        </div>
        <h3>Delete Server</h3>
        <p className="delete-confirm-text">
          Are you sure you want to delete <strong>{serverName}</strong>? All channels, messages, and data will be permanently removed. This action cannot be undone.
        </p>
        <div className="delete-confirm-input">
          <label>Type <strong>{serverName}</strong> to confirm</label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={serverName}
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
            {deleting ? "Deleting..." : "Delete Server"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ServerSettingsModal({ serverId, onClose }: Props) {
  const { servers, updateServer, deleteServer, leaveServer } = useChatStore();
  const { user } = useAuthStore();
  const server = servers.find((s) => s.id === serverId);

  const [name, setName] = useState(server?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const isOwner = server?.role === "owner";

  function copyInviteCode() {
    if (!server?.inviteCode) return;
    navigator.clipboard.writeText(server.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === server?.name) {
      onClose();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateServer(serverId, name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update server");
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteServer(serverId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete server");
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      await leaveServer(serverId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave server");
      setLeaving(false);
    }
  }

  if (!server) return null;

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal server-settings-modal" onClick={(e) => e.stopPropagation()}>
          <h3>Server Settings</h3>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSave}>
            {isOwner && (
              <div className="field">
                <span>Server Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            )}

            {!isOwner && (
              <div className="field">
                <span>Server Name</span>
                <div className="server-settings-value">{server.name}</div>
              </div>
            )}

            <div className="field">
              <span>Invite Code</span>
              <div className="server-settings-invite">
                <code>{server.inviteCode}</code>
                <button type="button" className="btn-icon" onClick={copyInviteCode} title={copied ? "Copied!" : "Copy invite code"}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            <div className="field">
              <span>Owner</span>
              <div className="server-settings-value">
                {isOwner ? `${user?.username} (you)` : server.ownerId.slice(0, 8)}
              </div>
            </div>

            <div className="field">
              <span>Created</span>
              <div className="server-settings-value">{new Date(server.createdAt).toLocaleDateString()}</div>
            </div>

            <div className="modal-actions">
              {isOwner ? (
                <button type="button" className="btn-danger" onClick={() => setShowDeleteConfirm(true)}>
                  Delete Server
                </button>
              ) : (
                <button type="button" className="btn-danger" onClick={handleLeave} disabled={leaving}>
                  {leaving ? "Leaving..." : "Leave Server"}
                </button>
              )}
              <button type="button" className="btn-small" onClick={onClose}>
                Cancel
              </button>
              {isOwner && (
                <button type="submit" className="btn-primary" disabled={saving} style={{ width: "auto", padding: "8px 24px" }}>
                  {saving ? "Saving..." : "Save"}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {showDeleteConfirm && (
        <DeleteConfirmDialog
          serverName={server.name}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          deleting={deleting}
        />
      )}
    </>
  );
}
