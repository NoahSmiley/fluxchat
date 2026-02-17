import { useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { Channel, ChannelType, ReorderItem } from "../types/shared.js";
import { useChatStore } from "../stores/chat.js";
import { useVoiceStore } from "../stores/voice.js";
import { VoiceStatusBar } from "./VoiceStatusBar.js";
import { MessageSquareText, Volume2, Settings, Monitor, MicOff, HeadphoneOff, Plus, Gamepad2, ChevronRight, Folder, GripVertical } from "lucide-react";
import { CreateChannelModal } from "./CreateChannelModal.js";
import { ChannelSettingsModal } from "./ChannelSettingsModal.js";
import { avatarColor, ringClass } from "../lib/avatarColor.js";
import * as api from "../lib/api.js";
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
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// // Hardcoded game channels — disabled for now
// const HARDCODED_GAME_CHANNELS: Channel[] = [
//   { id: "__game_cs2__", serverId: "", name: "counter-strike-2", type: "game", bitrate: null, parentId: null, position: 999, createdAt: "" },
// ];

const COLLAPSE_KEY = "flux-collapsed-categories";
const DROP_INTO_CATEGORY_DWELL_MS = 800;

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveCollapsed(set: Set<string>) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
}

interface TreeNode {
  channel: Channel;
  children: TreeNode[];
  depth: number;
}

function buildTree(channels: Channel[]): TreeNode[] {
  const childMap = new Map<string, Channel[]>();
  for (const ch of channels) {
    const key = ch.parentId ?? "__root__";
    if (!childMap.has(key)) childMap.set(key, []);
    childMap.get(key)!.push(ch);
  }
  for (const [, list] of childMap) {
    list.sort((a, b) => a.position - b.position);
  }

  function build(parentId: string | null, depth: number): TreeNode[] {
    const key = parentId ?? "__root__";
    const children = childMap.get(key) ?? [];
    return children.map((ch) => ({
      channel: ch,
      children: ch.type === "category" ? build(ch.id, depth + 1) : [],
      depth,
    }));
  }

  return build(null, 0);
}

function flattenTree(nodes: TreeNode[], collapsed: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.channel.type === "category" && !collapsed.has(node.channel.id)) {
      result.push(...flattenTree(node.children, collapsed));
    }
  }
  return result;
}

function getChannelIcon(type: ChannelType, size = 14) {
  switch (type) {
    case "text": return <MessageSquareText size={size} className="channel-type-icon" />;
    case "voice": return <Volume2 size={size} className="channel-type-icon" />;
    case "game": return <Gamepad2 size={size} className="channel-type-icon" />;
    case "category": return <Folder size={size} className="channel-type-icon" />;
  }
}

