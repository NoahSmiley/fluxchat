import { Volume2 } from "lucide-react";

export interface VoiceJoinPromptProps {
  channelName: string;
  connecting: boolean;
  connectionError: string | null;
  activeChannelId: string | null;
  joinVoiceChannel: (channelId: string) => void;
}

export function VoiceJoinPrompt({
  channelName,
  connecting,
  connectionError,
  activeChannelId,
  joinVoiceChannel,
}: VoiceJoinPromptProps) {
  return (
    <>
      {connectionError && (
        <div className="voice-error">{connectionError}</div>
      )}

      {!connecting && (
        <div className="voice-join-prompt">
          <span className="voice-join-icon"><Volume2 size={48} /></span>
          <h2>{channelName}</h2>
          <p>No one is currently in this voice channel.</p>
          <button
            className="btn-primary voice-join-btn"
            onClick={() => activeChannelId && joinVoiceChannel(activeChannelId)}
          >
            Join Voice
          </button>
        </div>
      )}

      {connecting && (
        <div className="voice-connecting">
          <div className="loading-spinner" />
          <p>Connecting...</p>
        </div>
      )}
    </>
  );
}
