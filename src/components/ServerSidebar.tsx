import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { FluxLogo } from "./FluxLogo.js";
import { ArrowRight, Settings } from "lucide-react";
import { AvatarCropModal } from "./AvatarCropModal.js";
import { useUIStore } from "../stores/ui.js";
import { avatarColor, ringClass } from "../lib/avatarColor.js";
import { UserCard } from "./MemberList.js";

export function ServerSidebar() {
  const { servers, showingDMs, joinServer, showDMs, selectServer, members, onlineUsers, userActivities, openDM } = useChatStore();
  const { user, logout, updateProfile } = useAuthStore();
  const myMember = members.find((m) => m.userId === user?.id);
  const myRole = myMember?.role ?? "member";
  const [showModal, setShowModal] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [input, setInput] = useState("");

  // Profile editing state
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Member avatar + user card state
  const [activeCardUserId, setActiveCardUserId] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<{ top?: number; right?: number; left?: number; bottom?: number }>({ top: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardHoveredRef = useRef(false);
  const sidebarPosition = useUIStore((s) => s.sidebarPosition);
  const useClickMode = sidebarPosition === "left";

  const sortedMembers = useMemo(() => {
    const online = members.filter((m) => onlineUsers.has(m.userId));
    const offline = members.filter((m) => !onlineUsers.has(m.userId));
    return [...online, ...offline];
  }, [members, onlineUsers]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
  }, []);

  // Close card on outside click (click mode only)
  useEffect(() => {
    if (!useClickMode || !activeCardUserId) return;
    function handleOutsideClick() { setActiveCardUserId(null); }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [useClickMode, activeCardUserId]);

  function computeCardPos(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    if (sidebarPosition === "right") {
      setCardPos({ top: rect.top, right: 72 });
    } else if (sidebarPosition === "top") {
      setCardPos({ top: rect.bottom + 8, left: rect.left });
    } else if (sidebarPosition === "bottom") {
      setCardPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left });
    } else {
      setCardPos({ top: rect.top });
    }
  }

  // Hover handlers (non-left orientations)
  function handleAvatarEnter(e: React.MouseEvent, userId: string) {
    if (useClickMode) return;
    clearHoverTimer();
    computeCardPos(e.currentTarget as HTMLElement);
    setActiveCardUserId(userId);
  }

  function handleAvatarLeave() {
    if (useClickMode) return;
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      if (!cardHoveredRef.current) setActiveCardUserId(null);
    }, 200);
  }

  function handleCardEnter() { if (!useClickMode) { clearHoverTimer(); cardHoveredRef.current = true; } }
  function handleCardLeave() {
    if (useClickMode) return;
    cardHoveredRef.current = false;
    hoverTimerRef.current = setTimeout(() => setActiveCardUserId(null), 200);
  }

  // Click handler — in left mode, toggle card; in other modes, go to DMs
  function handleAvatarClick(e: React.MouseEvent, userId: string) {
    if (useClickMode) {
      e.stopPropagation();
      if (activeCardUserId === userId) {
        setActiveCardUserId(null);
      } else {
        computeCardPos(e.currentTarget as HTMLElement);
        setActiveCardUserId(userId);
      }
    } else {
      setActiveCardUserId(null);
      showDMs();
      openDM(userId);
    }
  }

  function handleDMFromCard(userId: string) {
    setActiveCardUserId(null);
    showDMs();
    openDM(userId);
  }

  const activeCardMember = members.find((m) => m.userId === activeCardUserId);

  async function handleSubmit() {
    if (!input.trim()) return;
    await joinServer(input.trim());
    setInput("");
    setShowModal(false);
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
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // GIFs skip cropping (would lose animation)
      if (file.type === "image/gif") {
        handleCropConfirm(dataUrl);
      } else {
        setCropImage(dataUrl);
      }
    };
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
      <div
        className="server-sidebar-logo"
        title={servers.length > 0 ? servers[0].name : "Flux"}
        onClick={() => { if (servers.length > 0) selectServer(servers[0].id); }}
        style={{ cursor: servers.length > 0 ? "pointer" : "default" }}
      >
        <FluxLogo size={36} />
      </div>

      {servers.length === 0 && (
        <button
          className="server-icon add-server"
          onClick={() => setShowModal(true)}
          title="Join Server"
        >
          <ArrowRight size={20} />
        </button>
      )}

      {sortedMembers.length > 0 && (
        <div className="sidebar-members">
            {sortedMembers.map((m) => {
              const isOnline = onlineUsers.has(m.userId);
              const activity = userActivities[m.userId];
              const rc = ringClass(m.ringStyle, m.ringSpin, m.role, !!activity);
              return (
                <div
                  key={m.userId}
                  className={`sidebar-member-avatar ${!isOnline ? "offline" : ""} ${activeCardUserId === m.userId ? "selected" : ""}`}
                  onMouseEnter={(e) => handleAvatarEnter(e, m.userId)}
                  onMouseLeave={handleAvatarLeave}
                  onClick={(e) => handleAvatarClick(e, m.userId)}
                >
                  <div className={`member-avatar-ring ${rc}`} style={{ "--ring-color": avatarColor(m.username) } as React.CSSProperties}>
                    <div className="member-avatar" style={{ background: avatarColor(m.username) }}>
                      {m.image ? (
                        <img src={m.image} alt={m.username} className="avatar-img-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        (m.username ?? "?").charAt(0).toUpperCase()
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* User card popup */}
      {activeCardMember && (
        <div onClick={(e) => e.stopPropagation()} onMouseEnter={handleCardEnter} onMouseLeave={handleCardLeave}>
          <UserCard
            member={activeCardMember}
            activity={userActivities[activeCardMember.userId]}
            isOnline={onlineUsers.has(activeCardMember.userId)}
            position={cardPos}
            onDM={() => handleDMFromCard(activeCardMember.userId)}
            isSelf={activeCardMember.userId === user?.id}
            onSettings={activeCardMember.userId === user?.id ? openProfile : undefined}
          />
        </div>
      )}

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
                  accept="image/*,image/gif"
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
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Join Server</h3>
            <input
              type="text"
              placeholder="Invite code"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn-small" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn-primary btn-small" onClick={handleSubmit}>
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
