import { useState, useMemo, useRef } from "react";
import type { Channel, ChannelType, ReorderItem } from "../../types/shared.js";
import { useChatStore } from "../../stores/chat.js";
import { useNotifStore } from "../../stores/notifications.js";
import { Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { buildTree, flattenTree } from "../../lib/channel-tree.js";
import { SortableChannelItem, getChannelIcon } from "./SortableChannelItem.js";
import * as api from "../../lib/api.js";
import type { MemberWithUser } from "../../types/shared.js";
import type { Participant } from "livekit-client";

const DROP_INTO_CATEGORY_DWELL_MS = 1000;
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
  voiceParticipants: Participant[];
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

  function clearDwell() {
    if (dwellRef.current) clearTimeout(dwellRef.current.timer);
    dwellRef.current = null;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setDropTargetCategoryId(null);
    clearDwell();
    dropIntoCategoryRef.current = null;
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !active) {
      clearDwell();
      dropIntoCategoryRef.current = null;
      setDropTargetCategoryId(null);
      return;
    }
    const activeNode = flatList.find((n) => n.channel.id === active.id);
    const overNode = flatList.find((n) => n.channel.id === over.id);
    if (!activeNode || !overNode) {
      clearDwell();
      dropIntoCategoryRef.current = null;
      setDropTargetCategoryId(null);
      return;
    }

    if (overNode.channel.type === "category" && overNode.channel.id !== activeNode.channel.id) {
      const activeIdx = flatList.findIndex((n) => n.channel.id === active.id);
      const overIdx = flatList.findIndex((n) => n.channel.id === over.id);
      let dwellCatId = overNode.channel.id;
      if (activeIdx > overIdx && overIdx > 0) {
        const aboveNode = flatList[overIdx - 1];
        if (aboveNode.channel.type === "category" && aboveNode.channel.id !== activeNode.channel.id) {
          dwellCatId = aboveNode.channel.id;
        }
      }

      const currentLockedCat = dropIntoCategoryRef.current;
      const hoveredCatId = dwellCatId;

      if (currentLockedCat === hoveredCatId) return;

      if (currentLockedCat) {
        dropIntoCategoryRef.current = null;
        setDropTargetCategoryId(null);
      }

      if (!dwellRef.current || dwellRef.current.catId !== hoveredCatId) {
        clearDwell();
        dwellRef.current = {
          catId: hoveredCatId,
          timer: setTimeout(() => {
            dropIntoCategoryRef.current = hoveredCatId;
            setDropTargetCategoryId(hoveredCatId);
          }, DROP_INTO_CATEGORY_DWELL_MS),
        };
      }
    } else if (dropIntoCategoryRef.current) {
      return;
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activatedCategory = dropIntoCategoryRef.current;
    setActiveId(null);
    setDropTargetCategoryId(null);
    clearDwell();
    dropIntoCategoryRef.current = null;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeNode = flatList.find((n) => n.channel.id === active.id);
    const overNode = flatList.find((n) => n.channel.id === over.id);
    if (!activeNode || !overNode) return;

    const isActiveCategory = activeNode.channel.type === "category";

    let newParentId: string | null;
    if (activatedCategory && activatedCategory !== (active.id as string)) {
      newParentId = activatedCategory;
    } else {
      newParentId = overNode.channel.parentId;
    }

    if (newParentId) {
      const parent = regularChannels.find((c) => c.id === newParentId);
      if (!parent || parent.type !== "category") {
        newParentId = null;
      } else if (isActiveCategory) {
        let checkId: string | null = newParentId;
        while (checkId) {
          if (checkId === active.id) { newParentId = null; break; }
          checkId = regularChannels.find((c) => c.id === checkId)?.parentId ?? null;
        }
      }
    }
    const sameParent = (activeNode.channel.parentId ?? null) === (newParentId ?? null);
    const items: ReorderItem[] = [];

    function assignPositions(siblings: Channel[], parentId: string | null): ReorderItem[] {
      const sorted = [...siblings].sort((a, b) => a.position - b.position);
      const chans = sorted.filter((c) => c.type !== "category");
      const categories = sorted.filter((c) => c.type === "category");
      const ordered = [...chans, ...categories];
      return ordered.map((c, i) => ({ id: c.id, parentId, position: i }));
    }

    if (sameParent) {
      const allSiblings = regularChannels
        .filter((c) => (c.parentId ?? null) === (newParentId ?? null))
        .sort((a, b) => a.position - b.position);

      const typeGroup = allSiblings.filter((c) => (c.type === "category") === isActiveCategory);
      const oldIdx = typeGroup.findIndex((c) => c.id === active.id);
      const newIdx = typeGroup.findIndex((c) => c.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;

      const reordered = [...typeGroup];
      const [moved] = reordered.splice(oldIdx, 1);
      reordered.splice(newIdx, 0, moved);

      const otherGroup = allSiblings.filter((c) => (c.type === "category") !== isActiveCategory);
      const fullList = isActiveCategory
        ? [...otherGroup, ...reordered]
        : [...reordered, ...otherGroup];

      for (let i = 0; i < fullList.length; i++) {
        items.push({ id: fullList[i].id, parentId: newParentId, position: i });
      }
    } else {
      const newSiblings = regularChannels
        .filter((c) => (c.parentId ?? null) === (newParentId ?? null) && c.id !== (active.id as string));

      const withMoved = [...newSiblings, activeNode.channel];
      items.push(...assignPositions(withMoved, newParentId));

      const oldSiblings = regularChannels
        .filter((c) => (c.parentId ?? null) === (activeNode.channel.parentId ?? null) && c.id !== (active.id as string));
      items.push(...assignPositions(oldSiblings, activeNode.channel.parentId));
    }

    useChatStore.setState((s) => ({
      channels: s.channels.map((ch) => {
        const item = items.find((it) => it.id === ch.id);
        if (item) return { ...ch, parentId: item.parentId, position: item.position };
        return ch;
      }),
    }));

    if (items.length === 0) return;

    try {
      await api.reorderChannels(activeServerId, items);
    } catch {
      const fresh = await api.getChannels(activeServerId);
      useChatStore.setState({ channels: fresh });
    }
  }

  const draggedNode = activeId ? flatList.find((n) => n.channel.id === activeId) : null;

  return (
    <div
      className="channel-list"
      onContextMenu={(e) => { e.preventDefault(); if (isOwnerOrAdmin) onSidebarContextMenu(e); }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
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