function SortableChannelItem({
  node,
  isActive,
  isUnread,
  isCollapsed,
  onToggleCollapse,
  onSelect,
  onSettings,
  isOwnerOrAdmin,
  voiceProps,
  isDragging,
  isDropTarget,
}: {
  node: TreeNode;
  isActive: boolean;
  isUnread: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onSettings: () => void;
  isOwnerOrAdmin: boolean;
  voiceProps?: {
    participants: { userId: string; username: string; drinkCount: number }[];
    isConnected: boolean;
    hasScreenShare: boolean;
    members: ReturnType<typeof useChatStore.getState>["members"];
    voiceParticipants: ReturnType<typeof useVoiceStore.getState>["participants"];
  };
  isDragging?: boolean;
  isDropTarget?: boolean;
}) {
  const { channel, depth } = node;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: channel.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: depth * 16,
    opacity: isDragging ? 0.4 : 1,
  };

  if (channel.type === "category") {
    return (
      <div ref={setNodeRef} style={style} {...attributes}>
        <div className={`channel-category-header ${isDropTarget ? "channel-category-drop-target" : ""}`}>
          {isOwnerOrAdmin && (
            <span className="channel-drag-handle" {...listeners}>
              <GripVertical size={12} />
            </span>
          )}
          <button
            className="channel-category-toggle"
            onClick={onToggleCollapse}
          >
            <ChevronRight
              size={12}
              className={`channel-chevron ${isCollapsed ? "" : "channel-chevron-open"}`}
            />
            <span className="channel-category-name">{channel.name}</span>
          </button>
          {isOwnerOrAdmin && (
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
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className="channel-item-wrapper">
        {isOwnerOrAdmin && (
          <span className="channel-drag-handle" {...listeners}>
            <GripVertical size={12} />
          </span>
        )}
        <button
          className={`channel-item ${isActive ? "active" : ""} ${isUnread ? "unread" : ""} ${voiceProps?.isConnected ? "voice-connected" : ""}`}
          onClick={onSelect}
        >
          {getChannelIcon(channel.type)}
          {channel.name}
          {isUnread && <span className="channel-unread-dot" />}
          {voiceProps?.hasScreenShare && (
            <span className="channel-live-badge"><Monitor size={10} /> LIVE</span>
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
      </div>
      {channel.type === "voice" && voiceProps && voiceProps.participants.length > 0 && (
        <div className="voice-channel-users">
          {voiceProps.participants.map((p) => {
            const member = voiceProps.members.find((m) => m.userId === p.userId);
            const voiceUser = voiceProps.isConnected ? voiceProps.voiceParticipants.find((v) => v.userId === p.userId) : null;
            return (
              <div key={p.userId} className="voice-channel-user">
                <span className={`voice-avatar-ring ${ringClass(member?.ringStyle, member?.ringSpin, member?.role)}`}>
                  <span className={`voice-user-avatar ${voiceUser?.speaking ? "speaking" : ""}`} style={{ background: avatarColor(p.username) }}>
                    {member?.image ? (
                      <img src={member.image} alt={p.username} />
                    ) : (
                      p.username.charAt(0).toUpperCase()
                    )}
                  </span>
                </span>
                <span className="voice-user-name">{p.username}</span>
                {p.drinkCount > 0 && (
                  <span className="drink-badge" title={`${p.drinkCount} drink${p.drinkCount !== 1 ? "s" : ""}`}>
                    🍺{p.drinkCount}
                  </span>
                )}
                {voiceUser?.isMuted && <MicOff size={14} className="voice-user-status-icon" />}
                {voiceUser?.isDeafened && <HeadphoneOff size={14} className="voice-user-status-icon" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ChannelSidebar() {
  const { channels, activeChannelId, selectChannel, servers, activeServerId, members, unreadChannels } = useChatStore();
  const { channelParticipants, connectedChannelId, screenSharers, participants: voiceParticipants } = useVoiceStore();
  const server = servers.find((s) => s.id === activeServerId);
  const isOwnerOrAdmin = server && (server.role === "owner" || server.role === "admin");

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [createModal, setCreateModal] = useState<{ type: ChannelType; parentId?: string } | null>(null);
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<string | null>(null);
  const hoverCategoryRef = useRef<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropIntoCategoryRef = useRef<string | null>(null);

  const allChannels = channels;

  const tree = useMemo(() => buildTree(allChannels), [allChannels]);
  const flatList = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);
  const flatIds = useMemo(() => flatList.map((n) => n.channel.id), [flatList]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveCollapsed(next);
      return next;
    });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
    setDropTargetCategoryId(null);
    hoverCategoryRef.current = null;
    dropIntoCategoryRef.current = null;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !active) {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverCategoryRef.current = null;
      dropIntoCategoryRef.current = null;
      setDropTargetCategoryId(null);
      return;
    }
    const activeNode = flatList.find((n) => n.channel.id === active.id);
    const overNode = flatList.find((n) => n.channel.id === over.id);
    if (!activeNode || !overNode) {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverCategoryRef.current = null;
      dropIntoCategoryRef.current = null;
      setDropTargetCategoryId(null);
      return;
    }

    // Dwell-time: hover over a category for 300ms to activate "drop into" mode
    // Quick drag past = reorder as sibling
    if (overNode.channel.type === "category" && activeNode.channel.type !== "category") {
      if (hoverCategoryRef.current !== overNode.channel.id) {
        // Started hovering over a new category
        hoverCategoryRef.current = overNode.channel.id;
        dropIntoCategoryRef.current = null;
        setDropTargetCategoryId(null);
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        const catId = overNode.channel.id;
        hoverTimerRef.current = setTimeout(() => {
          dropIntoCategoryRef.current = catId;
          setDropTargetCategoryId(catId);
        }, DROP_INTO_CATEGORY_DWELL_MS);
      }
      // If already activated, keep it
    } else {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverCategoryRef.current = null;
      dropIntoCategoryRef.current = null;
      setDropTargetCategoryId(null);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    const activatedCategory = dropIntoCategoryRef.current;
    setActiveId(null);
    setDropTargetCategoryId(null);
    hoverCategoryRef.current = null;
    dropIntoCategoryRef.current = null;

    const { active, over } = event;
    if (!over || active.id === over.id || !activeServerId) return;

    const activeNode = flatList.find((n) => n.channel.id === active.id);
    const overNode = flatList.find((n) => n.channel.id === over.id);
    if (!activeNode || !overNode) return;

    // Determine new parent:
    // - If dwell-time activated a category → drop INTO that category
    // - Over a child of a category → become sibling in that category
    // - Over a root item (or quick drag past category) → stay at root
    let newParentId: string | null;
    if (activatedCategory && activeNode.channel.type !== "category") {
      newParentId = activatedCategory;
    } else {
      newParentId = overNode.channel.parentId;
    }

    // Validate: parent must be a category
    if (newParentId) {
      const parent = allChannels.find((c) => c.id === newParentId);
      if (!parent || parent.type !== "category") {
        newParentId = null;
      }
    }

    const sameParent = (activeNode.channel.parentId ?? null) === (newParentId ?? null);
    const items: ReorderItem[] = [];

    if (sameParent) {
      // Same-parent reorder: use arrayMove pattern (exclude hardcoded game channels)
      const siblings = allChannels
        .filter((c) => (c.parentId ?? null) === (newParentId ?? null))
        .sort((a, b) => a.position - b.position);

      const oldIdx = siblings.findIndex((c) => c.id === active.id);
      const newIdx = siblings.findIndex((c) => c.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;

      // Array move: remove from old position, insert at new
      const reordered = [...siblings];
      const [moved] = reordered.splice(oldIdx, 1);
      reordered.splice(newIdx, 0, moved);

      for (let i = 0; i < reordered.length; i++) {
        items.push({ id: reordered[i].id, parentId: newParentId, position: i });
      }
    } else {
      // Cross-parent move: remove from old parent, add to new parent
      // New parent siblings (without the moved item)
      const newSiblings = allChannels
        .filter((c) => (c.parentId ?? null) === (newParentId ?? null) && c.id !== (active.id as string))
        .sort((a, b) => a.position - b.position);

      // Insert before or after the over item depending on drag direction
      const overIdx = newSiblings.findIndex((c) => c.id === over.id);
      const activeFlatIdx = flatList.findIndex((n) => n.channel.id === active.id);
      const overFlatIdx = flatList.findIndex((n) => n.channel.id === over.id);
      // Dragging upward (from below) → insert before; dragging downward → insert after
      const insertIdx = overIdx >= 0
        ? (activeFlatIdx > overFlatIdx ? overIdx : overIdx + 1)
        : newSiblings.length;

      const reordered = [...newSiblings];
      reordered.splice(insertIdx, 0, activeNode.channel);

      for (let i = 0; i < reordered.length; i++) {
        items.push({ id: reordered[i].id, parentId: newParentId, position: i });
      }

      // Reorder old siblings to close the gap
      const oldSiblings = allChannels
        .filter((c) => (c.parentId ?? null) === (activeNode.channel.parentId ?? null) && c.id !== (active.id as string))
        .sort((a, b) => a.position - b.position);
      for (let i = 0; i < oldSiblings.length; i++) {
        items.push({ id: oldSiblings[i].id, parentId: activeNode.channel.parentId, position: i });
      }
    }

    // Optimistic update
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
    <div className="channel-sidebar">
      <div className="channel-list">
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
              const participants = channelParticipants[ch.id] ?? [];
              const isConnected = connectedChannelId === ch.id;
              const hasScreenShare = isConnected && screenSharers.length > 0;

              return (
                <SortableChannelItem
                  key={ch.id}
                  node={node}
                  isActive={ch.id === activeChannelId}
                  isUnread={isUnread}
                  isCollapsed={collapsed.has(ch.id)}
                  onToggleCollapse={() => toggleCollapse(ch.id)}
                  onSelect={() => ch.type !== "category" && selectChannel(ch.id)}
                  onSettings={() => setSettingsChannel(ch)}
                  isOwnerOrAdmin={!!isOwnerOrAdmin}
                  isDragging={activeId === ch.id}
                  isDropTarget={ch.type === "category" && dropTargetCategoryId === ch.id}
                  voiceProps={ch.type === "voice" ? {
                    participants,
                    isConnected,
                    hasScreenShare,
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

        {isOwnerOrAdmin && (
          <button
            className="channel-add-bottom-btn"
            onClick={() => setCreateModal({ type: "text" })}
            title="Create Channel"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <VoiceStatusBar />

      {createModal && activeServerId && createPortal(
        <CreateChannelModal
          serverId={activeServerId}
          defaultType={createModal.type}
          parentId={createModal.parentId}
          onClose={() => setCreateModal(null)}
        />,
        document.body
      )}

      {settingsChannel && activeServerId && createPortal(
        <ChannelSettingsModal
          channel={settingsChannel}
          serverId={activeServerId}
          onClose={() => setSettingsChannel(null)}
        />,
        document.body
      )}
    </div>
  );
}
