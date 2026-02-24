import { useState } from "react";
import type { Channel, MemberWithUser } from "@/types/shared.js";
import { useVoiceStore } from "@/stores/voice/index.js";
import { useAuthStore } from "@/stores/auth.js";
import { ChevronRight, Plus } from "lucide-react";
import { gateway } from "@/lib/ws.js";
import { ringClass, ringGradientStyle, bannerBackground } from "@/lib/avatarColor.js";
import * as api from "@/lib/api/index.js";
import { dbg } from "@/lib/debug.js";
import { VoiceUserRow } from "@/components/voice/VoiceUserRow.js";
import { AnimatedList } from "@/components/AnimatedList.js";
import type { VoiceUser } from "@/stores/voice/types.js";
import {
  ANIMATED_LIST_DURATION_MS,
  CollapsedAvatars,
  RoomRenameInput,
  LockToggleButton,
} from "./JoinVoiceHelpers.js";

interface JoinVoiceSectionProps {
  channels: Channel[];
  rooms: Channel[];
  activeServerId: string;
  isOwnerOrAdmin: boolean;
  members: MemberWithUser[];
  channelParticipants: Record<string, { userId: string; username: string; drinkCount: number }[]>;
  connectedChannelId: string | null;
  connecting: boolean;
  screenSharers: { participantId: string }[];
  voiceParticipants: VoiceUser[];
  selectChannel: (id: string) => void;
  onRoomContextMenu: (e: React.MouseEvent, room: Channel) => void;
  onUserContextMenu: (e: React.MouseEvent, userId: string, username: string, channelId: string) => void;
  renamingRoomId: string | null;
  setRenamingRoomId: (id: string | null) => void;
}

export function JoinVoiceSection({
  channels,
  rooms,
  activeServerId,
  isOwnerOrAdmin,
  members,
  channelParticipants,
  connectedChannelId,
  connecting,
  screenSharers,
  voiceParticipants,
  selectChannel,
  onRoomContextMenu,
  onUserContextMenu,
  renamingRoomId,
  setRenamingRoomId,
}: JoinVoiceSectionProps) {
  const { user } = useAuthStore();
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set());
  const [dragHighlightRoom, setDragHighlightRoom] = useState<string | null>(null);

  const isInVoice = !!connectedChannelId || connecting;
  const voiceChannels = channels.filter((c) => c.type === "voice");

  const voiceWithUsers = voiceChannels
    .map((c) => {
      const participants = channelParticipants[c.id] ?? [];
      return { channel: c, participants };
    })
    .filter((r) => r.participants.length > 0 || connectedChannelId === r.channel.id);

  const screenSharerIds = new Set(screenSharers.map((s) => s.participantId));

  return (
    <div className="join-voice-section">
      <div className="voice-room-users-list">
        <AnimatedList
          items={voiceWithUsers.map(({ channel: vc, participants }) => ({ key: vc.id, channel: vc, participants }))}
          duration={ANIMATED_LIST_DURATION_MS}
          renderItem={({ channel: vc, participants }, state) => {
            const isRoomCollapsed = collapsedRooms.has(vc.id);
            const isCurrent = connectedChannelId === vc.id;
            const isLocked = !!vc.isLocked;
            const wrapperClass = state === "exiting" ? "voice-room-exit" : state === "entering" ? "voice-room-enter" : "";
            return (
              <div key={vc.id} className={`voice-room-group-wrapper ${wrapperClass}`}>
                <div
                  className={`voice-room-group ${isCurrent ? "voice-room-current" : ""}${dragHighlightRoom === vc.id ? " voice-room-drop-target" : ""}${isLocked ? " voice-room-locked" : ""}`}
                  onClick={() => {
                    if (vc.isLocked && vc.creatorId !== user?.id && !isOwnerOrAdmin) {
                      gateway.send({ type: "room_knock", channelId: vc.id });
                      return;
                    }
                    selectChannel(vc.id);
                    useVoiceStore.getState().joinVoiceChannel(vc.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRoomContextMenu(e, vc);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/flux-member")) {
                      e.preventDefault();
                      setDragHighlightRoom(vc.id);
                    }
                  }}
                  onDragLeave={() => setDragHighlightRoom(null)}
                  onDrop={(e) => {
                    setDragHighlightRoom(null);
                    try {
                      const data = JSON.parse(e.dataTransfer.getData("application/flux-member"));
                      if (data.userId && activeServerId) {
                        api.inviteToRoom(activeServerId, vc.id, data.userId).catch(() => {});
                      }
                    } catch {}
                  }}
                >
                  <div className="voice-room-group-inner">
                    <div className="voice-room-group-header">
                      <button
                        className="voice-room-collapse-toggle"
                        onClick={(e) => { e.stopPropagation(); setCollapsedRooms((prev) => {
                          const next = new Set(prev);
                          if (next.has(vc.id)) next.delete(vc.id); else next.add(vc.id);
                          return next;
                        }); }}
                      >
                        <ChevronRight size={10} className={`voice-room-chevron ${isRoomCollapsed ? "" : "voice-room-chevron-open"}`} />
                      </button>
                      <div className={`voice-room-group-label ${!isCurrent ? "voice-room-group-label-joinable" : ""}`}>
                        {renamingRoomId === vc.id ? (
                          <RoomRenameInput
                            channel={vc}
                            activeServerId={activeServerId}
                            onDone={() => setRenamingRoomId(null)}
                          />
                        ) : (
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vc.name}</span>
                        )}
                        <span className="voice-room-group-count">{participants.length}</span>
                        {(vc.creatorId === user?.id || isOwnerOrAdmin) && (
                          <LockToggleButton channel={vc} activeServerId={activeServerId} />
                        )}
                      </div>
                    </div>
                    {isRoomCollapsed ? (
                      <CollapsedAvatars participants={participants} members={members} />
                    ) : isInVoice ? (
                      <div className="voice-room-detailed">
                        {participants.map((p) => {
                          const member = members.find((m) => m.userId === p.userId);
                          const voiceUser = connectedChannelId === vc.id ? voiceParticipants.find((v) => v.userId === p.userId) : null;
                          return (
                            <VoiceUserRow
                              key={p.userId}
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
                              onContextMenu={isOwnerOrAdmin ? (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onUserContextMenu(e, p.userId, p.username, vc.id);
                              } : undefined}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <CollapsedAvatars participants={participants} members={members} />
                    )}
                  </div>
                </div>
              </div>
            );
          }}
        />
      </div>

      {!(connectedChannelId && (channelParticipants[connectedChannelId]?.length ?? 0) <= 1) && <button
        className="create-room-btn"
        onClick={async () => {
          if (!activeServerId) return;
          const cp = useVoiceStore.getState().channelParticipants;
          const activeRoomNames = new Set(rooms.filter((r) => (cp[r.id]?.length ?? 0) > 0 || connectedChannelId === r.id).map((r) => r.name));
          let n = 1;
          while (activeRoomNames.has(`Room ${n}`)) n++;
          const name = `Room ${n}`;
          try {
            const newRoom = await api.createRoom(activeServerId, name);
            selectChannel(newRoom.id);
            useVoiceStore.getState().joinVoiceChannel(newRoom.id);
          } catch (err) {
            dbg("ui", "Failed to create room:", err);
          }
        }}
      >
        <Plus size={14} />
        <span>Create Room</span>
      </button>}
    </div>
  );
}
