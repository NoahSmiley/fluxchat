import { useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { Channel, ChannelType, ReorderItem } from "../../types/shared.js";
import { useChatStore } from "../../stores/chat.js";
import { useVoiceStore } from "../../stores/voice.js";
import { useUIStore } from "../../stores/ui.js";
import { useAuthStore } from "../../stores/auth.js";
import { useNotifStore, type ChannelNotifSetting, type CategoryNotifSetting } from "../../stores/notifications.js";
import { VoiceStatusBar } from "../voice/VoiceStatusBar.js";
import { Settings, Plus, ChevronRight, Lock, LockOpen } from "lucide-react";
import { gateway } from "../../lib/ws.js";
import { CreateChannelModal } from "../modals/CreateChannelModal.js";
import { ChannelSettingsModal, DeleteConfirmDialog } from "../modals/ChannelSettingsModal.js";
import ContextMenu, { type ContextMenuEntry } from "../ContextMenu.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "../../lib/avatarColor.js";
import * as api from "../../lib/api.js";
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
import { dbg } from "../../lib/debug.js";
import { buildTree, flattenTree, loadCollapsed, saveCollapsed } from "../../lib/channel-tree.js";
import { VoiceUserRow } from "../voice/VoiceUserRow.js";
import { SortableChannelItem, getChannelIcon } from "./SortableChannelItem.js";
import { AnimatedList } from "../AnimatedList.js";

const DROP_INTO_CATEGORY_DWELL_MS = 1000;
const DRAG_ACTIVATION_DELAY_MS = 500;
const DRAG_ACTIVATION_TOLERANCE_PX = 5;
const LOCK_TOGGLE_DEBOUNCE_MS = 400;
const ANIMATED_LIST_DURATION_MS = 500;

/** Build the mute duration submenu entries for channel/category context menus. */
function buildMuteSubmenu(
  isMuted: boolean,
  isMentionMuted: boolean,
  onMute: (ms: number) => void,
  onUnmute: () => void,
  onToggleMentionMute: () => void,
  onClose: () => void,
): ContextMenuEntry[] {
  function muteMs(minutes: number) { return minutes === -1 ? -1 : Date.now() + minutes * 60_000; }

  const opts: [number, string][] = [
    [15, "15 minutes"], [60, "1 hour"], [480, "8 hours"], [1440, "24 hours"], [-1, "Until I turn it back on"],
  ];
  const entries: ContextMenuEntry[] = opts.map(([m, label]) => ({
    label,
    onClick: () => { onMute(muteMs(m)); onClose(); },
  }));
  entries.push({ type: "separator" });
  entries.push({ label: "Mute @mentions", checked: isMentionMuted, onClick: onToggleMentionMute });
  if (isMuted) {
    entries.push({ type: "separator" });
    entries.push({ label: "Unmute", onClick: () => { onUnmute(); onClose(); } });
  }
  return entries;
}

export function ChannelSidebar() {
  const { channels, activeChannelId, selectChannel, servers, activeServerId, members, unreadChannels, mentionCounts, markChannelRead } = useChatStore(useShallow((s) => ({
    channels: s.channels, activeChannelId: s.activeChannelId, selectChannel: s.selectChannel,
    servers: s.servers, activeServerId: s.activeServerId, members: s.members,
    unreadChannels: s.unreadChannels, mentionCounts: s.mentionCounts, markChannelRead: s.markChannelRead,
  })));
  const { channelParticipants, connectedChannelId, connecting, screenSharers, participants: voiceParticipants } = useVoiceStore(useShallow((s) => ({
    channelParticipants: s.channelParticipants, connectedChannelId: s.connectedChannelId,
    connecting: s.connecting, screenSharers: s.screenSharers, participants: s.participants,
  })));
  const { openServerSettings, showDummyUsers } = useUIStore(useShallow((s) => ({
    openServerSettings: s.openServerSettings, showDummyUsers: s.showDummyUsers,
  })));
  const notifStore = useNotifStore();
  const server = servers.find((s) => s.id === activeServerId);
  const isOwnerOrAdmin = server && (server.role === "owner" || server.role === "admin");

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set());
  const [createModal, setCreateModal] = useState<{ type: ChannelType; parentId?: string } | null>(null);
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);
  const [channelCtxMenu, setChannelCtxMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [sidebarCtxMenu, setSidebarCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<string | null>(null);
  const [dragHighlightRoom, setDragHighlightRoom] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; username: string; channelId: string } | null>(null);
  const [roomCtxMenu, setRoomCtxMenu] = useState<{ x: number; y: number; room: Channel } | null>(null);
  const [renamingRoomId, setRenamingRoomId] = useState<string | null>(null);
  const { user } = useAuthStore();
  const dwellRef = useRef<{ catId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const dropIntoCategoryRef = useRef<string | null>(null);

  // Split channels: hide non-room voice channels (they're replaced by the rooms system)
  const regularChannels = useMemo(() => channels.filter((c) => !c.isRoom && c.type !== "voice"), [channels]);
  const rooms = useMemo(() => channels.filter((c) => c.isRoom), [channels]);

  const tree = useMemo(() => buildTree(regularChannels), [regularChannels]);
  const flatList = useMemo(() => flattenTree(tree, collapsed, activeChannelId), [tree, collapsed, activeChannelId]);
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

    // Dwell-time: hover over a category to activate "drop into" mode
    // Timer only resets when a DIFFERENT category is hovered — immune to DnD swap
    // animations that briefly change `over` to non-category items
    if (overNode.channel.type === "category" && overNode.channel.id !== activeNode.channel.id) {
      // When dragging upward, dnd-kit's `over` can be off by one due to swap
      // animations — it reports the category below the visual position. If the
      // item directly above `over` in the flat list is also a category, that's
      // the one the user is actually hovering over visually.
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

      // If already locked onto this same category, no changes needed
      if (currentLockedCat === hoveredCatId) return;

      // Hovering over a different category than what's locked/pending — restart dwell
      if (currentLockedCat) {
        dropIntoCategoryRef.current = null;
        setDropTargetCategoryId(null);
      }

      if (!dwellRef.current || dwellRef.current.catId !== hoveredCatId) {
        // Started hovering over a new category — start timer
        clearDwell();
        dwellRef.current = {
          catId: hoveredCatId,
          timer: setTimeout(() => {
            dropIntoCategoryRef.current = hoveredCatId;
            setDropTargetCategoryId(hoveredCatId);
          }, DROP_INTO_CATEGORY_DWELL_MS),
        };
      }
      // If same category, keep timer running
    } else if (dropIntoCategoryRef.current) {
      // Still locked in but over a non-category — keep it (immune to swap animations)
      return;
    }
    // NOTE: we intentionally do NOT clear dwellRef when over changes to a non-category,
    // because DnD swap animations briefly change `over` to other items. The dwell only
    // resets when a DIFFERENT category is hovered (handled above).
  }

  async function handleDragEnd(event: DragEndEvent) {
    const activatedCategory = dropIntoCategoryRef.current;
    setActiveId(null);
    setDropTargetCategoryId(null);
    clearDwell();
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
    const isActiveCategory = activeNode.channel.type === "category";

    let newParentId: string | null;
    if (activatedCategory && activatedCategory !== (active.id as string)) {
      newParentId = activatedCategory;
    } else {
      newParentId = overNode.channel.parentId;
    }

    // Validate: parent must be a category, and not a descendant of the dragged item
    if (newParentId) {
      const parent = regularChannels.find((c) => c.id === newParentId);
      if (!parent || parent.type !== "category") {
        newParentId = null;
      } else if (isActiveCategory) {
        // Prevent circular reference: can't drop a category into its own descendants
        let checkId: string | null = newParentId;
        while (checkId) {
          if (checkId === active.id) { newParentId = null; break; }
          checkId = regularChannels.find((c) => c.id === checkId)?.parentId ?? null;
        }
      }
    }
    const sameParent = (activeNode.channel.parentId ?? null) === (newParentId ?? null);
    const items: ReorderItem[] = [];

    // Helper: given all siblings at a level, build position assignments
    // with channels-first ordering, returning ReorderItem[]
    function assignPositions(siblings: Channel[], parentId: string | null): ReorderItem[] {
      const sorted = [...siblings].sort((a, b) => a.position - b.position);
      const channels = sorted.filter((c) => c.type !== "category");
      const categories = sorted.filter((c) => c.type === "category");
      const ordered = [...channels, ...categories];
      return ordered.map((c, i) => ({ id: c.id, parentId, position: i }));
    }

    if (sameParent) {
      // Same-parent reorder: only reorder within the same type group
      const allSiblings = regularChannels
        .filter((c) => (c.parentId ?? null) === (newParentId ?? null))
        .sort((a, b) => a.position - b.position);

      // Split into type groups
      const typeGroup = allSiblings.filter((c) => (c.type === "category") === isActiveCategory);
      const oldIdx = typeGroup.findIndex((c) => c.id === active.id);
      const newIdx = typeGroup.findIndex((c) => c.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;

      // Array move within the type group
      const reordered = [...typeGroup];
      const [moved] = reordered.splice(oldIdx, 1);
      reordered.splice(newIdx, 0, moved);

      // Reassemble: channels first, then categories
      const otherGroup = allSiblings.filter((c) => (c.type === "category") !== isActiveCategory);
      const fullList = isActiveCategory
        ? [...otherGroup, ...reordered]
        : [...reordered, ...otherGroup];

      for (let i = 0; i < fullList.length; i++) {
        items.push({ id: fullList[i].id, parentId: newParentId, position: i });
      }
    } else {
      // Cross-parent move: remove from old parent, add to new parent
      // Place the item at the end of its type group in the new parent
      const newSiblings = regularChannels
        .filter((c) => (c.parentId ?? null) === (newParentId ?? null) && c.id !== (active.id as string));

      const withMoved = [...newSiblings, activeNode.channel];
      items.push(...assignPositions(withMoved, newParentId));

      // Reorder old siblings to close the gap
      const oldSiblings = regularChannels
        .filter((c) => (c.parentId ?? null) === (activeNode.channel.parentId ?? null) && c.id !== (active.id as string));
      items.push(...assignPositions(oldSiblings, activeNode.channel.parentId));
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
      {server && (
        <div className="channel-sidebar-header" onClick={isOwnerOrAdmin ? openServerSettings : undefined} style={{ cursor: isOwnerOrAdmin ? "pointer" : "default" }}>
          <span className="channel-sidebar-header-title">{server.name}</span>
          {isOwnerOrAdmin && (
            <button
              className="channel-sidebar-header-btn"
              title="Server Settings"
              onClick={(e) => { e.stopPropagation(); openServerSettings(); }}
            >
              <Settings size={14} />
            </button>
          )}
        </div>
      )}
      <div className="channel-list" onContextMenu={(e) => { e.preventDefault(); if (isOwnerOrAdmin) setSidebarCtxMenu({ x: e.clientX, y: e.clientY }); }}>
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
                  onToggleCollapse={() => toggleCollapse(ch.id)}
                  onSelect={() => ch.type !== "category" && selectChannel(ch.id)}
                  onSettings={() => setSettingsChannel(ch)}
                  onContextMenu={(e, ch) => setChannelCtxMenu({ x: e.clientX, y: e.clientY, channel: ch })}
                  isOwnerOrAdmin={!!isOwnerOrAdmin}
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
          onClick={() => setCreateModal({ type: "text" })}
          title="Create Channel"
        >
          <Plus size={14} />
        </button>
      </div>

      {(() => {
        const isInVoice = !!connectedChannelId || connecting;
        // Gather all voice channels (rooms + legacy voice) that have participants
        const voiceChannels = channels.filter((c) => c.type === "voice");

        // Merge real participants with dummy users for the lobby
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

        const DUMMY_IMAGES: Record<string, string> = showDummyUsers ? {
          __d1: "https://i.pravatar.cc/64?img=1", __d2: "https://i.pravatar.cc/64?img=8",
          __d3: "https://i.pravatar.cc/64?img=12", __d4: "https://i.pravatar.cc/64?img=15",
          __d5: "https://i.pravatar.cc/64?img=22", __d6: "https://i.pravatar.cc/64?img=33",
          __d7: "https://i.pravatar.cc/64?img=47", __d8: "https://i.pravatar.cc/64?img=51",
        } : {};

        const DUMMY_MEMBERS: { userId: string; username: string; image: string; ringStyle: string; ringSpin: boolean; ringPatternSeed: number | null; bannerCss: string | null; bannerPatternSeed: number | null; role: string }[] = showDummyUsers ? [
          { userId: "__d1", username: "xKira", image: "https://i.pravatar.cc/64?img=1", ringStyle: "sapphire", ringSpin: true, ringPatternSeed: null, bannerCss: "aurora", bannerPatternSeed: null, role: "member" },
          { userId: "__d2", username: "Blaze", image: "https://i.pravatar.cc/64?img=8", ringStyle: "ruby", ringSpin: false, ringPatternSeed: null, bannerCss: "sunset", bannerPatternSeed: null, role: "member" },
          { userId: "__d3", username: "PhaseShift", image: "https://i.pravatar.cc/64?img=12", ringStyle: "chroma", ringSpin: true, ringPatternSeed: null, bannerCss: "doppler", bannerPatternSeed: 42, role: "owner" },
          { userId: "__d4", username: "Cosmo", image: "https://i.pravatar.cc/64?img=15", ringStyle: "emerald", ringSpin: false, ringPatternSeed: null, bannerCss: "space", bannerPatternSeed: null, role: "admin" },
          { userId: "__d5", username: "ghost404", image: "https://i.pravatar.cc/64?img=22", ringStyle: "default", ringSpin: false, ringPatternSeed: null, bannerCss: null, bannerPatternSeed: null, role: "member" },
          { userId: "__d6", username: "Prism", image: "https://i.pravatar.cc/64?img=33", ringStyle: "doppler", ringSpin: false, ringPatternSeed: 77, bannerCss: "gamma_doppler", bannerPatternSeed: 77, role: "member" },
          { userId: "__d7", username: "Nyx", image: "https://i.pravatar.cc/64?img=47", ringStyle: "gamma_doppler", ringSpin: true, ringPatternSeed: 150, bannerCss: "cityscape", bannerPatternSeed: null, role: "member" },
          { userId: "__d8", username: "ZeroDay", image: "https://i.pravatar.cc/64?img=51", ringStyle: "ruby", ringSpin: true, ringPatternSeed: null, bannerCss: "doppler", bannerPatternSeed: 200, role: "admin" },
        ] : [];

        const firstRoomId = voiceChannels.find((c) => c.isRoom)?.id;
        const voiceWithUsers = voiceChannels
          .map((c) => {
            const real = channelParticipants[c.id] ?? [];
            // Add dummy users to the first actual room (not legacy voice channels)
            const isFirstRoom = c.isRoom && c.id === firstRoomId;
            const allParticipants = (showDummyUsers && isFirstRoom) ? [...DUMMY_VOICE_USERS, ...real] : real;
            return { channel: c, participants: allParticipants };
          })
          .filter((r) => r.participants.length > 0 || connectedChannelId === r.channel.id);
        const totalVoiceUsers = voiceWithUsers.reduce((sum, r) => sum + r.participants.length, 0);

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
                      // If locked and not creator/admin, knock instead of joining
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
                      setRoomCtxMenu({ x: e.clientX, y: e.clientY, room: vc });
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
                          <input
                            className="room-rename-input"
                            autoFocus
                            defaultValue={vc.name}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const val = (e.target as HTMLInputElement).value.trim();
                                if (val && val !== vc.name && activeServerId) {
                                  api.updateChannel(activeServerId, vc.id, { name: val });
                                  useChatStore.setState((s) => ({
                                    channels: s.channels.map((c) => c.id === vc.id ? { ...c, name: val } : c),
                                  }));
                                }
                                setRenamingRoomId(null);
                              } else if (e.key === "Escape") {
                                setRenamingRoomId(null);
                              }
                            }}
                            onBlur={(e) => {
                              const val = e.target.value.trim();
                              if (val && val !== vc.name && activeServerId) {
                                api.updateChannel(activeServerId, vc.id, { name: val });
                                useChatStore.setState((s) => ({
                                  channels: s.channels.map((c) => c.id === vc.id ? { ...c, name: val } : c),
                                }));
                              }
                              setRenamingRoomId(null);
                            }}
                          />
                        ) : (
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vc.name}</span>
                        )}
                        <span className="voice-room-group-count">{participants.length}</span>
                        {(vc.creatorId === user?.id || isOwnerOrAdmin) && (
                          <button
                            className="room-lock-toggle visible"
                            title={vc.isLocked ? "Unlock room" : "Lock room"}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              if (!activeServerId) return;
                              // Read current state from store to avoid stale closure
                              const current = useChatStore.getState().channels.find((c) => c.id === vc.id);
                              if (!current) return;
                              // Debounce: skip if toggled within last 1s
                              const now = Date.now();
                              const key = `_lockTs_${vc.id}`;
                              if ((window as any)[key] && now - (window as any)[key] < LOCK_TOGGLE_DEBOUNCE_MS) return;
                              (window as any)[key] = now;
                              const newLocked = !current.isLocked;
                              dbg("ui", `[lock] toggling room ${vc.id} lock: ${current.isLocked} → ${newLocked}`);
                              useChatStore.setState((s) => ({
                                channels: s.channels.map((c) =>
                                  c.id === vc.id ? { ...c, isLocked: newLocked } : c,
                                ),
                              }));
                              api.updateChannel(activeServerId, vc.id, { isLocked: newLocked })
                                .then((res) => dbg("ui", "[lock] API success:", res))
                                .catch((err) => {
                                  dbg("ui", "[lock] API failed:", err);
                                  useChatStore.setState((s) => ({
                                    channels: s.channels.map((c) =>
                                      c.id === vc.id ? { ...c, isLocked: !newLocked } : c,
                                    ),
                                  }));
                                });
                            }}
                          >
                            {vc.isLocked ? <Lock size={10} /> : <LockOpen size={10} />}
                          </button>
                        )}
                      </div>
                    </div>
                    {isRoomCollapsed ? (
                      <div className="voice-room-avatars">
                        {participants.map((p) => {
                          const member = members.find((m) => m.userId === p.userId);
                          const image = DUMMY_IMAGES[p.userId] ?? member?.image;
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
                    ) : isInVoice ? (
                      <div className="voice-room-detailed">
                        {/* Dummy users */}
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
                        {/* Real participants (skip dummies) */}
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
                                setContextMenu({ x: e.clientX, y: e.clientY, userId: p.userId, username: p.username, channelId: vc.id });
                              } : undefined}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className="voice-room-avatars">
                        {participants.map((p) => {
                          const member = members.find((m) => m.userId === p.userId);
                          const image = DUMMY_IMAGES[p.userId] ?? member?.image;
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
                // Only count rooms with active participants (empty rooms from previous sessions don't matter)
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
      })()}

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

      {contextMenu && createPortal(
        <div className="voice-user-context-menu-backdrop" onClick={() => setContextMenu(null)}>
          <div
            className="voice-user-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="voice-user-context-menu-header">Move {contextMenu.username} to:</div>
            {rooms.filter((r) => r.id !== contextMenu.channelId).map((r) => (
              <button
                key={r.id}
                className="voice-user-context-menu-item"
                onClick={() => {
                  if (activeServerId) {
                    api.moveUserToRoom(activeServerId, contextMenu.channelId, contextMenu.userId, r.id).catch((err) => dbg("ui", "[move-user] failed:", err));
                  }
                  setContextMenu(null);
                }}
              >
                {r.name}
              </button>
            ))}
            {rooms.filter((r) => r.id !== contextMenu.channelId).length === 0 && (
              <div className="voice-user-context-menu-empty">No other rooms</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {channelCtxMenu && (() => {
        const ch = channelCtxMenu.channel;
        const isCategory = ch.type === "category";
        const channelMuted = notifStore.isChannelMuted(ch.id);
        const categoryMuted = notifStore.isCategoryMuted(ch.id);
        const channelSetting: ChannelNotifSetting = notifStore.channelSettings[ch.id] ?? "default";
        const categorySetting: CategoryNotifSetting = notifStore.categorySettings[ch.id] ?? "all";
        const isUnread = unreadChannels.has(ch.id);

        const closeCtxMenu = () => setChannelCtxMenu(null);

        function buildChannelNotifSubmenu(current: ChannelNotifSetting): ContextMenuEntry[] {
          const opts: [ChannelNotifSetting, string][] = [
            ["all", "All messages"], ["only_mentions", "Only @mentions"], ["none", "Nothing"], ["default", "Default (category)"],
          ];
          return opts.map(([val, label]) => ({
            label, checked: current === val,
            onClick: () => { notifStore.setChannelSetting(ch.id, val); closeCtxMenu(); },
          }));
        }

        function buildCategoryNotifSubmenu(current: CategoryNotifSetting): ContextMenuEntry[] {
          const opts: [CategoryNotifSetting, string][] = [
            ["all", "All messages"], ["only_mentions", "Only @mentions"], ["none", "Nothing"],
          ];
          return opts.map(([val, label]) => ({
            label, checked: current === val,
            onClick: () => { notifStore.setCategorySetting(ch.id, val); closeCtxMenu(); },
          }));
        }

        const items: ContextMenuEntry[] = isCategory
          ? [
              { label: collapsed.has(ch.id) ? "Expand" : "Collapse", onClick: () => { toggleCollapse(ch.id); closeCtxMenu(); } },
              { type: "separator" },
              { label: "Notification settings", submenu: buildCategoryNotifSubmenu(categorySetting) },
              { label: categoryMuted ? "Muted" : "Mute category", onClick: categoryMuted ? () => { notifStore.unmuteCategory(ch.id); closeCtxMenu(); } : () => { notifStore.muteCategory(ch.id, -1); closeCtxMenu(); }, submenu: buildMuteSubmenu(categoryMuted, notifStore.isCategoryMentionMuted(ch.id), (ms) => notifStore.muteCategory(ch.id, ms), () => notifStore.unmuteCategory(ch.id), () => notifStore.setMuteCategoryMentions(ch.id, !notifStore.isCategoryMentionMuted(ch.id)), closeCtxMenu) },
              ...(isOwnerOrAdmin ? [
                { type: "separator" as const },
                { label: "Create channel", onClick: () => { setCreateModal({ type: "text", parentId: ch.id }); closeCtxMenu(); } },
                { label: "Edit category", onClick: () => { setSettingsChannel(ch); closeCtxMenu(); } },
                { label: "Delete category", danger: true, onClick: () => { setDeletingChannel(ch); closeCtxMenu(); } },
              ] : []),
            ]
          : [
              ...(isUnread ? [{ label: "Mark as read", onClick: () => { markChannelRead(ch.id); closeCtxMenu(); } } as ContextMenuEntry, { type: "separator" as const }] : []),
              { label: "Notification settings", submenu: buildChannelNotifSubmenu(channelSetting) },
              { label: channelMuted ? "Muted" : "Mute channel", onClick: channelMuted ? () => { notifStore.unmuteChannel(ch.id); closeCtxMenu(); } : () => { notifStore.muteChannel(ch.id, -1); closeCtxMenu(); }, submenu: buildMuteSubmenu(channelMuted, notifStore.isChannelMentionMuted(ch.id), (ms) => notifStore.muteChannel(ch.id, ms), () => notifStore.unmuteChannel(ch.id), () => notifStore.setMuteChannelMentions(ch.id, !notifStore.isChannelMentionMuted(ch.id)), closeCtxMenu) },
              ...(isOwnerOrAdmin ? [
                { type: "separator" as const },
                { label: "Edit channel", onClick: () => { setSettingsChannel(ch); closeCtxMenu(); } },
                { label: "Delete channel", danger: true, onClick: () => { setDeletingChannel(ch); closeCtxMenu(); } },
              ] : []),
            ];
        return (
          <ContextMenu
            x={channelCtxMenu.x}
            y={channelCtxMenu.y}
            onClose={() => setChannelCtxMenu(null)}
            items={items}
          />
        );
      })()}

      {sidebarCtxMenu && isOwnerOrAdmin && (
        <ContextMenu
          x={sidebarCtxMenu.x}
          y={sidebarCtxMenu.y}
          onClose={() => setSidebarCtxMenu(null)}
          items={[
            { label: "Create channel", onClick: () => { setCreateModal({ type: "text" }); setSidebarCtxMenu(null); } },
          ]}
        />
      )}

      {roomCtxMenu && (() => {
        const room = roomCtxMenu.room;
        const canManage = room.creatorId === user?.id || isOwnerOrAdmin;
        const items: ContextMenuEntry[] = [
          ...(canManage ? [
            { label: "Rename room", onClick: () => { setRenamingRoomId(room.id); setRoomCtxMenu(null); } },
            { label: room.isLocked ? "Unlock room" : "Lock room", onClick: () => {
              if (!activeServerId) return;
              const newLocked = !room.isLocked;
              useChatStore.setState((s) => ({ channels: s.channels.map((c) => c.id === room.id ? { ...c, isLocked: newLocked } : c) }));
              api.updateChannel(activeServerId, room.id, { isLocked: newLocked }).catch(() => {
                useChatStore.setState((s) => ({ channels: s.channels.map((c) => c.id === room.id ? { ...c, isLocked: !newLocked } : c) }));
              });
              setRoomCtxMenu(null);
            }},
            { label: `Bitrate: ${(room.bitrate ?? 256_000) / 1000} kbps`, submenu: [64, 96, 128, 192, 256, 320, 384, 512].map((kbps) => ({
              label: `${kbps} kbps`,
              checked: (room.bitrate ?? 256_000) === kbps * 1000,
              onClick: () => {
                if (!activeServerId) return;
                const bps = kbps * 1000;
                useChatStore.setState((s) => ({ channels: s.channels.map((c) => c.id === room.id ? { ...c, bitrate: bps } : c) }));
                api.updateChannel(activeServerId, room.id, { bitrate: bps }).catch(() => {
                  useChatStore.setState((s) => ({ channels: s.channels.map((c) => c.id === room.id ? { ...c, bitrate: room.bitrate } : c) }));
                });
                // Apply live if we're in this room
                if (connectedChannelId === room.id) {
                  useVoiceStore.getState().applyBitrate(bps);
                }
                setRoomCtxMenu(null);
              },
            })) },
            { type: "separator" as const },
            { label: "Delete room", danger: true, onClick: async () => {
              setRoomCtxMenu(null);
              if (!activeServerId) return;
              try {
                // Leave the room first if we're in it (server blocks deleting rooms with participants)
                if (connectedChannelId === room.id) {
                  useVoiceStore.getState().leaveVoiceChannel();
                  // Small delay for the leave to propagate to server
                  await new Promise((r) => setTimeout(r, 300));
                }
                await api.deleteChannel(activeServerId, room.id);
                const { channels, activeChannelId, selectChannel } = useChatStore.getState();
                const remaining = channels.filter((c) => c.id !== room.id);
                useChatStore.setState({ channels: remaining });
                if (activeChannelId === room.id && remaining.length > 0) selectChannel(remaining[0].id);
              } catch (err) {
                dbg("ui", "Failed to delete room:", err);
              }
            }},
          ] : []),
        ];
        if (items.length === 0) return null;
        return (
          <ContextMenu
            x={roomCtxMenu.x}
            y={roomCtxMenu.y}
            onClose={() => setRoomCtxMenu(null)}
            items={items}
          />
        );
      })()}

      {deletingChannel && activeServerId && createPortal(
        <DeleteConfirmDialog
          channelName={deletingChannel.name}
          isCategory={deletingChannel.type === "category"}
          deleting={isDeleting}
          onCancel={() => setDeletingChannel(null)}
          onConfirm={async () => {
            setIsDeleting(true);
            try {
              await api.deleteChannel(activeServerId, deletingChannel.id);
              const { channels, activeChannelId, selectChannel } = useChatStore.getState();
              const remaining = channels.filter((c) => c.id !== deletingChannel.id);
              useChatStore.setState({ channels: remaining });
              if (activeChannelId === deletingChannel.id && remaining.length > 0) selectChannel(remaining[0].id);
              setDeletingChannel(null);
            } catch { /* ignore */ }
            finally { setIsDeleting(false); }
          }}
        />,
        document.body
      )}
    </div>
  );
}
