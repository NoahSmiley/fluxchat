import { useState, useMemo, useRef } from "react";
import type { Channel, ChannelType } from "../../types/shared.js";
import { useNotifStore } from "../../stores/notifications.js";
import { Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { buildTree, flattenTree } from "../../lib/channel-tree.js";
import { SortableChannelItem, getChannelIcon } from "./SortableChannelItem.js";
import type { MemberWithUser } from "../../types/shared.js";
import type { VoiceUser } from "../../stores/voice/types.js";
import {
  clearDwell,
  handleDragStart as dndDragStart,
  handleDragOver as dndDragOver,
  handleDragEnd as dndDragEnd,
  type DnDState,
} from "./ChannelTreeDnD.js";

const DRAG_ACTIVATION_DELAY_MS = 500;
const DRAG_ACTIVATION_TOLERANCE_PX = 5;

export interface ChannelTreeProps {
  channels: Channel[];
  activeChannelId: string | null;
  activeServerId: string;
  isOwnerOrAdmin: boolean;
  members: MemberWithUser[];
  unreadChannels: Set<string>;
  mentionCounts: Record<string, number>;
  channelParticipants: Record<string, { userId: string; username: string; drinkCount: number }[]>;
  connectedChannelId: string | null;
  screenSharers: { participantId: string }[];
  voiceParticipants: VoiceUser[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  selectChannel: (id: string) => void;
  onCreateChannel: (opts: { type: ChannelType; parentId?: string }) => void;
  onSettingsChannel: (channel: Channel) => void;
  onChannelContextMenu: (e: React.MouseEvent, channel: Channel) => void;
  onSidebarContextMenu: (e: React.MouseEvent) => void;
}

export function ChannelTree({
  channels,
  activeChannelId,
  activeServerId,
  isOwnerOrAdmin,
  members,
  unreadChannels,
  mentionCounts,
  channelParticipants,
  connectedChannelId,
  screenSharers,
  voiceParticipants,
  collapsed,
  onToggleCollapse,
  selectChannel,
  onCreateChannel,
  onSettingsChannel,
  onChannelContextMenu,
  onSidebarContextMenu,
}: ChannelTreeProps) {
  const notifStore = useNotifStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<string | null>(null);
  const dwellRef = useRef<{ catId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const dropIntoCategoryRef = useRef<string | null>(null);

  const regularChannels = useMemo(() => channels.filter((c) => !c.isRoom && c.type !== "voice"), [channels]);
  const tree = useMemo(() => buildTree(regularChannels), [regularChannels]);
  const flatList = useMemo(() => flattenTree(tree, collapsed, activeChannelId), [tree, collapsed, activeChannelId]);
  const flatIds = useMemo(() => flatList.map((n) => n.channel.id), [flatList]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: DRAG_ACTIVATION_DELAY_MS, tolerance: DRAG_ACTIVATION_TOLERANCE_PX } })
  );

  const dndState: DnDState = {
    activeId, dropTargetCategoryId, dwellRef, dropIntoCategoryRef,
    flatList, regularChannels, activeServerId,
    setActiveId, setDropTargetCategoryId,
  };

  const draggedNode = activeId ? flatList.find((n) => n.channel.id === activeId) : null;

  return (
    <div
      className="channel-list"
      onContextMenu={(e) => { e.preventDefault(); if (isOwnerOrAdmin) onSidebarContextMenu(e); }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => dndDragStart(e, dndState)}
        onDragOver={(e) => dndDragOver(e, dndState)}
        onDragEnd={(e) => dndDragEnd(e, dndState)}
      >
        <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
          {flatList.map((node) => {
            const ch = node.channel;
            const isUnread = unreadChannels.has(ch.id) && ch.id !== activeChannelId;
            const mentionCount = mentionCounts[ch.id] ?? 0;
            const participants = channelParticipants[ch.id] ?? [];
            const isConnected = connectedChannelId === ch.id;
            const hasScreenShare = isConnected && screenSharers.length > 0;
            const isMuted = ch.type === "category"
              ? notifStore.isCategoryMuted(ch.id)
              : notifStore.isChannelMuted(ch.id) || (!!ch.parentId && notifStore.isCategoryMuted(ch.parentId));
            const screenSharerIds = isConnected
              ? new Set(screenSharers.map((s) => s.participantId))
              : new Set<string>();

            return (
              <SortableChannelItem
                key={ch.id}
                node={node}
                isActive={ch.id === activeChannelId}
                isUnread={isUnread}
                mentionCount={mentionCount}
                isMuted={isMuted}
                isCollapsed={collapsed.has(ch.id)}
                onToggleCollapse={() => onToggleCollapse(ch.id)}
                onSelect={() => ch.type !== "category" && selectChannel(ch.id)}
                onSettings={() => onSettingsChannel(ch)}
                onContextMenu={(e, channel) => onChannelContextMenu(e, channel)}
                isOwnerOrAdmin={isOwnerOrAdmin}
                isDragging={activeId === ch.id}
                isDropTarget={ch.type === "category" && dropTargetCategoryId === ch.id}
                voiceProps={ch.type === "voice" ? {
                  participants,
                  isConnected,
                  hasScreenShare,
                  screenSharerIds,
                  members,
                  voiceParticipants,
                } : undefined}
              />
            );
          })}
        </SortableContext>

        <DragOverlay>
          {draggedNode && (
            <div className="channel-drag-overlay">
              {getChannelIcon(draggedNode.channel.type)}
              <span>{draggedNode.channel.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div style={{ flex: 1 }} />
      <button
        className="channel-add-floating-btn"
        onClick={() => onCreateChannel({ type: "text" })}
        title="Create Channel"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
