import { useState, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import type { Channel, ChannelType } from "../../types/shared.js";
import { useChatStore } from "../../stores/chat.js";
import { useVoiceStore } from "../../stores/voice.js";
import { useUIStore } from "../../stores/ui.js";
import { useAuthStore } from "../../stores/auth.js";
import { useNotifStore, type ChannelNotifSetting, type CategoryNotifSetting } from "../../stores/notifications.js";
import { VoiceStatusBar } from "../voice/VoiceStatusBar.js";
import { CreateChannelModal } from "../modals/CreateChannelModal.js";
import { ChannelSettingsModal, DeleteConfirmDialog } from "../modals/ChannelSettingsModal.js";
import ContextMenu, { type ContextMenuEntry } from "../ContextMenu.js";
import * as api from "../../lib/api.js";
import { dbg } from "../../lib/debug.js";
import { loadCollapsed, saveCollapsed } from "../../lib/channel-tree.js";
import { ChannelSidebarHeader } from "./ChannelSidebarHeader.js";
import { ChannelTree } from "./ChannelTree.js";
import { JoinVoiceSection } from "./JoinVoiceSection.js";

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
  const openServerSettings = useUIStore((s) => s.openServerSettings);
  const notifStore = useNotifStore();
  const { user } = useAuthStore();
  const server = servers.find((s) => s.id === activeServerId);
  const isOwnerOrAdmin = !!(server && (server.role === "owner" || server.role === "admin"));

  const rooms = useMemo(() => channels.filter((c) => c.isRoom), [channels]);

  // Modal / context-menu state
  const [createModal, setCreateModal] = useState<{ type: ChannelType; parentId?: string } | null>(null);
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);
  const [channelCtxMenu, setChannelCtxMenu] = useState<{ x: number; y: number; channel: Channel } | null>(null);
  const [sidebarCtxMenu, setSidebarCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; userId: string; username: string; channelId: string } | null>(null);
  const [roomCtxMenu, setRoomCtxMenu] = useState<{ x: number; y: number; room: Channel } | null>(null);
  const [renamingRoomId, setRenamingRoomId] = useState<string | null>(null);

  // Collapsed categories — owned here so both ChannelTree and context menus share the same state.
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveCollapsed(next);
      return next;
    });
  }, []);

  return (
    <div className="channel-sidebar">
      {server && (
        <ChannelSidebarHeader
          serverName={server.name}
          isOwnerOrAdmin={isOwnerOrAdmin}
          onOpenSettings={openServerSettings}
        />
      )}

      {activeServerId && (
        <ChannelTree
          channels={channels}
          activeChannelId={activeChannelId}
          activeServerId={activeServerId}
          isOwnerOrAdmin={isOwnerOrAdmin}
          members={members}
          unreadChannels={unreadChannels}
          mentionCounts={mentionCounts}
          channelParticipants={channelParticipants}
          connectedChannelId={connectedChannelId}
          screenSharers={screenSharers}
          voiceParticipants={voiceParticipants}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          selectChannel={selectChannel}
          onCreateChannel={(opts) => setCreateModal(opts)}
          onSettingsChannel={(ch) => setSettingsChannel(ch)}
          onChannelContextMenu={(e, ch) => setChannelCtxMenu({ x: e.clientX, y: e.clientY, channel: ch })}
          onSidebarContextMenu={(e) => setSidebarCtxMenu({ x: e.clientX, y: e.clientY })}
        />
      )}

      {activeServerId && (
        <JoinVoiceSection
          channels={channels}
          rooms={rooms}
          activeServerId={activeServerId}
          isOwnerOrAdmin={isOwnerOrAdmin}
          members={members}
          channelParticipants={channelParticipants}
          connectedChannelId={connectedChannelId}
          connecting={connecting}
          screenSharers={screenSharers}
          voiceParticipants={voiceParticipants}
          selectChannel={selectChannel}
          onRoomContextMenu={(e, room) => setRoomCtxMenu({ x: e.clientX, y: e.clientY, room })}
          onUserContextMenu={(e, userId, username, channelId) => setContextMenu({ x: e.clientX, y: e.clientY, userId, username, channelId })}
          renamingRoomId={renamingRoomId}
          setRenamingRoomId={setRenamingRoomId}
        />
      )}

      <VoiceStatusBar />

      {/* --- Modals --- */}
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

      {/* --- Voice user move context menu --- */}
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

      {/* --- Channel context menu --- */}
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

      {/* --- Sidebar background context menu --- */}
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

      {/* --- Room context menu --- */}
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
                if (connectedChannelId === room.id) {
                  useVoiceStore.getState().leaveVoiceChannel();
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

      {/* --- Delete confirmation dialog --- */}
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
