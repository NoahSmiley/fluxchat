import { useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import type { Channel, ChannelType, ReorderItem, MemberWithUser } from "../types/shared.js";
import { useChatStore } from "../stores/chat.js";
import { useVoiceStore } from "../stores/voice.js";
import { useUIStore } from "../stores/ui.js";
import { useAuthStore } from "../stores/auth.js";
import { VoiceStatusBar } from "./VoiceStatusBar.js";
import { UserCard } from "./MemberList.js";
import { MessageSquareText, Volume2, Settings, Monitor, Mic, MicOff, HeadphoneOff, Plus, Gamepad2, ChevronRight, Folder, GripVertical } from "lucide-react";
import { CreateChannelModal } from "./CreateChannelModal.js";
import { ChannelSettingsModal } from "./ChannelSettingsModal.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "../lib/avatarColor.js";
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
const DROP_INTO_CATEGORY_DWELL_MS = 1000;

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
    // Channels always before categories, then by position within each group
    list.sort((a, b) => {
      const aIsCat = a.type === "category" ? 1 : 0;
      const bIsCat = b.type === "category" ? 1 : 0;
      if (aIsCat !== bIsCat) return aIsCat - bIsCat;
      return a.position - b.position;
    });
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

function flattenTree(nodes: TreeNode[], collapsed: Set<string>, activeChannelId?: string | null): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.channel.type === "category") {
      if (!collapsed.has(node.channel.id)) {
        result.push(...flattenTree(node.children, collapsed, activeChannelId));
      } else if (activeChannelId) {
        // Category is collapsed, but peek inside for the active channel
        const activeChild = findActiveChild(node.children, activeChannelId);
        if (activeChild) result.push(activeChild);
      }
    }
  }
  return result;
}

/** Recursively search children for the active channel, returning it (with correct depth) if found */
function findActiveChild(nodes: TreeNode[], activeChannelId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.channel.id === activeChannelId) return node;
    if (node.channel.type === "category") {
      const found = findActiveChild(node.children, activeChannelId);
      if (found) return found;
    }
  }
  return null;
}

function getChannelIcon(type: ChannelType, size = 14) {
  switch (type) {
    case "text": return <MessageSquareText size={size} className="channel-type-icon" />;
    case "voice": return <Volume2 size={size} className="channel-type-icon" />;
    case "game": return <Gamepad2 size={size} className="channel-type-icon" />;
    case "category": return <Folder size={size} className="channel-type-icon" />;
  }
}

/** Tiny component so only the mic icon re-renders when speaking state changes, not the whole sidebar */
function SpeakingMic({ userId, isMuted, isDeafened }: { userId: string; isMuted?: boolean; isDeafened?: boolean }) {
  const isSpeaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  if (isDeafened) {
    return <HeadphoneOff size={12} className="voice-speaking-mic deafened" />;
  }
  if (isMuted) {
    return <MicOff size={14} className={`voice-speaking-mic muted ${isSpeaking ? "active" : ""}`} />;
  }
  return <Mic size={14} className={`voice-speaking-mic ${isSpeaking ? "active" : ""}`} />;
}

