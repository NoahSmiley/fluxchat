import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useVoiceStore } from "@/stores/voice/index.js";
import { useChatStore } from "@/stores/chat/index.js";
import { Mic, MicOff, Headphones, HeadphoneOff, PhoneOff } from "lucide-react";

const ANIM_DURATION = 350;

export function VoiceStatusBar() {
  const { connectedChannelId, isMuted, isDeafened, leaveVoiceChannel, toggleMute, toggleDeafen } =
    useVoiceStore(useShallow((s) => ({
      connectedChannelId: s.connectedChannelId, isMuted: s.isMuted, isDeafened: s.isDeafened,
      leaveVoiceChannel: s.leaveVoiceChannel, toggleMute: s.toggleMute, toggleDeafen: s.toggleDeafen,
    })));
  const channels = useChatStore((s) => s.channels);

  const isConnected = !!connectedChannelId;
  const [visible, setVisible] = useState(isConnected);
  const [animClass, setAnimClass] = useState(isConnected ? "" : "");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wasConnectedRef = useRef(isConnected);

  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // Entering
      clearTimeout(timerRef.current);
      setVisible(true);
      setAnimClass("voice-status-bar-enter");
    } else if (!isConnected && wasConnectedRef.current) {
      // Exiting
      clearTimeout(timerRef.current);
      setAnimClass("voice-status-bar-exit");
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setAnimClass("");
      }, ANIM_DURATION);
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  if (!visible) return null;

  const channel = channels.find((c) => c.id === connectedChannelId);

  return (
    <div className={`voice-status-bar-wrapper ${animClass}`}>
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
    </div>
  );
}
