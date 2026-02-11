import { useEffect, useRef, useState, useCallback } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { gateway } from "../lib/ws.js";
import { ServerSidebar } from "../components/ServerSidebar.js";
import { ChannelSidebar } from "../components/ChannelSidebar.js";
import { ChatView } from "../components/ChatView.js";
import { VoiceChannelView } from "../components/VoiceChannelView.js";
import { DMSidebar } from "../components/DMSidebar.js";
import { DMChatView } from "../components/DMChatView.js";
import { MemberList } from "../components/MemberList.js";
import { requestNotificationPermission } from "../lib/notifications.js";
import { SettingsModal } from "../components/SettingsModal.js";
import { useKeybindListener } from "../hooks/useKeybindListener.js";

function ResizeHandle({ onResize, side }: { onResize: (delta: number) => void; side: "left" | "right" }) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = side === "left" ? e.clientX - lastX.current : lastX.current - e.clientX;
      lastX.current = e.clientX;
      onResize(delta);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [onResize, side]);

  return <div className="resize-handle" onMouseDown={onMouseDown} />;
}

export function MainLayout() {
  useKeybindListener();
  const { loadServers, activeServerId, activeChannelId, channels, showingDMs, activeDMChannelId, members } = useChatStore();
  const { user } = useAuthStore();
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [memberWidth, setMemberWidth] = useState(200);

  useEffect(() => {
    gateway.connect();
    loadServers();
    requestNotificationPermission();
    return () => gateway.disconnect();
  }, [loadServers]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const showSidebar = showingDMs || !!activeServerId;
  const showMembers = !!activeServerId && members.length > 0 && !showingDMs;

  const gridCols = showSidebar
    ? `72px ${sidebarWidth}px 1fr${showMembers ? ` ${memberWidth}px` : ""}`
    : `72px 1fr`;

  return (
    <div className="app-layout" style={{ gridTemplateColumns: gridCols }}>
      <ServerSidebar />

      {showingDMs ? (
        <div className="sidebar-resizable">
          <DMSidebar />
          <ResizeHandle side="left" onResize={(d) => setSidebarWidth((w) => Math.max(200, Math.min(480, w + d)))} />
        </div>
      ) : activeServerId ? (
        <div className="sidebar-resizable">
          <ChannelSidebar />
          <ResizeHandle side="left" onResize={(d) => setSidebarWidth((w) => Math.max(200, Math.min(480, w + d)))} />
        </div>
      ) : null}

      <main className="main-content" style={!showSidebar ? { gridColumn: '2 / -1' } : undefined}>
        {showingDMs ? (
          activeDMChannelId ? (
            <DMChatView />
          ) : (
            <div className="empty-state">
              <h2>Direct Messages</h2>
              <p>Select a conversation or start a new one</p>
            </div>
          )
        ) : activeChannelId ? (
          activeChannel?.type === "voice" ? (
            <VoiceChannelView />
          ) : (
            <ChatView />
          )
        ) : (
          <div className="empty-state">
            {!activeServerId && <h2>Welcome, {user?.username}</h2>}
            <p>{activeServerId ? "" : "Select a server and channel to get started"}</p>
          </div>
        )}
      </main>

      {showMembers && (
        <div className="member-list-resizable">
          <ResizeHandle side="right" onResize={(d) => setMemberWidth((w) => Math.max(140, Math.min(400, w + d)))} />
          <MemberList />
        </div>
      )}
      <SettingsModal />
    </div>
  );
}
