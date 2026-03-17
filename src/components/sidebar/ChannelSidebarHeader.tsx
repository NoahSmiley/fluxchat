import { Settings } from "lucide-react";

interface ChannelSidebarHeaderProps {
  serverName: string;
  isOwnerOrAdmin: boolean;
  onOpenSettings: () => void;
}

export function ChannelSidebarHeader({ serverName, isOwnerOrAdmin, onOpenSettings }: ChannelSidebarHeaderProps) {
  return (
    <div className="channel-sidebar-header">
      <span className="channel-sidebar-header-label">Channels</span>
      <div className="channel-sidebar-header-actions">
        {isOwnerOrAdmin && (
          <button
            className="channel-sidebar-header-btn always-visible"
            title="Server Settings"
            onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
          >
            <Settings size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
