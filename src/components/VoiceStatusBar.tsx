import { useRef, useState } from "react";
import { useVoiceStore } from "../stores/voice.js";
import { useChatStore } from "../stores/chat.js";
import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff } from "lucide-react";

export function VoiceStatusBar() {
  const { connectedChannelId, isMuted, isDeafened, leaveVoiceChannel, toggleMute, toggleDeafen } =
    useVoiceStore();
  const { channels } = useChatStore();
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [easterEggFlash, setEasterEggFlash] = useState(false);

  if (!connectedChannelId) return null;

  const channel = channels.find((c) => c.id === connectedChannelId);

  function handleLabelClick() {
    clickCountRef.current += 1;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      localStorage.setItem("flux-lobby-music-unlocked", "true");
      setEasterEggFlash(true);
      setTimeout(() => setEasterEggFlash(false), 1500);
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 500);
    }
  }

  return (
    <div className="voice-status-bar">
      <div className="voice-status-info">
        <span
          className={`voice-status-label ${easterEggFlash ? "lobby-music-unlocked" : ""}`}
          onClick={handleLabelClick}
        >
          {easterEggFlash ? "\u266A Lobby Music Unlocked" : "Connected"}
        </span>
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
