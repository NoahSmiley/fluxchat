import {
  Mic, MicOff, Headphones, HeadphoneOff,
  PhoneOff, Monitor, MonitorOff,
} from "lucide-react";

interface VoiceControlsBarProps {
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleScreenShare: () => void;
  leaveVoiceChannel: () => void;
}

export function VoiceControlsBar({
  isMuted,
  isDeafened,
  isScreenSharing,
  toggleMute,
  toggleDeafen,
  toggleScreenShare,
  leaveVoiceChannel,
}: VoiceControlsBarProps) {
  return (
    <div className="voice-controls-bar">
      <button
        className={`voice-ctrl-btn ${isMuted ? "active" : ""}`}
        onClick={toggleMute}
        title={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      <button
        className={`voice-ctrl-btn ${isDeafened ? "active" : ""}`}
        onClick={toggleDeafen}
        title={isDeafened ? "Undeafen" : "Deafen"}
      >
        {isDeafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      </button>
      <button
        className={`voice-ctrl-btn ${isScreenSharing ? "active" : ""}`}
        onClick={() => toggleScreenShare()}
        title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
      >
        {isScreenSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
      </button>
      <button
        className="voice-ctrl-btn disconnect"
        onClick={leaveVoiceChannel}
        title="Disconnect"
      >
        <PhoneOff size={20} />
      </button>
    </div>
  );
}
