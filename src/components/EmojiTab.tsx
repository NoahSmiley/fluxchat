import { useState, useEffect, useRef } from "react";
import { Trash2, Upload } from "lucide-react";
import * as api from "../lib/api.js";
import type { CustomEmoji } from "../types/shared.js";
import { API_BASE } from "../lib/serverUrl.js";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";

const MAX_EMOJI_SIZE = 256 * 1024; // 256 KB
const NAME_REGEX = /^[a-zA-Z0-9_]{1,32}$/;

export function EmojiTab({ serverId }: { serverId: string }) {
  const fetchCustomEmojis = useChatStore((s) => s.fetchCustomEmojis);
  const user = useAuthStore((s) => s.user);
  const servers = useChatStore((s) => s.servers);
  const members = useChatStore((s) => s.members);

  const [emojis, setEmojis] = useState<CustomEmoji[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Upload form state
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const server = servers.find((s) => s.id === serverId);
  const myMember = members.find((m) => m.serverId === serverId && m.userId === user?.id);
  const isAdmin = myMember?.role === "admin" || myMember?.role === "owner" || server?.role === "admin" || server?.role === "owner";

  async function loadEmojis() {
    setLoading(true);
    try {
      const data = await api.getCustomEmojis(serverId);
      setEmojis(data);
    } catch {
      setError("Failed to load emojis");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmojis();
  }, [serverId]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadError("");
    if (f.size > MAX_EMOJI_SIZE) {
      setUploadError("File must be 256 KB or smaller");
      return;
    }
    if (!f.type.startsWith("image/")) {
      setUploadError("File must be an image");
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function handleUpload() {
    if (!file || !name.trim()) return;
    if (!NAME_REGEX.test(name.trim())) {
      setUploadError("Name must be 1–32 characters: letters, numbers, and underscores only");
      return;
    }
    setUploading(true);
    setUploadError("");
    setUploadProgress(0);
    try {
      const attachment = await api.uploadFile(file, (pct) => setUploadProgress(pct));
      const emoji = await api.createCustomEmoji(serverId, { name: name.trim(), attachmentId: attachment.id });
      setEmojis((prev) => [...prev, emoji]);
      // Update the chat store so the picker sees the new emoji immediately
      fetchCustomEmojis(serverId).catch(() => {});
      // Reset form
      setName("");
      setFile(null);
      setPreview(null);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(emojiId: string) {
    try {
      await api.deleteCustomEmoji(serverId, emojiId);
      setEmojis((prev) => prev.filter((e) => e.id !== emojiId));
      fetchCustomEmojis(serverId).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete emoji");
    }
  }

  if (loading) {
    return <div style={{ color: "var(--text-muted)", padding: 16 }}>Loading...</div>;
  }

  return (
    <>
      {error && <div className="auth-error">{error}</div>}

      {/* Upload form — admin/owner only */}
      {isAdmin && (
        <div className="settings-card">
          <h3 className="settings-card-title">Upload Emoji</h3>
          <p className="settings-card-desc">PNG, GIF, or WebP — max 256 KB. Name: letters, numbers, underscores, 1–32 chars.</p>

          <div className="emoji-upload-form">
            {/* Image picker */}
            <div
              className="emoji-upload-drop"
              onClick={() => fileInputRef.current?.click()}
            >
              {preview ? (
                <img src={preview} alt="preview" className="emoji-upload-preview" />
              ) : (
                <>
                  <Upload size={20} style={{ color: "var(--text-muted)" }} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Choose image</span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            {/* Name input + submit */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
              <input
                type="text"
                placeholder="emoji_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleUpload(); }}
                disabled={uploading}
                style={{ width: "100%" }}
              />
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="emoji-upload-progress">
                  <div className="emoji-upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}
              {uploadError && <div style={{ fontSize: 12, color: "var(--danger)" }}>{uploadError}</div>}
              <button
                className="btn-small btn-primary"
                onClick={handleUpload}
                disabled={!file || !name.trim() || uploading}
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emoji list */}
      <div className="settings-card">
        <h3 className="settings-card-title">Server Emojis ({emojis.length})</h3>
        {emojis.length === 0 ? (
          <p className="settings-card-desc" style={{ opacity: 0.5 }}>No custom emojis yet.</p>
        ) : (
          <div className="emoji-tab-list">
            {emojis.map((emoji) => {
              const url = `${API_BASE}/files/${emoji.attachmentId}/${emoji.filename}`;
              return (
                <div key={emoji.id} className="emoji-tab-row">
                  <img src={url} alt={`:${emoji.name}:`} className="emoji-tab-img" />
                  <div className="emoji-tab-info">
                    <span className="emoji-tab-name">:{emoji.name}:</span>
                    <span className="emoji-tab-uploader">
                      {emoji.uploaderImage ? (
                        <img src={emoji.uploaderImage} alt={emoji.uploaderUsername} className="emoji-tab-uploader-avatar" />
                      ) : null}
                      {emoji.uploaderUsername}
                    </span>
                  </div>
                  {isAdmin && (
                    <button
                      className="btn-small btn-danger"
                      onClick={() => handleDelete(emoji.id)}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