/** Voice user row with hover-to-inspect UserCard */
function VoiceUserRow({
  userId, username, image, member, banner, ringStyle, ringClassName,
  isMuted, isDeafened, allMembers,
}: {
  userId: string;
  username: string;
  image?: string | null;
  member?: MemberWithUser;
  banner?: string;
  ringStyle: React.CSSProperties;
  ringClassName: string;
  isMuted?: boolean;
  isDeafened?: boolean;
  allMembers: MemberWithUser[];
}) {
  const [showCard, setShowCard] = useState(false);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const rowRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user } = useAuthStore();
  const { onlineUsers, userStatuses, userActivities, openDM, showDMs } = useChatStore();

  const handleMouseEnter = () => {
    if (!member) return;
    hoverTimer.current = setTimeout(() => {
      if (rowRef.current) {
        const rect = rowRef.current.getBoundingClientRect();
        // Position card to the right of the row
        setCardPos({ top: rect.top - 40, left: rect.right + 8 });
        setShowCard(true);
      }
    }, 350); // Short delay to avoid accidental popups
  };

  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setShowCard(false);
  };

  return (
    <>
      <div
        ref={rowRef}
        className="voice-channel-user"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span
          className={`voice-avatar-ring ${ringClassName}`}
          style={ringStyle}
        >
          <span className="voice-user-avatar" style={{ background: image ? 'transparent' : avatarColor(username) }}>
            {image ? (
              <img src={image} alt={username} />
            ) : (
              username.charAt(0).toUpperCase()
            )}
          </span>
        </span>
        <span className="voice-user-name">{username}</span>
        <SpeakingMic userId={userId} isMuted={isMuted} isDeafened={isDeafened} />
      </div>
      {showCard && member && createPortal(
        <div className="voice-user-card-overlay" onMouseLeave={handleMouseLeave}>
          <UserCard
            member={member}
            activity={userActivities[userId]}
            isOnline={onlineUsers.has(userId)}
            status={userStatuses[userId]}
            position={{ top: cardPos.top, left: cardPos.left }}
            onDM={() => { openDM(userId); showDMs(); setShowCard(false); }}
            isSelf={userId === user?.id}
          />
        </div>,
        document.body
      )}
    </>
  );
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
    participants: { userId: string; username: string }[];
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

  const showDummyUsers = useUIStore((s) => s.showDummyUsers);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    paddingLeft: depth * 16,
    opacity: isDragging ? 0.4 : 1,
  };

  if (channel.type === "category") {
    return (
      <div ref={setNodeRef} style={style} {...attributes}>
        <div className={`channel-category-header ${depth === 0 ? "channel-category-root" : ""} ${isDropTarget ? "channel-category-drop-target" : ""}`}>
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
    <div ref={setNodeRef} style={style} {...attributes} className={isActive ? "channel-sortable-active" : undefined}>
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
          <span className="channel-item-name">{channel.name}</span>
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
              allMembers={voiceProps.members}
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
                allMembers={voiceProps.members}
              />
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
  const { showingEconomy, openServerSettings } = useUIStore();
  const server = servers.find((s) => s.id === activeServerId);
  const isOwnerOrAdmin = server && (server.role === "owner" || server.role === "admin");

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [createModal, setCreateModal] = useState<{ type: ChannelType; parentId?: string } | null>(null);
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTargetCategoryId, setDropTargetCategoryId] = useState<string | null>(null);
  const dwellRef = useRef<{ catId: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const dropIntoCategoryRef = useRef<string | null>(null);

  const allChannels = channels;

  const tree = useMemo(() => buildTree(allChannels), [allChannels]);
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
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
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
      const parent = allChannels.find((c) => c.id === newParentId);
      if (!parent || parent.type !== "category") {
        newParentId = null;
      } else if (isActiveCategory) {
        // Prevent circular reference: can't drop a category into its own descendants
        let checkId: string | null = newParentId;
        while (checkId) {
          if (checkId === active.id) { newParentId = null; break; }
          checkId = allChannels.find((c) => c.id === checkId)?.parentId ?? null;
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
      const allSiblings = allChannels
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
      const newSiblings = allChannels
        .filter((c) => (c.parentId ?? null) === (newParentId ?? null) && c.id !== (active.id as string));

      const withMoved = [...newSiblings, activeNode.channel];
      items.push(...assignPositions(withMoved, newParentId));

      // Reorder old siblings to close the gap
      const oldSiblings = allChannels
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
                  isActive={ch.id === activeChannelId && !showingEconomy}
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

        <div style={{ flex: 1 }} />
        <button
          className="channel-add-floating-btn"
          onClick={() => setCreateModal({ type: "text" })}
          title="Create Channel"
        >
          <Plus size={14} />
        </button>
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
