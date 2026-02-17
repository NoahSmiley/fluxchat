import { useState } from "react";
import { createPortal } from "react-dom";
import type { Channel, ChannelType } from "../types/shared.js";
import { useChatStore } from "../stores/chat.js";
import { useVoiceStore } from "../stores/voice.js";
import { VoiceStatusBar } from "./VoiceStatusBar.js";
import { MessageSquareText, Volume2, Settings, Monitor, MicOff, HeadphoneOff, Plus, Gamepad2 } from "lucide-react";
import { CreateChannelModal } from "./CreateChannelModal.js";
import { ChannelSettingsModal } from "./ChannelSettingsModal.js";
import { avatarColor, ringClass } from "../lib/avatarColor.js";

// Hardcoded game channels — these always show regardless of DB
const HARDCODED_GAME_CHANNELS: Channel[] = [
  { id: "__game_cs2__", serverId: "", name: "counter-strike-2", type: "game", bitrate: null, createdAt: "" },
];

export function ChannelSidebar() {
  const { channels, activeChannelId, selectChannel, servers, activeServerId, channelsLoaded, members, unreadChannels } = useChatStore();
  const { channelParticipants, connectedChannelId, screenSharers, participants: voiceParticipants, audioLevels } = useVoiceStore();
  const server = servers.find((s) => s.id === activeServerId);
  const isOwnerOrAdmin = server && (server.role === "owner" || server.role === "admin");

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");
  // Merge hardcoded game channels with any DB game channels (dedup by name)
  const dbGameChannels = channels.filter((c) => c.type === "game");
  const hardcodedNames = new Set(HARDCODED_GAME_CHANNELS.map((c) => c.name));
  const gameChannels = [...HARDCODED_GAME_CHANNELS, ...dbGameChannels.filter((c) => !hardcodedNames.has(c.name))];

  const [createModalType, setCreateModalType] = useState<ChannelType | null>(null);
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);

  return (
    <div className="channel-sidebar">
      <div className="channel-list">
        {textChannels.map((channel) => {
          const isUnread = unreadChannels.has(channel.id) && channel.id !== activeChannelId;
          return (
          <div key={channel.id} className="channel-item-wrapper">
            <button
              className={`channel-item ${channel.id === activeChannelId ? "active" : ""} ${isUnread ? "unread" : ""}`}
              onClick={() => selectChannel(channel.id)}
            >
              <MessageSquareText size={14} className="channel-type-icon" />
              {channel.name}
              {isUnread && <span className="channel-unread-dot" />}
            </button>
            {isOwnerOrAdmin && (
              <button
                className="channel-settings-btn"
                onClick={() => setSettingsChannel(channel)}
                title="Channel Settings"
              >
                <Settings size={13} />
              </button>
            )}
          </div>
          );
        })}

        {voiceChannels.length > 0 && textChannels.length > 0 && (
          <div className="channel-divider" />
        )}

        {voiceChannels.map((channel) => {
          const participants = channelParticipants[channel.id] ?? [];
          const isConnected = connectedChannelId === channel.id;
          const hasScreenShare = isConnected && screenSharers.length > 0;
          return (
            <div key={channel.id}>
              <div className="channel-item-wrapper">
                <button
                  className={`channel-item ${channel.id === activeChannelId ? "active" : ""} ${isConnected ? "voice-connected" : ""}`}
                  onClick={() => selectChannel(channel.id)}
                >
                  <Volume2 size={14} className="channel-type-icon" />
                  {channel.name}
                  {hasScreenShare && (
                    <span className="channel-live-badge"><Monitor size={10} /> LIVE</span>
                  )}
                </button>
                {isOwnerOrAdmin && (
                  <button
                    className="channel-settings-btn"
                    onClick={() => setSettingsChannel(channel)}
                    title="Channel Settings"
                  >
                    <Settings size={13} />
                  </button>
                )}
              </div>
              {participants.length > 0 && (
                <div className="voice-channel-users">
                  {participants.map((p) => {
                    const member = members.find((m) => m.userId === p.userId);
                    const voiceUser = isConnected ? voiceParticipants.find((v) => v.userId === p.userId) : null;
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
                        {voiceUser?.isMuted && (
                          <MicOff size={14} className="voice-user-status-icon" />
                        )}
                        {voiceUser?.isDeafened && (
                          <HeadphoneOff size={14} className="voice-user-status-icon" />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {gameChannels.length > 0 && (textChannels.length > 0 || voiceChannels.length > 0) && (
          <div className="channel-divider" />
        )}

        {gameChannels.map((channel) => (
            <div key={channel.id} className="channel-item-wrapper">
              <button
                className={`channel-item game-channel-item ${channel.id === activeChannelId ? "active" : ""}`}
                onClick={() => selectChannel(channel.id)}
              >
                <Gamepad2 size={14} className="channel-type-icon" />
                {channel.id === "__game_cs2__" ? "counter-strike" : channel.name}
              </button>
              {isOwnerOrAdmin && !channel.id.startsWith("__game_") && (
                <button
                  className="channel-settings-btn"
                  onClick={() => setSettingsChannel(channel)}
                  title="Channel Settings"
                >
                  <Settings size={13} />
                </button>
              )}
            </div>
          )
        )}

        {isOwnerOrAdmin && (
          <button
            className="channel-add-bottom-btn"
            onClick={() => setCreateModalType("text")}
            title="Create Channel"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      <VoiceStatusBar />

      {createModalType && activeServerId && createPortal(
        <CreateChannelModal
          serverId={activeServerId}
          defaultType={createModalType}
          onClose={() => setCreateModalType(null)}
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
