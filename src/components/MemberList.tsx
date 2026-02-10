import { useMemo } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";

export function MemberList() {
  const { members, onlineUsers, openDM, showDMs } = useChatStore();
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
          {online.map((m) => (
            <div key={m.userId} className="member-list-item" onClick={() => handleMemberClick(m.userId)}>
              <div className="member-avatar online">
                {m.username.charAt(0).toUpperCase()}
              </div>
              <span className="member-name">{m.username}</span>
            </div>
          ))}
        </>
      )}
      {offline.length > 0 && (
        <>
          <div className="member-list-category">Offline — {offline.length}</div>
          {offline.map((m) => (
            <div key={m.userId} className="member-list-item offline" onClick={() => handleMemberClick(m.userId)}>
              <div className="member-avatar">
                {m.username.charAt(0).toUpperCase()}
              </div>
              <span className="member-name">{m.username}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
