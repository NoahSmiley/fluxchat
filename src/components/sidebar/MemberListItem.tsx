import { memo } from "react";
import { avatarColor, ringClass, ringGradientStyle } from "@/lib/avatarColor.js";
import { Crown, Shield, Music, Gamepad2 } from "lucide-react";
import type { MemberWithUser, ActivityInfo, PresenceStatus } from "@/types/shared.js";

export function RoleBadge({ role }: { role: string }) {
  if (role === "owner") return <Crown size={10} className="role-badge owner" />;
  if (role === "admin") return <Shield size={10} className="role-badge admin" />;
  return null;
}

function ActivityTag({ activity }: { activity: ActivityInfo }) {
  const isListening = activity.activityType === "listening";
  return (
    <div className="member-activity-tag">
      {isListening ? <Music size={10} /> : <Gamepad2 size={10} />}
      <span>{isListening ? activity.artist ?? "Spotify" : activity.name}</span>
    </div>
  );
}

interface MemberListItemProps {
  member: MemberWithUser;
  isOnline: boolean;
  isSelected: boolean;
  isSelf: boolean;
  status?: PresenceStatus;
  activity?: ActivityInfo;
  onClick: (e: React.MouseEvent, userId: string) => void;
  onContextMenu: (e: React.MouseEvent, userId: string) => void;
}

export const MemberListItem = memo(function MemberListItem({
  member,
  isOnline,
  isSelected,
  isSelf,
  status,
  activity,
  onClick,
  onContextMenu,
}: MemberListItemProps) {
  const m = member;
  const color = avatarColor(m.username);

  return (
    <div
      className={`member-item ${!isOnline ? "offline" : ""} ${isSelected ? "selected" : ""}`}
      onClick={(e) => onClick(e, m.userId)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/flux-member", JSON.stringify({ userId: m.userId, username: m.username }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onContextMenu={(e) => onContextMenu(e, m.userId)}
    >
      <div
        className={`member-avatar-ring ${ringClass(m.ringStyle, m.ringSpin, m.role, !!activity, m.ringPatternSeed)}`}
        style={{ "--ring-color": color, ...ringGradientStyle(m.ringPatternSeed, m.ringStyle), position: "relative" } as React.CSSProperties}
      >
        <div className="member-avatar" style={{ background: m.image ? "transparent" : color }}>
          {m.image ? (
            <img
              src={m.image}
              alt={m.username}
              className="avatar-img-sm"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            (m.username ?? "?").charAt(0).toUpperCase()
          )}
        </div>
        {isOnline && status !== "offline" && (status !== "invisible" || isSelf) && (
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
});
