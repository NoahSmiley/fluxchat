import {
  Mic, MicOff, Headphones, HeadphoneOff,
  PhoneOff, Monitor, MonitorOff,
} from "lucide-react";

interface VoiceControlsBarProps {
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  micVolume: number;
  speakerVolume: number;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleScreenShare: () => void;
  leaveVoiceChannel: () => void;
  onMicVolumeChange: (volume: number) => void;
  onSpeakerVolumeChange: (volume: number) => void;
}

export function VoiceControlsBar({
  isMuted,
  isDeafened,
  isScreenSharing,
  micVolume,
  speakerVolume,
  toggleMute,
  toggleDeafen,
  toggleScreenShare,
  leaveVoiceChannel,
  onMicVolumeChange,
  onSpeakerVolumeChange,
}: VoiceControlsBarProps) {
  return (
    <div className="voice-controls-bar">
      <div className="voice-master-slider">
        <input
          type="range"
          min="0"
          max="200"
          value={Math.round(micVolume * 100)}
          onChange={(e) => onMicVolumeChange(parseInt(e.target.value) / 100)}
          className="volume-slider voice-master-range"
          title={`Mic: ${Math.round(micVolume * 100)}%`}
        />
      </div>
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
      <div className="voice-master-slider">
        <input
          type="range"
          min="0"
          max="200"
          value={Math.round(speakerVolume * 100)}
          onChange={(e) => onSpeakerVolumeChange(parseInt(e.target.value) / 100)}
          className="volume-slider voice-master-range"
          title={`Speaker: ${Math.round(speakerVolume * 100)}%`}
        />
      </div>
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
