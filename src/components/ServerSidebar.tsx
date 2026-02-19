import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { FluxLogo } from "./FluxLogo.js";
import { Settings, ShoppingBag } from "lucide-react";
import { useUIStore } from "../stores/ui.js";
import { avatarColor, ringClass, ringGradientStyle } from "../lib/avatarColor.js";
import { UserCard } from "./MemberList.js";

export function ServerSidebar() {
  const { servers, showingDMs, showDMs, selectServer, members, onlineUsers, userStatuses, userActivities, openDM } = useChatStore();
  const { user } = useAuthStore();
  const showingEconomy = useUIStore((s) => s.showingEconomy);

  // Member avatar + user card state
  const [activeCardUserId, setActiveCardUserId] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<{ top?: number; right?: number; left?: number; bottom?: number }>({ top: 0 });
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardHoveredRef = useRef(false);
  const sidebarPosition = useUIStore((s) => s.sidebarPosition);
  const useClickMode = sidebarPosition === "left";

  const sortedMembers = useMemo(() => {
    const byName = (a: typeof members[0], b: typeof members[0]) =>
      (a.username ?? "").localeCompare(b.username ?? "");
    const others = members.filter((m) => m.userId !== user?.id);
    const online = others.filter((m) => onlineUsers.has(m.userId)).sort(byName);
    const offline = others.filter((m) => !onlineUsers.has(m.userId)).sort(byName);
    const me = members.find((m) => m.userId === user?.id);
    return me ? [me, ...online, ...offline] : [...online, ...offline];
  }, [members, onlineUsers, user?.id]);

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
                  className={`sidebar-member-avatar ${!isOnline ? "offline" : ""} ${activeCardUserId === m.userId ? "selected" : ""}${hasRareGlow ? " has-rare-glow" : ""}`}
                  style={ringGradientStyle(m.ringPatternSeed, m.ringStyle) as React.CSSProperties}
                  onMouseEnter={(e) => handleAvatarEnter(e, m.userId)}
                  onMouseLeave={handleAvatarLeave}
                  onClick={(e) => handleAvatarClick(e, m.userId)}
                >
                  <div className={`member-avatar-ring ${rc}`} style={{ "--ring-color": avatarColor(m.username), ...ringGradientStyle(m.ringPatternSeed, m.ringStyle) } as React.CSSProperties}>
                    <div className="member-avatar" style={{ background: avatarColor(m.username) }}>
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
        <div onClick={(e) => e.stopPropagation()} onMouseEnter={handleCardEnter} onMouseLeave={handleCardLeave}>
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
