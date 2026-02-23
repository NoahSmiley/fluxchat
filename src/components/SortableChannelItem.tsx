import type { Channel, ChannelType } from "../types/shared.js";
import { useChatStore } from "../stores/chat.js";
import { useVoiceStore } from "../stores/voice.js";
import { useUIStore } from "../stores/ui.js";
import { MessageSquareText, Volume2, Settings, Gamepad2, ChevronRight, Folder, Radio, Lock, LockOpen } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TreeNode } from "../lib/channel-tree.js";
import { VoiceUserRow } from "./VoiceUserRow.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "../lib/avatarColor.js";

export function getChannelIcon(type: ChannelType, size = 14) {
  switch (type) {
    case "text": return <MessageSquareText size={size} className="channel-type-icon" />;
    case "voice": return <Volume2 size={size} className="channel-type-icon" />;
    case "game": return <Gamepad2 size={size} className="channel-type-icon" />;
    case "category": return <Folder size={size} className="channel-type-icon" />;
  }
}

export function SortableChannelItem({
  node,
  isActive,
  isUnread,
  mentionCount,
  isCollapsed,
  onToggleCollapse,
  onSelect,
  onSettings,
  onContextMenu,
  isOwnerOrAdmin,
  voiceProps,
  isDragging,
  isDropTarget,
  isMuted,
}: {
  node: TreeNode;
  isActive: boolean;
  isUnread: boolean;
  mentionCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onSettings: () => void;
  onContextMenu: (e: React.MouseEvent, ch: Channel) => void;
  isOwnerOrAdmin: boolean;
  isMuted?: boolean;
  voiceProps?: {
    participants: { userId: string; username: string }[];
    isConnected: boolean;
    hasScreenShare: boolean;
    screenSharerIds: Set<string>;
    members: ReturnType<typeof useChatStore.getState>["members"];
    voiceParticipants: ReturnType<typeof useVoiceStore.getState>["participants"];
  };
  isDragging?: boolean;
  isDropTarget?: boolean;
}) {
  const { channel, depth, pinned } = node;
  const isPinned = pinned ?? false;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: channel.id });

  const showDummyUsers = useUIStore((s) => s.showDummyUsers);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: depth * 12,
    opacity: isDragging ? 0.4 : 1,
    "--ch-indent": `${depth * 12}px`,
  } as React.CSSProperties;

  if (channel.type === "category") {
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...(isOwnerOrAdmin && !isPinned ? listeners : {})}>
        <div className={`channel-category-header ${depth === 0 ? "channel-category-root" : ""} ${isDropTarget ? "channel-category-drop-target" : ""}${isMuted ? " channel-muted" : ""}`}>
          <button
            className="channel-category-toggle"
            onClick={isPinned ? undefined : onToggleCollapse}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, channel); }}
            style={isPinned ? { cursor: "default" } : undefined}
          >
            <ChevronRight
              size={12}
              className={`channel-chevron ${isPinned ? "channel-chevron-hidden" : isCollapsed ? "" : "channel-chevron-open"}`}
            />
            <span className="channel-category-name">{channel.name}</span>
          </button>
          {isOwnerOrAdmin && !isPinned && (
            <button
              className="channel-settings-btn"
              onClick={onSettings}
              title="Category Settings"
            >
              <Settings size={13} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(isOwnerOrAdmin ? listeners : {})} className={isActive ? "channel-sortable-active" : undefined}>
      <div className={`channel-item-wrapper${isUnread ? " channel-item-has-unread" : ""}${mentionCount > 0 ? " channel-item-has-mention" : ""}${isMuted ? " channel-muted" : ""}`}>
        <button
          className={`channel-item ${isActive ? "active" : ""} ${isUnread ? "unread" : ""} ${voiceProps?.isConnected ? "voice-connected" : ""}`}
          onClick={onSelect}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, channel); }}
        >
          {getChannelIcon(channel.type)}
          <span className="channel-item-name">{channel.name}</span>
          {voiceProps?.hasScreenShare && (
            <span className="channel-live-badge"><Radio size={10} /> LIVE</span>
          )}
        </button>
        {isOwnerOrAdmin && (
          <button
            className="channel-settings-btn"
            onClick={onSettings}
            title="Channel Settings"
          >
            <Settings size={13} />
          </button>
        )}
        {mentionCount > 0 && <span className="channel-mention-badge">{mentionCount}</span>}
      </div>
      {channel.type === "voice" && voiceProps && voiceProps.participants.length > 0 && (
        <div className="voice-channel-users">
          {/* DEBUG: dummy sidebar users */}
          {showDummyUsers && [
            { userId: "__d1", username: "xKira", bannerCss: "aurora", bannerPatternSeed: null, ringStyle: "sapphire", ringSpin: true, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=1" },
            { userId: "__d2", username: "Blaze", bannerCss: "sunset", bannerPatternSeed: null, ringStyle: "ruby", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=8" },
            { userId: "__d3", username: "PhaseShift", bannerCss: "doppler", bannerPatternSeed: 42, ringStyle: "chroma", ringSpin: true, ringPatternSeed: null, role: "owner", image: "https://i.pravatar.cc/64?img=12" },
            { userId: "__d4", username: "Cosmo", bannerCss: "space", bannerPatternSeed: null, ringStyle: "emerald", ringSpin: false, ringPatternSeed: null, role: "admin", image: "https://i.pravatar.cc/64?img=15" },
            { userId: "__d5", username: "ghost404", bannerCss: null, bannerPatternSeed: null, ringStyle: "default", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/64?img=22" },
            { userId: "__d6", username: "Prism", bannerCss: "gamma_doppler", bannerPatternSeed: 77, ringStyle: "doppler", ringSpin: false, ringPatternSeed: 77, role: "member", image: "https://i.pravatar.cc/64?img=33" },
            { userId: "__d7", username: "Nyx", bannerCss: "cityscape", bannerPatternSeed: null, ringStyle: "gamma_doppler", ringSpin: true, ringPatternSeed: 150, role: "member", image: "https://i.pravatar.cc/64?img=47" },
            { userId: "__d8", username: "ZeroDay", bannerCss: "doppler", bannerPatternSeed: 200, ringStyle: "ruby", ringSpin: true, ringPatternSeed: null, role: "admin", image: "https://i.pravatar.cc/64?img=51" },
          ].map((d) => (
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
          {/* END DEBUG */}
          {voiceProps.participants.map((p) => {
            const member = voiceProps.members.find((m) => m.userId === p.userId);
            const voiceUser = voiceProps.isConnected ? voiceProps.voiceParticipants.find((v) => v.userId === p.userId) : null;
            const banner = bannerBackground(member?.bannerCss, member?.bannerPatternSeed);
            return (
              <VoiceUserRow
                key={p.userId}
                userId={p.userId}
                username={p.username}
                image={member?.image}
                member={member}
                banner={banner}
                ringStyle={{ ...ringGradientStyle(member?.ringPatternSeed, member?.ringStyle) } as React.CSSProperties}
                ringClassName={ringClass(member?.ringStyle, member?.ringSpin, member?.role, false, member?.ringPatternSeed)}
                isMuted={voiceUser?.isMuted}
                isDeafened={voiceUser?.isDeafened}
                isStreaming={voiceProps.screenSharerIds.has(p.userId)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
