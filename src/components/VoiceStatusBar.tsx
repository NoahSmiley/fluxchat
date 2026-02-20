import { useVoiceStore } from "../stores/voice.js";
import { useChatStore } from "../stores/chat.js";
import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff } from "lucide-react";

export function VoiceStatusBar() {
  const { connectedChannelId, isMuted, isDeafened, leaveVoiceChannel, toggleMute, toggleDeafen } =
    useVoiceStore();
  const { channels } = useChatStore();

  if (!connectedChannelId) return null;

  const channel = channels.find((c) => c.id === connectedChannelId);

  return (
    <div className="voice-status-bar">
      <div className="voice-status-info">
        <span className="voice-status-label">Connected</span>
        <span className="voice-status-channel">{channel?.name ?? "Unknown"}</span>
      </div>
      <div className="voice-status-controls">
        <button
          className={`voice-status-btn ${isMuted ? "active" : ""}`}
          onClick={toggleMute}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
        </button>
        <button
          className={`voice-status-btn ${isDeafened ? "active" : ""}`}
          onClick={toggleDeafen}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
          {isDeafened ? <HeadphoneOff size={14} /> : <Headphones size={14} />}
        </button>
        <button
          className="voice-status-btn disconnect"
          onClick={leaveVoiceChannel}
          title="Disconnect"
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>
  );
}
