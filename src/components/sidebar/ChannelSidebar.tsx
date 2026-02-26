import { useState, useMemo, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { Map } from "lucide-react";
import type { Channel, ChannelType } from "@/types/shared.js";
import { useChatStore } from "@/stores/chat/index.js";
import { useVoiceStore } from "@/stores/voice/index.js";
import { useUIStore } from "@/stores/ui.js";
import { useAuthStore } from "@/stores/auth.js";
import { VoiceStatusBar } from "@/components/voice/VoiceStatusBar.js";
import { loadCollapsed, saveCollapsed } from "@/lib/channel-tree.js";
import { ChannelSidebarHeader } from "./ChannelSidebarHeader.js";
import { ChannelTree } from "./ChannelTree.js";
import { JoinVoiceSection } from "./JoinVoiceSection.js";
import { ChannelSidebarMenus } from "./ChannelSidebarMenus.js";

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
  const roadmapOpen = useUIStore((s) => s.roadmapOpen);
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

  // Collapsed categories
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

      <button
        className={`roadmap-sidebar-item${roadmapOpen ? " active" : ""}`}
        onClick={() => {
          useUIStore.getState().openRoadmap();
          useChatStore.setState({ activeChannelId: null });
        }}
      >
        <Map size={16} />
        <span>Roadmap</span>
      </button>

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

      {activeServerId && (
        <ChannelSidebarMenus
          activeServerId={activeServerId}
          isOwnerOrAdmin={isOwnerOrAdmin}
          connectedChannelId={connectedChannelId}
          rooms={rooms}
          unreadChannels={unreadChannels}
          collapsed={collapsed}
          toggleCollapse={toggleCollapse}
          createModal={createModal}
          setCreateModal={setCreateModal}
          settingsChannel={settingsChannel}
          setSettingsChannel={setSettingsChannel}
          channelCtxMenu={channelCtxMenu}
          setChannelCtxMenu={setChannelCtxMenu}
          sidebarCtxMenu={sidebarCtxMenu}
          setSidebarCtxMenu={setSidebarCtxMenu}
          deletingChannel={deletingChannel}
          setDeletingChannel={setDeletingChannel}
          isDeleting={isDeleting}
          setIsDeleting={setIsDeleting}
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          roomCtxMenu={roomCtxMenu}
          setRoomCtxMenu={setRoomCtxMenu}
          renamingRoomId={renamingRoomId}
          setRenamingRoomId={setRenamingRoomId}
          markChannelRead={markChannelRead}
          user={user}
        />
      )}
    </div>
  );
}
