import { useState, useMemo, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Channel, ChannelType } from "@/types/shared.js";
import { useNotifStore } from "@/stores/notifications.js";
import { Plus, ChevronRight, Settings } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { buildTree, flattenTree } from "@/lib/channel-tree.js";
import { SortableChannelItem, getChannelIcon } from "./SortableChannelItem.js";
import { GAME_CHANNELS } from "@/lib/gameChannels.js";
import { useChatStore } from "@/stores/chat/index.js";
import * as api from "@/lib/api/index.js";
import type { MemberWithUser, ReorderItem } from "@/types/shared.js";
import type { VoiceUser } from "@/stores/voice/types.js";
import {
  clearDwell,
  handleDragStart as dndDragStart,
  handleDragOver as dndDragOver,
  handleDragEnd as dndDragEnd,
  type DnDState,
} from "./ChannelTreeDnD.js";

const DRAG_ACTIVATION_DELAY_MS = 500;
const DRAG_ACTIVATION_TOLERANCE_PX = 5;

interface ChannelTreeProps {
  channels: Channel[];
  activeChannelId: string | null;
  activeServerId: string;
  isOwnerOrAdmin: boolean;
  members: MemberWithUser[];
  unreadChannels: Set<string>;
  mentionCounts: Record<string, number>;
  channelParticipants: Record<string, { userId: string; username: string }[]>;
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

/* ── A unified item in the games section (game logo OR text channel) ── */
type GamesItem = { id: string; kind: "game"; game: typeof GAME_CHANNELS[number] }
  | { id: string; kind: "text"; channel: Channel };

function SortableGamesItem({
  item, isActive, isUnread, mentionCount, isOwnerOrAdmin, isDragging,
  selectChannel, onSettingsChannel, onChannelContextMenu,
}: {
  item: GamesItem; isActive: boolean; isUnread: boolean; mentionCount: number;
  isOwnerOrAdmin: boolean; isDragging: boolean;
  selectChannel: (id: string) => void;
  onSettingsChannel: (ch: Channel) => void;
  onChannelContextMenu: (e: React.MouseEvent, ch: Channel) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  } as React.CSSProperties;

  if (item.kind === "game") {
    return (
      <div ref={setNodeRef} style={style} {...attributes} {...(isOwnerOrAdmin ? listeners : {})} className={isActive ? "channel-sortable-active" : undefined}>
        <div className="channel-item-wrapper">
          <button
            className={`channel-item ${isActive ? "active" : ""}`}
            onClick={() => selectChannel(item.game.id)}
          >
            <img src={item.game.iconImage} alt={item.game.name} className={`channel-game-icon${item.game.iconInvert ? " invert" : ""}`} />
          </button>
        </div>
      </div>
    );
  }

  const ch = item.channel;
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(isOwnerOrAdmin ? listeners : {})} className={isActive ? "channel-sortable-active" : undefined}>
      <div className={`channel-item-wrapper${isUnread ? " channel-item-has-unread" : ""}`}>
        <button
          className={`channel-item ${isActive ? "active" : ""} ${isUnread ? "unread" : ""}`}
          onClick={() => selectChannel(ch.id)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onChannelContextMenu(e, ch); }}
        >
          {getChannelIcon("text")}
          <span className="channel-item-name">{ch.name}</span>
        </button>
        {isOwnerOrAdmin && (
          <button className="channel-settings-btn" onClick={() => onSettingsChannel(ch)} title="Channel Settings">
            <Settings size={13} />
          </button>
        )}
        {mentionCount > 0 && <span className="channel-mention-badge">{mentionCount}</span>}
      </div>
    </div>
  );
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
  const notifStore = useNotifStore(useShallow((s) => ({
    isChannelMuted: s.isChannelMuted, isCategoryMuted: s.isCategoryMuted,
  })));
  const activeGameId = useChatStore((s) => s.activeGameId);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<string | null>(null);
  const dwellRef = useRef<{ catId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const dropIntoCategoryRef = useRef<string | null>(null);

  // Find the "Games" category so we can render it separately with game logos
  const gamesCatId = useMemo(() => {
    const cat = channels.find((c) => c.type === "category" && c.name.toLowerCase() === "games");
    return cat?.id ?? null;
  }, [channels]);

  // Exclude games category + its children from the main DnD tree
  const regularChannels = useMemo(() => channels.filter((c) =>
    !c.isRoom && c.type !== "voice"
    && (!gamesCatId || (c.id !== gamesCatId && c.parentId !== gamesCatId))
  ), [channels, gamesCatId]);

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
  const screenSharerIds = useMemo(() => new Set(screenSharers.map((s) => s.participantId)), [screenSharers]);
  const emptySet = useMemo(() => new Set<string>(), []);

  // ── Games section data ──
  const gamesCat = gamesCatId ? channels.find((c) => c.id === gamesCatId) : null;
  const gamesCollapsedKey = gamesCatId ?? "__games__";
  const gamesCollapsed = collapsed.has(gamesCollapsedKey);
  const gameTextChannels = useMemo(() =>
    gamesCatId ? channels.filter((c) => c.parentId === gamesCatId && c.type === "text").sort((a, b) => a.position - b.position) : [],
    [channels, gamesCatId]
  );

  // Build a unified list: game logos + text channels, interleaved by position.
  // Game logos occupy indices 0..N-1 by default. Text channels use their `position`
  // field as their index in this unified list. If a text channel's position >= number
  // of game channels, it appears after the logos; if < number, it interleaves.
  const gamesItems = useMemo((): GamesItem[] => {
    const gameItems: GamesItem[] = GAME_CHANNELS.map((g) => ({ id: g.id, kind: "game" as const, game: g }));
    const textItems: GamesItem[] = gameTextChannels.map((c) => ({ id: c.id, kind: "text" as const, channel: c }));

    // Merge: insert text channels at their position index in the combined list
    const result: GamesItem[] = [...gameItems];
    for (const t of textItems) {
      const pos = t.kind === "text" ? t.channel.position : 0;
      // Clamp position to valid range
      const idx = Math.min(Math.max(0, pos), result.length);
      result.splice(idx, 0, t);
    }
    return result;
  }, [gameTextChannels]);
  const gamesItemIds = useMemo(() => gamesItems.map((it) => it.id), [gamesItems]);

  // Games DnD state
  const [gamesDragId, setGamesDragId] = useState<string | null>(null);
  const gamesDraggedItem = gamesDragId ? gamesItems.find((it) => it.id === gamesDragId) : null;

  const handleGamesDragEnd = useCallback(async (event: DragEndEvent) => {
    setGamesDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Compute new order from current gamesItems
    const oldList = [...gamesItems];
    const oldIdx = oldList.findIndex((it) => it.id === active.id);
    const newIdx = oldList.findIndex((it) => it.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const [moved] = oldList.splice(oldIdx, 1);
    oldList.splice(newIdx, 0, moved);

    // Extract text channels with their new unified position
    const items: ReorderItem[] = [];
    for (let i = 0; i < oldList.length; i++) {
      const it = oldList[i];
      if (it.kind === "text") {
        items.push({ id: it.id, parentId: gamesCatId, position: i });
      }
    }

    if (items.length === 0) return;

    // Optimistic update
    useChatStore.setState((s) => ({
      channels: s.channels.map((ch) => {
        const item = items.find((r) => r.id === ch.id);
        if (item) return { ...ch, position: item.position };
        return ch;
      }),
    }));

    try {
      await api.reorderChannels(activeServerId, items);
    } catch {
      const fresh = await api.getChannels(activeServerId);
      useChatStore.setState({ channels: fresh });
    }
  }, [gamesItems, gamesCatId, activeServerId]);

  const handleCreateInGames = async () => {
    let parentId = gamesCatId;
    if (!parentId) {
      try {
        const cat = await api.createChannel(activeServerId, { name: "games", type: "category" });
        useChatStore.setState((s) => ({ channels: [...s.channels, cat] }));
        parentId = cat.id;
      } catch { return; }
    }
    onCreateChannel({ type: "text", parentId });
  };

  return (
    <div
      className="channel-list"
      onContextMenu={(e) => { e.preventDefault(); if (isOwnerOrAdmin) onSidebarContextMenu(e); }}
    >
      {/* ── Main DnD tree (everything except games category) ── */}
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
                  screenSharerIds: isConnected ? screenSharerIds : emptySet,
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

      {/* ── Games section with its own DnD context ── */}
      {GAME_CHANNELS.length > 0 && (
        <div className="channel-category-root" style={{ marginTop: 12 }}>
          <div className="channel-category-header">
            <button
              className="channel-category-toggle"
              onClick={() => onToggleCollapse(gamesCollapsedKey)}
              onContextMenu={gamesCat ? (e) => { e.preventDefault(); e.stopPropagation(); onChannelContextMenu(e, gamesCat); } : undefined}
            >
              <ChevronRight
                size={12}
                className={`channel-chevron ${gamesCollapsed ? "" : "channel-chevron-open"}`}
              />
              <span className="channel-category-name">Games</span>
            </button>
            {isOwnerOrAdmin && (
              <button className="channel-settings-btn" onClick={handleCreateInGames} title="Create Channel">
                <Plus size={13} />
              </button>
            )}
            {isOwnerOrAdmin && gamesCat && (
              <button className="channel-settings-btn" onClick={() => onSettingsChannel(gamesCat)} title="Category Settings">
                <Settings size={13} />
              </button>
            )}
          </div>

          {!gamesCollapsed && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={(e) => setGamesDragId(e.active.id as string)}
              onDragEnd={handleGamesDragEnd}
            >
              <SortableContext items={gamesItemIds} strategy={verticalListSortingStrategy}>
                {gamesItems.map((item) => {
                  const isActive = item.kind === "game"
                    ? activeGameId === item.id
                    : item.channel.id === activeChannelId && !activeGameId;
                  const isUnread = item.kind === "text" && unreadChannels.has(item.id) && !isActive;
                  const mCount = item.kind === "text" ? (mentionCounts[item.id] ?? 0) : 0;
                  return (
                    <SortableGamesItem
                      key={item.id}
                      item={item}
                      isActive={isActive}
                      isUnread={isUnread}
                      mentionCount={mCount}
                      isOwnerOrAdmin={isOwnerOrAdmin}
                      isDragging={gamesDragId === item.id}
                      selectChannel={selectChannel}
                      onSettingsChannel={onSettingsChannel}
                      onChannelContextMenu={onChannelContextMenu}
                    />
                  );
                })}
              </SortableContext>

              <DragOverlay dropAnimation={null}>
                {gamesDraggedItem ? (
                  <div className="channel-drag-overlay">
                    {gamesDraggedItem.kind === "game"
                      ? <img src={gamesDraggedItem.game.iconImage} alt={gamesDraggedItem.game.name} className={`channel-game-icon${gamesDraggedItem.game.iconInvert ? " invert" : ""}`} style={{ height: 20 }} />
                      : getChannelIcon("text")}
                    <span>{gamesDraggedItem.kind === "game" ? gamesDraggedItem.game.name : gamesDraggedItem.channel.name}</span>
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>
          )}

          {gamesCollapsed && activeGameId && (() => {
            const game = GAME_CHANNELS.find((g) => g.id === activeGameId);
            if (!game) return null;
            return (
              <div className="channel-sortable-active">
                <div className="channel-item-wrapper">
                  <button className="channel-item active" onClick={() => selectChannel(game.id)}>
                    <img src={game.iconImage} alt={game.name} className={`channel-game-icon${game.iconInvert ? " invert" : ""}`} />
                  </button>
                </div>
              </div>
            );
          })()}
          {gamesCollapsed && !activeGameId && activeChannelId && gameTextChannels.some((c) => c.id === activeChannelId) && (() => {
            const ch = gameTextChannels.find((c) => c.id === activeChannelId)!;
            return (
              <div className="channel-sortable-active">
                <div className="channel-item-wrapper">
                  <button className="channel-item active" onClick={() => selectChannel(ch.id)}>
                    {getChannelIcon("text")}
                    <span className="channel-item-name">{ch.name}</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

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
