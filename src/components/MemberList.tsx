import { useMemo } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";

export function MemberList() {
  const { members, onlineUsers, userActivities, openDM, showDMs } = useChatStore();
  const { user } = useAuthStore();

  const { online, offline } = useMemo(() => {
    const online = members.filter((m) => onlineUsers.has(m.userId));
    const offline = members.filter((m) => !onlineUsers.has(m.userId));
    return { online, offline };
  }, [members, onlineUsers]);

  function handleMemberClick(userId: string) {
    if (userId === user?.id) return;
    showDMs();
    openDM(userId);
  }

  return (
    <div className="member-list">
      {online.length > 0 && (
        <>
          <div className="member-list-category">Online — {online.length}</div>
          {online.map((m) => {
            const activity = userActivities[m.userId];
            return (
              <div key={m.userId} className="member-list-item" onClick={() => handleMemberClick(m.userId)}>
                <div className="member-avatar-wrapper">
                  <div className="member-avatar">
                    {m.image && <img src={m.image} alt={m.username} className="avatar-img-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                    {m.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="member-status-dot" />
                </div>
                <div className="member-info">
                  <span className="member-name">{m.username}</span>
                  {activity && (
                    <span className="member-activity">
                      {activity.activityType === "listening"
                        ? "Listening to Spotify"
                        : <>Playing <strong>{activity.name}</strong></>
                      }
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
      {offline.length > 0 && (
        <>
          <div className="member-list-category">Offline — {offline.length}</div>
          {offline.map((m) => (
            <div key={m.userId} className="member-list-item offline" onClick={() => handleMemberClick(m.userId)}>
              <div className="member-avatar-wrapper">
                <div className="member-avatar">
                  {m.image ? (
                    <img src={m.image} alt={m.username} className="avatar-img-sm" />
                  ) : (
                    m.username.charAt(0).toUpperCase()
                  )}
                </div>
              </div>
              <div className="member-info">
                <span className="member-name">{m.username}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
