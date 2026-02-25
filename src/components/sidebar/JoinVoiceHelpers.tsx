import { memo } from "react";
import type { Channel, MemberWithUser } from "@/types/shared.js";
import { useChatStore } from "@/stores/chat/index.js";
import { Lock, LockOpen } from "lucide-react";
import * as api from "@/lib/api/index.js";
import { dbg } from "@/lib/debug.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "@/lib/avatarColor.js";
import { AnimatedList } from "@/components/AnimatedList.js";
import { VoiceUserRow } from "@/components/voice/VoiceUserRow.js";
import type { VoiceUser } from "@/stores/voice/types.js";

const LOCK_TOGGLE_DEBOUNCE_MS = 400;
const lockTimestamps = new Map<string, number>();

/** Optimistic lock toggle with debounce and API rollback. */
export function toggleRoomLock(channelId: string, serverId: string) {
  const current = useChatStore.getState().channels.find((c) => c.id === channelId);
  if (!current) return;
  const now = Date.now();
  const prev = lockTimestamps.get(channelId) ?? 0;
  if (now - prev < LOCK_TOGGLE_DEBOUNCE_MS) return;
  lockTimestamps.set(channelId, now);
  const newLocked = !current.isLocked;
  dbg("ui", `[lock] toggling room ${channelId} lock: ${current.isLocked} -> ${newLocked}`);
  useChatStore.setState((s) => ({
    channels: s.channels.map((c) => c.id === channelId ? { ...c, isLocked: newLocked } : c),
  }));
  api.updateChannel(serverId, channelId, { isLocked: newLocked }).catch((err) => {
    dbg("ui", "[lock] API failed:", err);
    useChatStore.setState((s) => ({
      channels: s.channels.map((c) => c.id === channelId ? { ...c, isLocked: !newLocked } : c),
    }));
  });
}

export const ANIMATED_LIST_DURATION_MS = 500;

export function CollapsedAvatars({ participants, members }: {
  participants: { userId: string; username: string }[];
  members: MemberWithUser[];
}) {
  return (
    <div className="voice-room-avatars">
      {participants.map((p) => {
        const member = members.find((m) => m.userId === p.userId);
        const image = member?.image;
        return (
          <span
            key={p.userId}
            className="voice-room-avatar"
            style={{ background: image ? "transparent" : avatarColor(p.username) }}
            title={p.username}
          >
            {image ? (
              <img src={image} alt={p.username} />
            ) : (
              p.username.charAt(0).toUpperCase()
            )}
          </span>
        );
      })}
    </div>
  );
}

export function RoomRenameInput({ channel, activeServerId, onDone }: {
  channel: Channel;
  activeServerId: string;
  onDone: () => void;
}) {
  function commit(val: string) {
    if (val && val !== channel.name) {
      api.updateChannel(activeServerId, channel.id, { name: val });
      useChatStore.setState((s) => ({
        channels: s.channels.map((c) => c.id === channel.id ? { ...c, name: val } : c),
      }));
    }
    onDone();
  }

  return (
    <input
      className="room-rename-input"
      autoFocus
      defaultValue={channel.name}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit((e.target as HTMLInputElement).value.trim());
        } else if (e.key === "Escape") {
          onDone();
        }
      }}
      onBlur={(e) => commit(e.target.value.trim())}
    />
  );
}

export function LockToggleButton({ channel, activeServerId }: {
  channel: Channel;
  activeServerId: string;
}) {
  return (
    <button
      className="room-lock-toggle visible"
      title={channel.isLocked ? "Unlock room" : "Lock room"}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (activeServerId) toggleRoomLock(channel.id, activeServerId);
      }}
    >
      {channel.isLocked ? <Lock size={14} /> : <LockOpen size={14} />}
    </button>
  );
}

const USER_ANIM_DURATION = 450;

/** Memoized component so the inner AnimatedList keeps its ref state across parent re-renders */
export const AnimatedUserRows = memo(function AnimatedUserRows({
  participants, members, connectedChannelId, channelId, voiceParticipants, screenSharerIds,
  isOwnerOrAdmin, onUserContextMenu,
}: {
  participants: { userId: string; username: string }[];
  members: MemberWithUser[];
  connectedChannelId: string | null;
  channelId: string;
  voiceParticipants: VoiceUser[];
  screenSharerIds: Set<string>;
  isOwnerOrAdmin: boolean;
  onUserContextMenu?: (e: React.MouseEvent, userId: string, username: string, channelId: string) => void;
}) {
  return (
    <AnimatedList
      items={participants.map((p) => ({ key: p.userId, ...p }))}
      duration={USER_ANIM_DURATION}
      renderItem={(p, animState) => {
        const member = members.find((m) => m.userId === p.userId);
        const voiceUser = connectedChannelId === channelId ? voiceParticipants.find((v) => v.userId === p.userId) : null;
        return (
          <div
            key={p.userId}
            className={`voice-user-animated ${animState === "exiting" ? "voice-user-exit" : animState === "entering" ? "voice-user-enter" : ""}`}
          >
            <VoiceUserRow
              userId={p.userId}
              username={p.username}
              image={member?.image}
              member={member}
              banner={bannerBackground(member?.bannerCss, member?.bannerPatternSeed)}
              ringStyle={{ ...ringGradientStyle(member?.ringPatternSeed, member?.ringStyle) } as React.CSSProperties}
              ringClassName={ringClass(member?.ringStyle, member?.ringSpin, member?.role, false, member?.ringPatternSeed)}
              isMuted={voiceUser?.isMuted}
              isDeafened={voiceUser?.isDeafened}
              isStreaming={screenSharerIds.has(p.userId)}
              onContextMenu={isOwnerOrAdmin && onUserContextMenu ? (e) => {
                e.preventDefault();
                e.stopPropagation();
                onUserContextMenu(e, p.userId, p.username, channelId);
              } : undefined}
            />
          </div>
        );
      }}
    />
  );
});
