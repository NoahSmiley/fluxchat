import { useState, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { MemberWithUser } from "@/types/shared.js";
import { useAuthStore } from "@/stores/auth.js";
import { useChatStore } from "@/stores/chat/index.js";
import { useDMStore } from "@/stores/dm/index.js";
import { useVoiceStore } from "@/stores/voice/index.js";
import { UserCard } from "@/components/sidebar/MemberList.js";
import { Mic, MicOff, HeadphoneOff, Radio } from "lucide-react";
import { avatarColor } from "@/lib/avatarColor.js";

/** Tiny component so only the mic icon re-renders when speaking state changes, not the whole sidebar */
function SpeakingMic({ userId, isMuted, isDeafened }: { userId: string; isMuted?: boolean; isDeafened?: boolean }) {
  const isSpeaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  if (isDeafened) {
    return <HeadphoneOff size={12} className="voice-speaking-mic deafened" />;
  }
  if (isMuted) {
    return <MicOff size={14} className={`voice-speaking-mic muted ${isSpeaking ? "active" : ""}`} />;
  }
  return <Mic size={14} className={`voice-speaking-mic ${isSpeaking ? "active" : ""}`} />;
}

/** Voice user row with hover-to-inspect UserCard */
export const VoiceUserRow = memo(function VoiceUserRow({
  userId, username, image, member, banner, ringStyle, ringClassName,
  isMuted, isDeafened, isStreaming, onContextMenu,
}: {
  userId: string;
  username: string;
  image?: string | null;
  member?: MemberWithUser;
  banner?: string;
  ringStyle: React.CSSProperties;
  ringClassName: string;
  isMuted?: boolean;
  isDeafened?: boolean;
  isStreaming?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const [showCard, setShowCard] = useState(false);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const rowRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAuthStore();
  const { onlineUsers, userStatuses, userActivities } = useChatStore(useShallow((s) => ({
    onlineUsers: s.onlineUsers, userStatuses: s.userStatuses, userActivities: s.userActivities,
  })));
  const { openDM, showDMs } = useDMStore(useShallow((s) => ({
    openDM: s.openDM, showDMs: s.showDMs,
  })));

  const cancelDismiss = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(() => {
    cancelDismiss();
    dismissTimer.current = setTimeout(() => {
      setShowCard(false);
    }, 100);
  }, [cancelDismiss]);

  const handleMouseEnter = () => {
    cancelDismiss();
    if (!member) return;
    hoverTimer.current = setTimeout(() => {
      if (rowRef.current) {
        const rect = rowRef.current.getBoundingClientRect();
        setCardPos({ top: rect.top - 40, left: rect.right + 8 });
        setShowCard(true);
      }
    }, 350);
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    scheduleDismiss();
  };

  const handleCardEnter = () => {
    cancelDismiss();
  };

  const handleCardLeave = () => {
    scheduleDismiss();
  };

  return (
    <>
      <div
        ref={rowRef}
        className="voice-channel-user"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={onContextMenu}
      >
        <span
          className={`voice-avatar-ring ${ringClassName}`}
          style={ringStyle}
        >
          <span className="voice-user-avatar" style={{ background: image ? 'transparent' : avatarColor(username) }}>
            {image ? (
              <img src={image} alt={username} />
            ) : (
              username.charAt(0).toUpperCase()
            )}
          </span>
        </span>
        <span className="voice-user-name">{username}</span>
        {isStreaming && <Radio size={12} className="voice-user-streaming-icon" />}
        <SpeakingMic userId={userId} isMuted={isMuted} isDeafened={isDeafened} />
      </div>
      {showCard && member && createPortal(
        <div
          ref={cardRef}
          className="voice-user-card-overlay"
          onMouseEnter={handleCardEnter}
          onMouseLeave={handleCardLeave}
        >
          <UserCard
            member={member}
            activity={userActivities[userId]}
            isOnline={onlineUsers.has(userId)}
            status={userStatuses[userId]}
            position={{ top: cardPos.top, left: cardPos.left }}
            onDM={() => { openDM(userId); showDMs(); setShowCard(false); }}
            isSelf={userId === user?.id}
          />
        </div>,
        document.body
      )}
    </>
  );
});
