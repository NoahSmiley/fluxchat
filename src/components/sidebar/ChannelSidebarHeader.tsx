import { Settings } from "lucide-react";

interface ChannelSidebarHeaderProps {
  serverName: string;
  isOwnerOrAdmin: boolean;
  onOpenSettings: () => void;
}

export function ChannelSidebarHeader({ serverName, isOwnerOrAdmin, onOpenSettings }: ChannelSidebarHeaderProps) {
  return (
    <div
      className="channel-sidebar-header"
      onClick={isOwnerOrAdmin ? onOpenSettings : undefined}
      style={{ cursor: isOwnerOrAdmin ? "pointer" : "default" }}
    >
      <span className="channel-sidebar-header-title">{serverName}</span>
      {isOwnerOrAdmin && (
        <button
          className="channel-sidebar-header-btn"
          title="Server Settings"
          onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
        >
          <Settings size={14} />
        </button>
      )}
    </div>
  );
}
