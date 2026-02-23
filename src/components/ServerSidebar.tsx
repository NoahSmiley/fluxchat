import { useState, useMemo, useEffect } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { FluxLogo } from "./FluxLogo.js";
import { Settings, ShoppingBag } from "lucide-react";
import { useUIStore } from "../stores/ui.js";
import { avatarColor, ringClass, ringGradientStyle } from "../lib/avatarColor.js";
import { UserCard } from "./MemberList.js";
import ContextMenu from "./ContextMenu.js";
import { useNotifStore } from "../stores/notifications.js";

export function ServerSidebar() {
  const { servers, showDMs, selectServer, members, onlineUsers, userStatuses, userActivities, openDM } = useChatStore();
  const { user } = useAuthStore();
  const showingEconomy = useUIStore((s) => s.showingEconomy);
  const sidebarPosition = useUIStore((s) => s.sidebarPosition);
  const notifStore = useNotifStore();

  const [activeCardUserId, setActiveCardUserId] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<{ top?: number; right?: number; left?: number; bottom?: number }>({ top: 0 });
  const [hoverTooltip, setHoverTooltip] = useState<{ username: string; style: React.CSSProperties } | null>(null);
  const [avatarCtxMenu, setAvatarCtxMenu] = useState<{ x: number; y: number; userId: string } | null>(null);

  const sortedMembers = useMemo(() => {
    const byName = (a: typeof members[0], b: typeof members[0]) =>
      (a.username ?? "").localeCompare(b.username ?? "");
    const others = members.filter((m) => m.userId !== user?.id);
    const online = others.filter((m) => onlineUsers.has(m.userId)).sort(byName);
    const offline = others.filter((m) => !onlineUsers.has(m.userId)).sort(byName);
    const me = members.find((m) => m.userId === user?.id);
    return me ? [me, ...online, ...offline] : [...online, ...offline];
  }, [members, onlineUsers, user?.id]);

  // Close card on outside click
  useEffect(() => {
    if (!activeCardUserId) return;
    function handleOutsideClick() { setActiveCardUserId(null); }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [activeCardUserId]);

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

  function computeTooltipStyle(el: HTMLElement): React.CSSProperties {
    const rect = el.getBoundingClientRect();
    const cy = rect.top + rect.height / 2;
    const cx = rect.left + rect.width / 2;
    if (sidebarPosition === "right") {
      return { left: rect.left - 8, top: cy, transform: "translate(-100%, -50%)" };
    } else if (sidebarPosition === "top") {
      return { left: cx, top: rect.bottom + 8, transform: "translateX(-50%)" };
    } else if (sidebarPosition === "bottom") {
      return { left: cx, top: rect.top - 8, transform: "translate(-50%, -100%)" };
    } else {
      return { left: rect.right + 8, top: cy, transform: "translateY(-50%)" };
    }
  }

  function handleAvatarEnter(e: React.MouseEvent, username: string) {
    setHoverTooltip({ username, style: computeTooltipStyle(e.currentTarget as HTMLElement) });
  }

  function handleAvatarLeave() {
    setHoverTooltip(null);
  }

  function handleAvatarClick(e: React.MouseEvent, userId: string) {
    e.stopPropagation();
    setHoverTooltip(null);
    if (activeCardUserId === userId) {
      setActiveCardUserId(null);
    } else {
      computeCardPos(e.currentTarget as HTMLElement);
      setActiveCardUserId(userId);
    }
  }

  function handleDMFromCard(userId: string) {
    setActiveCardUserId(null);
    showDMs();
    openDM(userId);
  }

  const activeCardMember = members.find((m) => m.userId === activeCardUserId);

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

      {sortedMembers.length > 0 && (
        <div className="sidebar-members">
            {sortedMembers.map((m) => {
              const isSelf = m.userId === user?.id;
              const isOnline = isSelf || onlineUsers.has(m.userId);
              const status = userStatuses[m.userId] ?? "offline";
              const activity = userActivities[m.userId];
              const rc = ringClass(m.ringStyle, m.ringSpin, m.role, !!activity, m.ringPatternSeed);
              const hasRareGlow = rc.includes("ring-rare-glow");
              return (
                <div
                  key={m.userId}
                  className={`sidebar-member-avatar ${isSelf ? "sticky-self" : ""} ${!isOnline ? "offline" : ""} ${activeCardUserId === m.userId ? "selected" : ""}${hasRareGlow ? " has-rare-glow" : ""}`}
                  style={ringGradientStyle(m.ringPatternSeed, m.ringStyle) as React.CSSProperties}
                  onMouseEnter={(e) => handleAvatarEnter(e, m.username)}
                  onMouseLeave={handleAvatarLeave}
                  onClick={(e) => handleAvatarClick(e, m.userId)}
                  onContextMenu={!isSelf ? (e) => { e.preventDefault(); e.stopPropagation(); setHoverTooltip(null); setAvatarCtxMenu({ x: e.clientX, y: e.clientY, userId: m.userId }); } : undefined}
                >
                  <div className={`member-avatar-ring ${rc}`} style={{ "--ring-color": avatarColor(m.username), ...ringGradientStyle(m.ringPatternSeed, m.ringStyle) } as React.CSSProperties}>
                    <div className="member-avatar" style={{ background: m.image ? 'transparent' : avatarColor(m.username) }}>
                      {m.image ? (
                        <img src={m.image} alt={m.username} className="avatar-img-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        (m.username ?? "?").charAt(0).toUpperCase()
                      )}
                    </div>
                  </div>
                  {status !== "offline" && (status !== "invisible" || isSelf) && (
                    <span className={`avatar-status-indicator ${status}`} />
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* User card popup */}
      {activeCardMember && (
        <div onClick={(e) => e.stopPropagation()}>
          <UserCard
            member={activeCardMember}
            activity={userActivities[activeCardMember.userId]}
            isOnline={onlineUsers.has(activeCardMember.userId)}
            status={userStatuses[activeCardMember.userId]}
            position={cardPos}
            onDM={() => handleDMFromCard(activeCardMember.userId)}
            isSelf={activeCardMember.userId === user?.id}
          />
        </div>
      )}

      {/* Username hover tooltip */}
      {hoverTooltip && (
        <div className="avatar-name-tooltip" style={hoverTooltip.style}>
          {hoverTooltip.username}
        </div>
      )}

      {avatarCtxMenu && (() => {
        const isMuted = notifStore.isUserMuted(avatarCtxMenu.userId);
        return (
          <ContextMenu
            x={avatarCtxMenu.x}
            y={avatarCtxMenu.y}
            onClose={() => setAvatarCtxMenu(null)}
            items={[
              { label: "Message", onClick: () => { handleDMFromCard(avatarCtxMenu.userId); setAvatarCtxMenu(null); } },
              { type: "separator" },
              {
                label: isMuted ? "Unmute user" : "Mute user",
                onClick: () => {
                  if (isMuted) notifStore.unmuteUser(avatarCtxMenu.userId);
                  else notifStore.muteUser(avatarCtxMenu.userId);
                  setAvatarCtxMenu(null);
                },
              },
            ]}
          />
        );
      })()}

      <div className="server-sidebar-spacer" />

      <div className="server-sidebar-settings">
        <button
          className={`server-sidebar-settings-btn ${showingEconomy ? "active" : ""}`}
          onClick={() => useUIStore.getState().toggleEconomy()}
          title="FluxFloat"
        >
          <ShoppingBag size={18} />
        </button>
        <button
          className="server-sidebar-settings-btn"
          onClick={() => useUIStore.getState().openSettings()}
          title="User Settings"
        >
          <Settings size={18} />
        </button>
      </div>

    </div>
  );
}
