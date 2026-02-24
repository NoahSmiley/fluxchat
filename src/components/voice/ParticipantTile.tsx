import type { ReactNode } from "react";
import { useVoiceStore } from "../../stores/voice.js";
import { avatarColor } from "../../lib/avatarColor.js";

export interface ParticipantTileProps {
  userId: string;
  username: string;
  banner?: string;
  children: ReactNode;
}

/** Wraps a participant tile so the speaking class updates via store subscription, not parent re-render */
export function ParticipantTile({ userId, username, banner, children }: ParticipantTileProps) {
  const speaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  const color = avatarColor(username);
  return (
    <div
      className={`voice-participant-tile ${speaking ? "speaking" : ""} ${banner ? "has-banner" : ""}`}
      style={{
        "--ring-color": color,
        ...(banner ? { "--tile-banner": banner } : {}),
      } as React.CSSProperties}
    >
      {banner && <div className="voice-tile-banner" />}
      {children}
    </div>
  );
}
