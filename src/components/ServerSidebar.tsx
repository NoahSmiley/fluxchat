import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { FluxLogo } from "./FluxLogo.js";
import { Settings, ShoppingBag } from "lucide-react";
import { useUIStore } from "../stores/ui.js";
import { avatarColor, ringClass, ringGradientStyle } from "../lib/avatarColor.js";
import { UserCard } from "./MemberList.js";
import ContextMenu from "./ContextMenu.js";

export function ServerSidebar() {
  const { servers, showingDMs, showDMs, selectServer, members, onlineUsers, userStatuses, userActivities, openDM } = useChatStore();
  const { user } = useAuthStore();
  const showingEconomy = useUIStore((s) => s.showingEconomy);
  const showDummyUsers = useUIStore((s) => s.showDummyUsers);

  // Member avatar + user card state
  const [activeCardUserId, setActiveCardUserId] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<{ top?: number; right?: number; left?: number; bottom?: number }>({ top: 0 });
  const [avatarCtxMenu, setAvatarCtxMenu] = useState<{ x: number; y: number; userId: string } | null>(null);
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

      {sortedMembers.length >= 0 && (
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
                  onMouseEnter={(e) => handleAvatarEnter(e, m.userId)}
                  onMouseLeave={handleAvatarLeave}
                  onClick={(e) => handleAvatarClick(e, m.userId)}
                  onContextMenu={!isSelf ? (e) => { e.preventDefault(); e.stopPropagation(); setAvatarCtxMenu({ x: e.clientX, y: e.clientY, userId: m.userId }); } : undefined}
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
            {/* DEBUG: dummy sidebar avatars — online first, offline at bottom */}
            {showDummyUsers && [
              { userId: "__s1", username: "xKira", ringStyle: "sapphire", ringSpin: true, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=1", online: true },
              { userId: "__s2", username: "Blaze", ringStyle: "ruby", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=8", online: true },
              { userId: "__s3", username: "PhaseShift", ringStyle: "chroma", ringSpin: true, ringPatternSeed: null, role: "owner", image: "https://i.pravatar.cc/64?img=12", online: true },
              { userId: "__s4", username: "Cosmo", ringStyle: "emerald", ringSpin: false, ringPatternSeed: null, role: "admin", image: "https://i.pravatar.cc/64?img=15", online: true },
              { userId: "__s6", username: "Prism", ringStyle: "doppler", ringSpin: false, ringPatternSeed: 77, role: "member", image: "https://i.pravatar.cc/64?img=33", online: true },
              { userId: "__s7", username: "Nyx", ringStyle: "gamma_doppler", ringSpin: true, ringPatternSeed: 150, role: "member", image: "https://i.pravatar.cc/64?img=47", online: true },
              { userId: "__s8", username: "ZeroDay", ringStyle: "ruby", ringSpin: true, ringPatternSeed: null, role: "admin", image: "https://i.pravatar.cc/64?img=51", online: true },
              { userId: "__s9", username: "Voltex", ringStyle: "sapphire", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=5", online: true },
              { userId: "__s10", username: "Nova", ringStyle: "emerald", ringSpin: true, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=9", online: true },
              { userId: "__s11", username: "Cipher", ringStyle: "chroma", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=18", online: true },
              { userId: "__s12", username: "Wraith", ringStyle: "doppler", ringSpin: true, ringPatternSeed: 99, role: "member", image: "https://i.pravatar.cc/64?img=25", online: true },
              { userId: "__s14", username: "Flux", ringStyle: "ruby", ringSpin: true, ringPatternSeed: null, role: "owner", image: "https://i.pravatar.cc/64?img=36", online: true },
              { userId: "__s16", username: "Raze", ringStyle: "sapphire", ringSpin: true, ringPatternSeed: null, role: "admin", image: "https://i.pravatar.cc/64?img=44", online: true },
              { userId: "__s18", username: "Pixel", ringStyle: "chroma", ringSpin: true, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=52", online: true },
              { userId: "__s19", username: "Glitch", ringStyle: "doppler", ringSpin: false, ringPatternSeed: 55, role: "member", image: "https://i.pravatar.cc/64?img=56", online: true },
              { userId: "__s20", username: "Nexus", ringStyle: "gamma_doppler", ringSpin: true, ringPatternSeed: 120, role: "member", image: "https://i.pravatar.cc/64?img=60", online: true },
              // offline users at bottom
              { userId: "__s5", username: "ghost404", ringStyle: "default", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=22", online: false },
              { userId: "__s13", username: "Shade", ringStyle: "gamma_doppler", ringSpin: false, ringPatternSeed: 200, role: "member", image: "https://i.pravatar.cc/64?img=30", online: false },
              { userId: "__s15", username: "Ember", ringStyle: "default", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=41", online: false },
              { userId: "__s17", username: "Drift", ringStyle: "emerald", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=48", online: false },
            ].map((d) => {
              const rc = ringClass(d.ringStyle, d.ringSpin, d.role, false, d.ringPatternSeed);
              const hasRareGlow = rc.includes("ring-rare-glow");
              return (
                <div
                  key={d.userId}
                  className={`sidebar-member-avatar ${!d.online ? "offline" : ""}${hasRareGlow ? " has-rare-glow" : ""}`}
                  style={ringGradientStyle(d.ringPatternSeed, d.ringStyle) as React.CSSProperties}
                >
                  <div className={`member-avatar-ring ${rc}`} style={{ "--ring-color": avatarColor(d.username), ...ringGradientStyle(d.ringPatternSeed, d.ringStyle) } as React.CSSProperties}>
                    <div className="member-avatar" style={{ background: 'transparent' }}>
                      <img src={d.image} alt={d.username} className="avatar-img-sm" />
                    </div>
                  </div>
                  {d.online && <span className="avatar-status-indicator online" />}
                </div>
              );
            })}
            {/* END DEBUG */}
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

      {avatarCtxMenu && (
        <ContextMenu
          x={avatarCtxMenu.x}
          y={avatarCtxMenu.y}
          onClose={() => setAvatarCtxMenu(null)}
          items={[
            { label: "Message", onClick: () => { handleDMFromCard(avatarCtxMenu.userId); setAvatarCtxMenu(null); } },
          ]}
        />
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
