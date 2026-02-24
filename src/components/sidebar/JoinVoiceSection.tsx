import { useState } from "react";
import type { Channel, MemberWithUser } from "../../types/shared.js";
import { useChatStore } from "../../stores/chat.js";
import { useVoiceStore } from "../../stores/voice.js";
import { useUIStore } from "../../stores/ui.js";
import { useAuthStore } from "../../stores/auth.js";
import { ChevronRight, Lock, LockOpen, Plus } from "lucide-react";
import { gateway } from "../../lib/ws.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "../../lib/avatarColor.js";
import * as api from "../../lib/api.js";
import { dbg } from "../../lib/debug.js";
import { VoiceUserRow } from "../voice/VoiceUserRow.js";
import { AnimatedList } from "../AnimatedList.js";
import type { Participant } from "livekit-client";

const LOCK_TOGGLE_DEBOUNCE_MS = 400;
const ANIMATED_LIST_DURATION_MS = 500;

const DUMMY_VOICE_USERS = [
  { userId: "__d1", username: "xKira", drinkCount: 0 },
  { userId: "__d2", username: "Blaze", drinkCount: 0 },
  { userId: "__d3", username: "PhaseShift", drinkCount: 0 },
  { userId: "__d4", username: "Cosmo", drinkCount: 0 },
  { userId: "__d5", username: "ghost404", drinkCount: 0 },
  { userId: "__d6", username: "Prism", drinkCount: 0 },
  { userId: "__d7", username: "Nyx", drinkCount: 0 },
  { userId: "__d8", username: "ZeroDay", drinkCount: 0 },
];

function getDummyImages(showDummyUsers: boolean): Record<string, string> {
  if (!showDummyUsers) return {};
  return {
    __d1: "https://i.pravatar.cc/64?img=1", __d2: "https://i.pravatar.cc/64?img=8",
    __d3: "https://i.pravatar.cc/64?img=12", __d4: "https://i.pravatar.cc/64?img=15",
    __d5: "https://i.pravatar.cc/64?img=22", __d6: "https://i.pravatar.cc/64?img=33",
    __d7: "https://i.pravatar.cc/64?img=47", __d8: "https://i.pravatar.cc/64?img=51",
  };
}

function getDummyMembers(showDummyUsers: boolean) {
  if (!showDummyUsers) return [];
  return [
    { userId: "__d1", username: "xKira", image: "https://i.pravatar.cc/64?img=1", ringStyle: "sapphire", ringSpin: true, ringPatternSeed: null as number | null, bannerCss: "aurora", bannerPatternSeed: null as number | null, role: "member" },
    { userId: "__d2", username: "Blaze", image: "https://i.pravatar.cc/64?img=8", ringStyle: "ruby", ringSpin: false, ringPatternSeed: null as number | null, bannerCss: "sunset", bannerPatternSeed: null as number | null, role: "member" },
    { userId: "__d3", username: "PhaseShift", image: "https://i.pravatar.cc/64?img=12", ringStyle: "chroma", ringSpin: true, ringPatternSeed: null as number | null, bannerCss: "doppler", bannerPatternSeed: 42 as number | null, role: "owner" },
    { userId: "__d4", username: "Cosmo", image: "https://i.pravatar.cc/64?img=15", ringStyle: "emerald", ringSpin: false, ringPatternSeed: null as number | null, bannerCss: "space", bannerPatternSeed: null as number | null, role: "admin" },
    { userId: "__d5", username: "ghost404", image: "https://i.pravatar.cc/64?img=22", ringStyle: "default", ringSpin: false, ringPatternSeed: null as number | null, bannerCss: null as string | null, bannerPatternSeed: null as number | null, role: "member" },
    { userId: "__d6", username: "Prism", image: "https://i.pravatar.cc/64?img=33", ringStyle: "doppler", ringSpin: false, ringPatternSeed: 77 as number | null, bannerCss: "gamma_doppler", bannerPatternSeed: 77 as number | null, role: "member" },
    { userId: "__d7", username: "Nyx", image: "https://i.pravatar.cc/64?img=47", ringStyle: "gamma_doppler", ringSpin: true, ringPatternSeed: 150 as number | null, bannerCss: "cityscape", bannerPatternSeed: null as number | null, role: "member" },
    { userId: "__d8", username: "ZeroDay", image: "https://i.pravatar.cc/64?img=51", ringStyle: "ruby", ringSpin: true, ringPatternSeed: null as number | null, bannerCss: "doppler", bannerPatternSeed: 200 as number | null, role: "admin" },
  ];
}

