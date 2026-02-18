import { useEffect, useRef, useState, useCallback } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { gateway } from "../lib/ws.js";
import { ServerSidebar } from "../components/ServerSidebar.js";
import { ChannelSidebar } from "../components/ChannelSidebar.js";
import { ChatView } from "../components/ChatView.js";
import { VoiceChannelView } from "../components/VoiceChannelView.js";
import { DMChatView } from "../components/DMChatView.js";
import { GameChannelView } from "../components/GameChannelView.js";
import { requestNotificationPermission } from "../lib/notifications.js";
import { SettingsModal } from "../components/SettingsModal.js";
import { EconomyView } from "../components/CaseOpeningModal.js";
import { EconomyToasts } from "../components/EconomyToasts.js";
import { useKeybindListener } from "../hooks/useKeybindListener.js";
import { useIdleDetection } from "../hooks/useIdleDetection.js";
import { useUIStore } from "../stores/ui.js";

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
  useIdleDetection();
  const { loadServers, selectServer, servers, activeServerId, activeChannelId, channels, showingDMs, activeDMChannelId } = useChatStore();
  const { user } = useAuthStore();
  const showingEconomy = useUIStore((s) => s.showingEconomy);
  const [sidebarWidth, setSidebarWidth] = useState(240);

  useEffect(() => {
    gateway.connect();
    loadServers();
    requestNotificationPermission();
    return () => gateway.disconnect();
  }, [loadServers]);

  // Auto-select the single server when available
  useEffect(() => {
    if (servers.length === 1 && !activeServerId && !showingDMs) {
      selectServer(servers[0].id);
    }
  }, [servers, activeServerId, showingDMs, selectServer]);

  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const showChannelSidebar = !showingDMs && !!activeServerId;
  const sidebarPosition = useUIStore((s) => s.sidebarPosition);

  const isHorizontal = sidebarPosition === "top" || sidebarPosition === "bottom";

  // Build grid-template-columns based on server sidebar position
  // Channel sidebar is always on the left side of the chat area
  let gridCols: string;
  if (isHorizontal) {
    gridCols = showChannelSidebar ? `${sidebarWidth}px 1fr` : "1fr";
  } else if (sidebarPosition === "right") {
    gridCols = showChannelSidebar ? `${sidebarWidth}px 1fr 64px` : "1fr 64px";
  } else {
    gridCols = showChannelSidebar ? `64px ${sidebarWidth}px 1fr` : "64px 1fr";
  }

  const gridRows = sidebarPosition === "top" ? "48px 1fr"
    : sidebarPosition === "bottom" ? "1fr 48px"
    : "1fr";

  const gridStyle: React.CSSProperties = { gridTemplateColumns: gridCols, gridTemplateRows: gridRows };

  // Compute grid placements for each element
  const serverStyle: React.CSSProperties = {};
  const channelStyle: React.CSSProperties = {};
  const mainStyle: React.CSSProperties = {};

  if (isHorizontal) {
    const serverRow = sidebarPosition === "top" ? 1 : 2;
    const contentRow = sidebarPosition === "top" ? 2 : 1;
    serverStyle.gridRow = serverRow;
    serverStyle.gridColumn = "1 / -1";
    if (showChannelSidebar) {
      channelStyle.gridRow = contentRow;
      mainStyle.gridRow = contentRow;
      channelStyle.order = 1;
      mainStyle.order = 2;
    } else {
      mainStyle.gridRow = contentRow;
      mainStyle.gridColumn = "1 / -1";
    }
  } else if (sidebarPosition === "right") {
    if (showChannelSidebar) {
      channelStyle.order = 1;
      mainStyle.order = 2;
      serverStyle.order = 3;
    } else {
      mainStyle.order = 1;
      serverStyle.order = 2;
    }
  } else {
    // left (default)
    if (showChannelSidebar) {
      serverStyle.order = 1;
      channelStyle.order = 2;
      mainStyle.order = 3;
    } else {
      serverStyle.order = 1;
      mainStyle.order = 2;
    }
  }

  // Channel sidebar element with resize handle
  const channelSidebarEl = showChannelSidebar ? (
    <div className="sidebar-resizable" style={channelStyle}>
      <ChannelSidebar />
      <ResizeHandle
        side="left"
        onResize={(d) => setSidebarWidth((w) => Math.max(200, Math.min(480, w + d)))}
      />
    </div>
  ) : null;

  return (
    <div className={`app-layout sidebar-${sidebarPosition}`} style={gridStyle}>
      <div className="server-sidebar-cell" style={serverStyle}>
        <ServerSidebar />
      </div>

      {channelSidebarEl}

      <main className="main-content" style={mainStyle}>
        {showingEconomy ? (
          <EconomyView />
        ) : showingDMs ? (
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
          ) : activeChannel?.type === "game" || activeChannelId.startsWith("__game_") ? (
            <GameChannelView />
          ) : (
            <ChatView />
          )
        ) : (
          <div className="empty-state">
            {servers.length === 0 ? (
              <p>Loading...</p>
            ) : !activeServerId ? (
              <p>Loading...</p>
            ) : null}
          </div>
        )}
      </main>

      <SettingsModal />
      <EconomyToasts />
    </div>
  );
}
