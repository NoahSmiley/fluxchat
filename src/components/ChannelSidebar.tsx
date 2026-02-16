import { useState } from "react";
import type { Channel, ChannelType } from "../types/shared.js";
import { useChatStore } from "../stores/chat.js";
import { useVoiceStore } from "../stores/voice.js";
import { VoiceStatusBar } from "./VoiceStatusBar.js";
import { Settings, Monitor, MicOff, HeadphoneOff } from "lucide-react";
import { CreateChannelModal } from "./CreateChannelModal.js";
import { ChannelSettingsModal } from "./ChannelSettingsModal.js";

export function ChannelSidebar() {
  const { channels, activeChannelId, selectChannel, servers, activeServerId, channelsLoaded, members } = useChatStore();
  const { channelParticipants, connectedChannelId, screenSharers, participants: voiceParticipants, audioLevels } = useVoiceStore();
  const server = servers.find((s) => s.id === activeServerId);
  const isOwnerOrAdmin = server && (server.role === "owner" || server.role === "admin");

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  const [createModalType, setCreateModalType] = useState<ChannelType | null>(null);
  const [settingsChannel, setSettingsChannel] = useState<Channel | null>(null);

  return (
    <div className="channel-sidebar">
      <div className="channel-sidebar-header" />

      <div className="channel-list">
        {textChannels.length > 0 && (
          <>
            <div className="channel-category-header">
              <span>Text Channels</span>
              {isOwnerOrAdmin && (
                <button className="channel-add-btn" onClick={() => setCreateModalType("text")} title="Create Text Channel">
                  +
                </button>
              )}
            </div>
            {textChannels.map((channel) => (
              <div key={channel.id} className="channel-item-wrapper">
                <button
                  className={`channel-item ${channel.id === activeChannelId ? "active" : ""}`}
                  onClick={() => selectChannel(channel.id)}
                >
                  {channel.name}
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
            ))}
          </>
        )}

        {voiceChannels.length > 0 && (
          <>
            <div className="channel-category-header">
              <span>Voice Channels</span>
              {isOwnerOrAdmin && (
                <button className="channel-add-btn" onClick={() => setCreateModalType("voice")} title="Create Voice Channel">
                  +
                </button>
              )}
            </div>
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
                            <span className={`voice-user-avatar ${voiceUser?.speaking ? "speaking" : ""}`}>
                              {member?.image ? (
                                <img src={member.image} alt={p.username} />
                              ) : (
                                p.username.charAt(0).toUpperCase()
                              )}
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
          </>
        )}

        {textChannels.length === 0 && voiceChannels.length === 0 && channelsLoaded && isOwnerOrAdmin && (
          <div style={{ padding: "16px", textAlign: "center" }}>
            <button className="btn-small" onClick={() => setCreateModalType("text")}>
              Create a Channel
            </button>
          </div>
        )}
      </div>

      <VoiceStatusBar />

      {createModalType && activeServerId && (
        <CreateChannelModal
          serverId={activeServerId}
          defaultType={createModalType}
          onClose={() => setCreateModalType(null)}
        />
      )}

      {settingsChannel && activeServerId && (
        <ChannelSettingsModal
          channel={settingsChannel}
          serverId={activeServerId}
          onClose={() => setSettingsChannel(null)}
        />
      )}
    </div>
  );
}