export interface JoinVoiceSectionProps {
  channels: Channel[];
  rooms: Channel[];
  activeServerId: string;
  isOwnerOrAdmin: boolean;
  members: MemberWithUser[];
  channelParticipants: Record<string, { userId: string; username: string; drinkCount: number }[]>;
  connectedChannelId: string | null;
  connecting: boolean;
  screenSharers: { participantId: string }[];
  voiceParticipants: Participant[];
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
  const showDummyUsers = useUIStore((s) => s.showDummyUsers);
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set());
  const [dragHighlightRoom, setDragHighlightRoom] = useState<string | null>(null);

  const isInVoice = !!connectedChannelId || connecting;
  const voiceChannels = channels.filter((c) => c.type === "voice");

  const DUMMY_IMAGES = getDummyImages(showDummyUsers);
  const DUMMY_MEMBERS = getDummyMembers(showDummyUsers);

  const firstRoomId = voiceChannels.find((c) => c.isRoom)?.id;
  const voiceWithUsers = voiceChannels
    .map((c) => {
      const real = channelParticipants[c.id] ?? [];
      const isFirstRoom = c.isRoom && c.id === firstRoomId;
      const allParticipants = (showDummyUsers && isFirstRoom) ? [...DUMMY_VOICE_USERS, ...real] : real;
      return { channel: c, participants: allParticipants };
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
                      <CollapsedAvatars participants={participants} members={members} dummyImages={DUMMY_IMAGES} />
                    ) : isInVoice ? (
                      <div className="voice-room-detailed">
                        {showDummyUsers && voiceChannels.indexOf(vc) === 0 && DUMMY_MEMBERS.map((d) => (
                          <VoiceUserRow
                            key={d.userId}
                            userId={d.userId}
                            username={d.username}
                            image={d.image}
                            member={undefined}
                            banner={bannerBackground(d.bannerCss, d.bannerPatternSeed)}
                            ringStyle={{ ...ringGradientStyle(d.ringPatternSeed, d.ringStyle) } as React.CSSProperties}
                            ringClassName={ringClass(d.ringStyle, d.ringSpin, d.role, false, d.ringPatternSeed)}
                            isMuted={d.userId === "__d2"}
                            isDeafened={d.userId === "__d4"}
                          />
                        ))}
                        {participants.filter((p) => !p.userId.startsWith("__d")).map((p) => {
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
                      <CollapsedAvatars participants={participants} members={members} dummyImages={DUMMY_IMAGES} />
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

/* ---- Small helper sub-components ---- */

function CollapsedAvatars({ participants, members, dummyImages }: {
  participants: { userId: string; username: string }[];
  members: MemberWithUser[];
  dummyImages: Record<string, string>;
}) {
  return (
    <div className="voice-room-avatars">
      {participants.map((p) => {
        const member = members.find((m) => m.userId === p.userId);
        const image = dummyImages[p.userId] ?? member?.image;
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

function RoomRenameInput({ channel, activeServerId, onDone }: {
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

function LockToggleButton({ channel, activeServerId }: {
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
        if (!activeServerId) return;
        const current = useChatStore.getState().channels.find((c) => c.id === channel.id);
        if (!current) return;
        const now = Date.now();
        const key = `_lockTs_${channel.id}`;
        if ((window as any)[key] && now - (window as any)[key] < LOCK_TOGGLE_DEBOUNCE_MS) return;
        (window as any)[key] = now;
        const newLocked = !current.isLocked;
        dbg("ui", `[lock] toggling room ${channel.id} lock: ${current.isLocked} -> ${newLocked}`);
        useChatStore.setState((s) => ({
          channels: s.channels.map((c) =>
            c.id === channel.id ? { ...c, isLocked: newLocked } : c,
          ),
        }));
        api.updateChannel(activeServerId, channel.id, { isLocked: newLocked })
          .then((res) => dbg("ui", "[lock] API success:", res))
          .catch((err) => {
            dbg("ui", "[lock] API failed:", err);
            useChatStore.setState((s) => ({
              channels: s.channels.map((c) =>
                c.id === channel.id ? { ...c, isLocked: !newLocked } : c,
              ),
            }));
          });
      }}
    >
      {channel.isLocked ? <Lock size={10} /> : <LockOpen size={10} />}
    </button>
  );
}
