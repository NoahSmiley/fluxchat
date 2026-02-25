import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "@/stores/auth.js";
import { avatarColor } from "@/lib/avatarColor.js";
import { AvatarCropModal } from "@/components/modals/AvatarCropModal.js";
import { ToggleSwitch } from "@/components/SettingsModal.js";
import type { RingStyle } from "@/types/shared.js";

const RING_STYLES: { value: RingStyle; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "chroma", label: "Chroma" },
  { value: "pulse", label: "Pulse" },
  { value: "wave", label: "Wave" },
  { value: "ember", label: "Ember" },
  { value: "frost", label: "Frost" },
  { value: "neon", label: "Neon" },
  { value: "galaxy", label: "Galaxy" },
  { value: "none", label: "None" },
];

export function ProfileTab() {
  const { user, updateProfile, logout } = useAuthStore(useShallow((s) => ({
    user: s.user, updateProfile: s.updateProfile, logout: s.logout,
  })));

  const color = useMemo(() => avatarColor(user?.username ?? ""), [user?.username]);

  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [ringSaving, setRingSaving] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (file.type === "image/gif") {
        handleCropConfirm(dataUrl);
      } else {
        setCropImage(dataUrl);
      }
    };
    reader.onerror = () => setProfileError("Failed to read image");
    reader.readAsDataURL(file);
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
    <>
      <div className="settings-card">
        <h3 className="settings-card-title">Avatar</h3>
        <div className="profile-avatar-section">
          <div className="profile-avatar-large" style={!user?.image ? { background: color, borderColor: color } : undefined}>
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
              accept="image/*,image/gif"
              onChange={handleAvatarUpload}
              style={{ display: "none" }}
            />
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Username</h3>
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
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{user?.username}</span>
            </div>
            <button
              className="btn-small"
              onClick={() => { setUsernameInput(user?.username ?? ""); setEditingUsername(true); }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Email</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{user?.email}</span>
          </div>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Avatar Ring</h3>
        <p className="settings-card-desc">Choose how your avatar ring appears to everyone.</p>

        <div className="ring-preview-container">
          <div className={`ring-preview-avatar-ring ring-style-${user?.ringStyle ?? "default"} ${(user?.ringSpin) ? "ring-spin-active" : ""}`} style={{ "--ring-color": color } as React.CSSProperties}>
            <div className="ring-preview-avatar" style={{ background: color }}>
              {user?.image ? (
                <img src={user.image} alt={user.username} className="ring-preview-img" />
              ) : (
                user?.username?.charAt(0).toUpperCase()
              )}
            </div>
          </div>
        </div>

        <div className="ring-style-picker">
          {RING_STYLES.map((rs) => (
            <button
              key={rs.value}
              className={`ring-style-option ${(user?.ringStyle ?? "default") === rs.value ? "active" : ""}`}
              disabled={ringSaving}
              onClick={async () => {
                setRingSaving(true);
                try { await updateProfile({ ringStyle: rs.value }); } catch {}
                setRingSaving(false);
              }}
            >
              <div className={`ring-style-swatch ring-style-${rs.value}`} style={{ "--ring-color": color } as React.CSSProperties} />
              <span className="ring-style-label">{rs.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Animation</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Spin</span>
            <span className="settings-row-desc">Continuously rotate your avatar ring</span>
          </div>
          <ToggleSwitch
            checked={user?.ringSpin ?? false}
            onChange={async (v) => {
              setRingSaving(true);
              try { await updateProfile({ ringSpin: v }); } catch {}
              setRingSaving(false);
            }}
          />
        </div>
      </div>

      {profileError && <div className="profile-error">{profileError}</div>}

      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Sign Out</span>
            <span className="settings-row-desc">Sign out of your account</span>
          </div>
          <button className="btn-small btn-danger" onClick={() => logout()}>Sign Out</button>
        </div>
      </div>

      {cropImage && (
        <AvatarCropModal
          imageUrl={cropImage}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropImage(null)}
        />
      )}
    </>
  );
}
