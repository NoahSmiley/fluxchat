import { useState, useRef } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { FluxLogo } from "./FluxLogo.js";
import { ArrowRight, Settings } from "lucide-react";
import { AvatarCropModal } from "./AvatarCropModal.js";
import { useUIStore } from "../stores/ui.js";

export function ServerSidebar() {
  const { servers, activeServerId, showingDMs, selectServer, createServer, joinServer, showDMs } = useChatStore();
  const { user, logout, updateProfile } = useAuthStore();
  const [showModal, setShowModal] = useState<"create" | "join" | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [input, setInput] = useState("");

  // Profile editing state
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    if (!input.trim()) return;
    if (showModal === "create") {
      await createServer(input.trim());
    } else if (showModal === "join") {
      await joinServer(input.trim());
    }
    setInput("");
    setShowModal(null);
  }

  function openProfile() {
    setShowProfile(true);
    setEditingUsername(false);
    setProfileError(null);
  }

  async function handleUsernameSubmit() {
    if (!usernameInput.trim() || usernameInput.trim() === user?.username) {
      setEditingUsername(false);
      return;
    }
    setProfileSaving(true);
    setProfileError(null);
    try {
      await updateProfile({ username: usernameInput.trim() });
      setEditingUsername(false);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to update username");
    } finally {
      setProfileSaving(false);
    }
  }

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setProfileError("Please select an image file");
      return;
    }

    setProfileError(null);
    const reader = new FileReader();
    reader.onload = () => setCropImage(reader.result as string);
    reader.onerror = () => setProfileError("Failed to read image");
    reader.readAsDataURL(file);

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCropConfirm(croppedDataUrl: string) {
    setCropImage(null);
    setProfileSaving(true);
    setProfileError(null);
    try {
      await updateProfile({ image: croppedDataUrl });
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleRemoveAvatar() {
    setProfileSaving(true);
    setProfileError(null);
    try {
      await updateProfile({ image: null });
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Failed to remove image");
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className="server-sidebar">
      <div className="server-sidebar-logo" title="Flux">
        <FluxLogo size={36} />
      </div>

      <button
        className={`server-icon dm-icon ${showingDMs ? "active" : ""}`}
        onClick={() => showDMs()}
        title="Direct Messages"
      >
        DM
      </button>

      <div className="server-sidebar-divider" />

      {servers.map((server) => (
        <button
          key={server.id}
          className={`server-icon ${server.id === activeServerId ? "active" : ""}`}
          onClick={() => selectServer(server.id)}
          title={server.name}
        >
          {server.name.charAt(0).toUpperCase()}
        </button>
      ))}

      <div className="server-sidebar-divider" />

      <button
        className="server-icon add-server"
        onClick={() => setShowModal("create")}
        title="Create Server"
      >
        +
      </button>

      <button
        className="server-icon add-server"
        onClick={() => setShowModal("join")}
        title="Join Server"
      >
        <ArrowRight size={20} />
      </button>

      <div className="server-sidebar-spacer" />

      <div className="server-sidebar-settings">
        <button
          className="server-sidebar-settings-btn"
          onClick={() => useUIStore.getState().openSettings()}
          title="User Settings"
        >
          <Settings size={18} />
        </button>
      </div>

      <div className="server-sidebar-user" onClick={openProfile} title={user?.username}>
        <div className="server-user-avatar">
          {user?.image ? (
            <img src={user.image} alt={user.username} className="server-user-avatar-img" />
          ) : (
            user?.username?.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      {showProfile && (
        <div className="modal-overlay" onClick={() => setShowProfile(false)}>
          <div className="modal profile-modal" onClick={(e) => e.stopPropagation()}>
            <h3>User Profile</h3>

            <div className="profile-avatar-section">
              <div className="profile-avatar-large">
                {user?.image ? (
                  <img src={user.image} alt={user.username} className="profile-avatar-img" />
                ) : (
                  <div className="profile-avatar-fallback">
                    {user?.username?.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="profile-avatar-actions">
                <button
                  className="btn-small btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={profileSaving}
                >
                  Upload Photo
                </button>
                {user?.image && (
                  <button
                    className="btn-small"
                    onClick={handleRemoveAvatar}
                    disabled={profileSaving}
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            <div className="profile-field">
              <label>Username</label>
              {editingUsername ? (
                <div className="profile-field-edit">
                  <input
                    type="text"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleUsernameSubmit();
                      if (e.key === "Escape") setEditingUsername(false);
                    }}
                    autoFocus
                    disabled={profileSaving}
                  />
                  <button className="btn-small btn-primary" onClick={handleUsernameSubmit} disabled={profileSaving}>
                    Save
                  </button>
                  <button className="btn-small" onClick={() => setEditingUsername(false)}>Cancel</button>
                </div>
              ) : (
                <div className="profile-field-display">
                  <span>{user?.username}</span>
                  <button
                    className="btn-small"
                    onClick={() => { setUsernameInput(user?.username ?? ""); setEditingUsername(true); }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>

            <div className="profile-field">
              <label>Email</label>
              <div className="profile-field-display">
                <span>{user?.email}</span>
              </div>
            </div>

            {profileError && <div className="profile-error">{profileError}</div>}

            <div className="profile-modal-footer">
              <button className="btn-small btn-danger" onClick={(e) => { e.stopPropagation(); logout(); }}>
                Sign Out
              </button>
              <button className="btn-small" onClick={() => setShowProfile(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {cropImage && (
        <AvatarCropModal
          imageUrl={cropImage}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropImage(null)}
        />
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{showModal === "create" ? "Create Server" : "Join Server"}</h3>
            <input
              type="text"
              placeholder={showModal === "create" ? "Server name" : "Invite code"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-small" onClick={() => setShowModal(null)}>Cancel</button>
              <button className="btn-primary btn-small" onClick={handleSubmit}>
                {showModal === "create" ? "Create" : "Join"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
