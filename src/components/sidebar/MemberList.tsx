import { useState, memo } from "react";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "@/lib/avatarColor.js";
import { MessageSquare, ChevronDown } from "lucide-react";
import type { MemberWithUser, ActivityInfo, PresenceStatus } from "@/types/shared.js";
import { RoleBadge } from "./MemberListItem.js";
import { useChatStore } from "@/stores/chat/index.js";

const STATUS_OPTIONS: { value: PresenceStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "idle", label: "Idle" },
  { value: "dnd", label: "Do Not Disturb" },
  { value: "invisible", label: "Invisible" },
];

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do Not Disturb",
  invisible: "Invisible",
  offline: "Offline",
};

export const UserCard = memo(function UserCard({
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
  const setMyStatus = useChatStore((s) => s.setMyStatus);

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
          <div className="user-card-avatar" style={{ background: member.image ? 'transparent' : color }}>
            {member.image ? (
              <img src={member.image} alt={member.username} className="user-card-avatar-img" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              (member.username ?? "?").charAt(0).toUpperCase()
            )}
          </div>
          {effectiveStatus !== "offline" && (effectiveStatus !== "invisible" || isSelf) && (
            <span className={`avatar-status-indicator ${effectiveStatus}`} />
          )}
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
});

