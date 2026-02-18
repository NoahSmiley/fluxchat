import { useState, useMemo, useRef, useEffect } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "../lib/avatarColor.js";
import { Crown, Shield, MessageSquare, Music, Gamepad2, ChevronDown } from "lucide-react";
import type { MemberWithUser, ActivityInfo, PresenceStatus } from "../types/shared.js";

const STATUS_OPTIONS: { value: PresenceStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do Not Disturb" },
  { value: "invisible", label: "Invisible" },
];

export function RoleBadge({ role }: { role: string }) {
  if (role === "owner") return <Crown size={10} className="role-badge owner" />;
  if (role === "admin") return <Shield size={10} className="role-badge admin" />;
  return null;
}

export function ActivityTag({ activity }: { activity: ActivityInfo }) {
  const isListening = activity.activityType === "listening";
  return (
    <div className="member-activity-tag">
      {isListening ? <Music size={10} /> : <Gamepad2 size={10} />}
      <span>{isListening ? activity.artist ?? "Spotify" : activity.name}</span>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
  offline: "Offline",
};

export function UserCard({
  member,
  activity,
  isOnline,
  status,
  position,
  onDM,
  isSelf,
}: {
  member: MemberWithUser;
  activity?: ActivityInfo;
  isOnline: boolean;
  status?: PresenceStatus;
  position: { top?: number; right?: number; left?: number; bottom?: number };
  onDM: () => void;
  isSelf: boolean;
}) {
  const color = avatarColor(member.username);
  const effectiveStatus = status ?? (isOnline ? "online" : "offline");
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const { setMyStatus } = useChatStore();

  return (
    <div
      className="user-card"
      style={{ top: position.top, right: position.right, left: position.left, bottom: position.bottom }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Banner — equipped banner or gradient from avatar color */}
      <div className="user-card-banner" style={{ background: bannerBackground(member.bannerCss, member.bannerPatternSeed) ?? `linear-gradient(135deg, ${color}, ${color}44)` }} />

      {/* Avatar */}
      <div className="user-card-avatar-wrapper">
        <div className={`user-card-avatar-ring ${ringClass(member.ringStyle, member.ringSpin, member.role, false, member.ringPatternSeed)} ${isOnline ? "online" : ""}`} style={{ "--ring-color": color, ...ringGradientStyle(member.ringPatternSeed, member.ringStyle) } as React.CSSProperties}>
          <div className="user-card-avatar" style={{ background: color }}>
            {member.image ? (
              <img src={member.image} alt={member.username} className="user-card-avatar-img" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              (member.username ?? "?").charAt(0).toUpperCase()
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="user-card-body">
        <div className="user-card-name">
          {member.username}
          <RoleBadge role={member.role} />
        </div>

        {isSelf ? (
          <div className="user-card-meta status-selector-wrapper">
            <button className="status-selector-btn" onClick={() => setShowStatusPicker(!showStatusPicker)}>
              <span className={`status-dot ${effectiveStatus}`} />
              {STATUS_LABELS[effectiveStatus] ?? "Offline"}
              <ChevronDown size={10} className={`status-chevron ${showStatusPicker ? "open" : ""}`} />
            </button>
            {showStatusPicker && (
              <div className="status-picker-dropdown">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`status-picker-option ${effectiveStatus === opt.value ? "active" : ""}`}
                    onClick={() => { setMyStatus(opt.value); setShowStatusPicker(false); }}
                  >
                    <span className={`status-dot ${opt.value}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <span className="user-card-joined">&middot; Joined {new Date(member.joinedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
          </div>
        ) : (
          <div className="user-card-meta">
            <span className={`status-dot ${effectiveStatus}`} />
            {STATUS_LABELS[effectiveStatus] ?? "Offline"} &middot; Joined {new Date(member.joinedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
          </div>
        )}

        {activity && (
          <div className="user-card-activity">
            {activity.activityType === "listening" ? (
              <>
                {activity.albumArt && <img src={activity.albumArt} alt="" className="user-card-album-art" />}
                <div className="user-card-activity-info">
                  <span className="user-card-activity-label">Listening to Spotify</span>
                  <span className="user-card-activity-name">{activity.name}</span>
                  {activity.artist && <span className="user-card-activity-artist">{activity.artist}</span>}
                </div>
              </>
            ) : (
              <div className="user-card-activity-info">
                <span className="user-card-activity-label">Playing</span>
                <span className="user-card-activity-name">{activity.name}</span>
              </div>
            )}
          </div>
        )}

        <div className="user-card-actions">
          <button className="user-card-dm-btn" onClick={onDM}>
            <MessageSquare size={12} />
            Message
          </button>
        </div>
      </div>
    </div>
  );
}

export function MemberList() {
  const { members, onlineUsers, userStatuses, userActivities, openDM, showDMs } = useChatStore();
  const { user } = useAuthStore();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState({ top: 0, right: 0 });
  const listRef = useRef<HTMLDivElement>(null);

  const { online, offline } = useMemo(() => {
    const online = members.filter((m) => onlineUsers.has(m.userId));
    const offline = members.filter((m) => !onlineUsers.has(m.userId));
    return { online, offline };
  }, [members, onlineUsers]);

  // Close card on outside click
  useEffect(() => {
    if (!selectedUserId) return;
    function handleClick() { setSelectedUserId(null); }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [selectedUserId]);

  function handleMemberClick(e: React.MouseEvent, userId: string) {
    e.stopPropagation();
    if (selectedUserId === userId) {
      setSelectedUserId(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const listRect = listRef.current?.getBoundingClientRect();
    const panelWidth = listRect?.width ?? 220;
    setCardPos({
      top: rect.top - (listRect?.top ?? 0),
      right: panelWidth + 8,
    });
    setSelectedUserId(userId);
  }

  function handleDM(userId: string) {
    setSelectedUserId(null);
    showDMs();
    openDM(userId);
  }

  const selectedMember = members.find((m) => m.userId === selectedUserId);

  return (
    <div className="member-list" ref={listRef}>
      {online.length > 0 && (
        <>
          <div className="member-section-label">{online.length} Online</div>
          {online.map((m) => {
            const activity = userActivities[m.userId];
            const status = userStatuses[m.userId] ?? "online";
            return (
              <div
                key={m.userId}
                className={`member-item ${selectedUserId === m.userId ? "selected" : ""}`}
                onClick={(e) => handleMemberClick(e, m.userId)}
              >
                <div className={`member-avatar-ring ${ringClass(m.ringStyle, m.ringSpin, m.role, !!activity, m.ringPatternSeed)}`} style={{ "--ring-color": avatarColor(m.username), ...ringGradientStyle(m.ringPatternSeed, m.ringStyle), position: "relative" } as React.CSSProperties}>
                  <div className="member-avatar" style={{ background: avatarColor(m.username) }}>
                    {m.image ? (
                      <img src={m.image} alt={m.username} className="avatar-img-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      (m.username ?? "?").charAt(0).toUpperCase()
                    )}
                  </div>
                  {status !== "offline" && status !== "invisible" && (
                    <span className={`avatar-status-indicator ${status}`} />
                  )}
                </div>
                <div className="member-info">
                  <span className="member-name">
                    {m.username}
                    <RoleBadge role={m.role} />
                  </span>
                  {activity && <ActivityTag activity={activity} />}
                </div>
              </div>
            );
          })}
        </>
      )}

      {offline.length > 0 && (
        <>
          <div className="member-section-label">{offline.length} Offline</div>
          {offline.map((m) => (
            <div
              key={m.userId}
              className={`member-item offline ${selectedUserId === m.userId ? "selected" : ""}`}
              onClick={(e) => handleMemberClick(e, m.userId)}
            >
              <div className={`member-avatar-ring ${ringClass(m.ringStyle, m.ringSpin, m.role, false, m.ringPatternSeed)}`} style={{ "--ring-color": avatarColor(m.username), ...ringGradientStyle(m.ringPatternSeed, m.ringStyle) } as React.CSSProperties}>
                <div className="member-avatar" style={{ background: avatarColor(m.username) }}>
                  {m.image ? (
                    <img src={m.image} alt={m.username} className="avatar-img-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    (m.username ?? "?").charAt(0).toUpperCase()
                  )}
                </div>
              </div>
              <div className="member-info">
                <span className="member-name">{m.username}
                  <RoleBadge role={m.role} />
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* User card popup */}
      {selectedMember && (
        <UserCard
          member={selectedMember}
          activity={userActivities[selectedMember.userId]}
          isOnline={onlineUsers.has(selectedMember.userId)}
          status={userStatuses[selectedMember.userId]}
          position={cardPos}
          onDM={() => handleDM(selectedMember.userId)}
          isSelf={selectedMember.userId === user?.id}
        />
      )}
    </div>
  );
}
