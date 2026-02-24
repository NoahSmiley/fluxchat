import { useState } from "react";
import type { Channel, MemberWithUser } from "@/types/shared.js";
import { useChatStore } from "@/stores/chat/index.js";
import { Lock, LockOpen } from "lucide-react";
import * as api from "@/lib/api/index.js";
import { dbg } from "@/lib/debug.js";
import { avatarColor } from "@/lib/avatarColor.js";

const LOCK_TOGGLE_DEBOUNCE_MS = 400;

export const ANIMATED_LIST_DURATION_MS = 500;

export const DUMMY_VOICE_USERS = [
  { userId: "__d1", username: "xKira", drinkCount: 0 },
  { userId: "__d2", username: "Blaze", drinkCount: 0 },
  { userId: "__d3", username: "PhaseShift", drinkCount: 0 },
  { userId: "__d4", username: "Cosmo", drinkCount: 0 },
  { userId: "__d5", username: "ghost404", drinkCount: 0 },
  { userId: "__d6", username: "Prism", drinkCount: 0 },
  { userId: "__d7", username: "Nyx", drinkCount: 0 },
  { userId: "__d8", username: "ZeroDay", drinkCount: 0 },
];

export function getDummyImages(showDummyUsers: boolean): Record<string, string> {
  if (!showDummyUsers) return {};
  return {
    __d1: "https://i.pravatar.cc/64?img=1", __d2: "https://i.pravatar.cc/64?img=8",
    __d3: "https://i.pravatar.cc/64?img=12", __d4: "https://i.pravatar.cc/64?img=15",
    __d5: "https://i.pravatar.cc/64?img=22", __d6: "https://i.pravatar.cc/64?img=33",
    __d7: "https://i.pravatar.cc/64?img=47", __d8: "https://i.pravatar.cc/64?img=51",
  };
}

export function getDummyMembers(showDummyUsers: boolean) {
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

export function CollapsedAvatars({ participants, members, dummyImages }: {
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
