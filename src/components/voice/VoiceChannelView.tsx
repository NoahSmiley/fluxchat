import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useVoiceStore } from "@/stores/voice/index.js";
import { useChatStore } from "@/stores/chat/index.js";
import { useSpotifyStore } from "@/stores/spotify/index.js";
import { useYouTubeStore } from "@/stores/youtube.js";
import { SoundboardPanel } from "@/components/music/SoundboardPanel.js";

const MusicPanel = lazy(() => import("@/components/music/MusicPanel.js").then(m => ({ default: m.MusicPanel })));
import { StreamTile, DummyStreamTile } from "./StreamTile.js";
import { VoiceParticipantGrid } from "./VoiceParticipantGrid.js";
import { VoiceControlsBar } from "./VoiceControlsBar.js";
import { VoiceJoinPrompt } from "./VoiceJoinPrompt.js";
import {
  Volume2, Monitor, MonitorOff,
  Music, Eye, Radio,
} from "lucide-react";
import { useUIStore } from "@/stores/ui.js";

const DUMMY_STREAMERS = [
  { participantId: "__d1", username: "xKira" },
  { participantId: "__d2", username: "Blaze" },
  { participantId: "__d3", username: "PhaseShift" },
  { participantId: "__d4", username: "Cosmo" },
  { participantId: "__d5", username: "ghost404" },
  { participantId: "__d6", username: "Prism" },
  { participantId: "__d7", username: "Nyx" },
  { participantId: "__d8", username: "ZeroDay" },
  { participantId: "__d9", username: "Spectre" },
  { participantId: "__d10", username: "Volt" },
];

// ── Main Export ──
export function VoiceChannelView() {
  const { channels, activeChannelId, activeServerId, members } = useChatStore(useShallow((s) => ({
    channels: s.channels, activeChannelId: s.activeChannelId, activeServerId: s.activeServerId, members: s.members,
  })));
  const {
    room,
    connectedChannelId,
    connecting,
    connectionError,
    participants,
    isMuted,
    isDeafened,
    isScreenSharing,
    screenSharers,
    pinnedScreenShare,
    theatreMode,
    participantVolumes,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    setParticipantVolume,
    screenShareQuality,
    setScreenShareQuality,
  } = useVoiceStore(useShallow((s) => ({
    room: s.room, connectedChannelId: s.connectedChannelId, connecting: s.connecting,
    connectionError: s.connectionError, participants: s.participants, isMuted: s.isMuted,
    isDeafened: s.isDeafened, isScreenSharing: s.isScreenSharing, screenSharers: s.screenSharers,
    pinnedScreenShare: s.pinnedScreenShare, theatreMode: s.theatreMode,
    participantVolumes: s.participantVolumes, joinVoiceChannel: s.joinVoiceChannel,
    leaveVoiceChannel: s.leaveVoiceChannel, toggleMute: s.toggleMute, toggleDeafen: s.toggleDeafen,
    toggleScreenShare: s.toggleScreenShare, setParticipantVolume: s.setParticipantVolume,
    screenShareQuality: s.screenShareQuality, setScreenShareQuality: s.setScreenShareQuality,
  })));
  const { loadSession, playerState, session, queue, volume, setVolume } = useSpotifyStore();
  const { youtubeTrack } = useYouTubeStore();
  const showDummyUsers = useUIStore((s) => s.showDummyUsers);
  const [activeTab, setActiveTab] = useState<"voice" | "streams" | "music" | "sounds">("voice");
  const channel = channels.find((c) => c.id === activeChannelId);
  const isConnected = connectedChannelId === activeChannelId;
  const allScreenSharers = showDummyUsers
    ? [...screenSharers, ...DUMMY_STREAMERS]
    : screenSharers;
  const hasScreenShares = allScreenSharers.length > 0;
  const screenSharerIds = useMemo(() => new Set(allScreenSharers.map(s => s.participantId)), [allScreenSharers]);

  // Load session when connecting to voice channel or switching to music tab
  useEffect(() => {
    if (isConnected && activeChannelId) {
      loadSession(activeChannelId);
    }
  }, [isConnected, activeChannelId]);

  useEffect(() => {
    if (activeTab === "music" && activeChannelId) {
      loadSession(activeChannelId);
    }
  }, [activeTab, activeChannelId]);

  // Auto-switch to streams tab when a screen share starts
  const prevShareCount = useRef(0);
  useEffect(() => {
    if (screenSharers.length > 0 && prevShareCount.current === 0) {
      setActiveTab("streams");
    }
    prevShareCount.current = screenSharers.length;
  }, [screenSharers.length]);

  // Separate pinned vs unpinned streams
  // Auto-pin the first sharer if nothing is pinned
  const effectivePinned = pinnedScreenShare ?? (allScreenSharers.length > 0 ? allScreenSharers[0].participantId : null);
  const pinnedSharer = allScreenSharers.find((s) => s.participantId === effectivePinned);
  const otherSharers = allScreenSharers.filter((s) => s.participantId !== effectivePinned);

  return (
    <div className={`voice-channel-view ${theatreMode ? "theatre" : ""}`}>
      {isConnected && (
        <div className="voice-channel-tabs">
          <button
            className={`voice-tab ${activeTab === "voice" ? "active" : ""}`}
            onClick={() => setActiveTab("voice")}
          >
            <Volume2 size={14} /> Voice
          </button>
          <button
            className={`voice-tab ${activeTab === "streams" ? "active" : ""}`}
            onClick={() => setActiveTab("streams")}
          >
            <Monitor size={14} /> Streams
            {hasScreenShares && <span className="voice-tab-badge">{allScreenSharers.length}</span>}
          </button>
          <button
            className={`voice-tab ${activeTab === "music" ? "active" : ""}`}
            onClick={() => setActiveTab("music")}
          >
            <Music size={14} /> Music
          </button>
          <button
            className={`voice-tab ${activeTab === "sounds" ? "active" : ""}`}
            onClick={() => setActiveTab("sounds")}
          >
            <Volume2 size={14} /> Sounds
          </button>
        </div>
      )}

      {/* Pre-join / connecting state */}
      {!isConnected && (
        <VoiceJoinPrompt
          channelName={channel?.name ?? "Voice Channel"}
          connecting={connecting}
          connectionError={connectionError}
          activeChannelId={activeChannelId}
          joinVoiceChannel={joinVoiceChannel}
        />
      )}

      {/* Connection error while connected */}
      {isConnected && connectionError && (
        <div className="voice-error">{connectionError}</div>
      )}

      {isConnected && activeTab === "music" && activeChannelId && (
        <Suspense fallback={null}><MusicPanel voiceChannelId={activeChannelId} /></Suspense>
      )}

      {isConnected && activeTab === "sounds" && activeServerId && activeChannelId && (
        <SoundboardPanel serverId={activeServerId} channelId={activeChannelId} />
      )}

      {isConnected && activeTab === "streams" && (() => {
        const localIsSharing = isScreenSharing;
        const viewerCount = participants.length - screenSharers.length;
        const isDummy = (id: string) => id.startsWith("__d");

        const renderStreamTile = (sharer: { participantId: string; username: string }, pinned: boolean) => {
          if (isDummy(sharer.participantId)) {
            return (
              <DummyStreamTile
                key={sharer.participantId}
                participantId={sharer.participantId}
                username={sharer.username}
                isPinned={pinned}
              />
            );
          }
          return (
            <StreamTile
              key={sharer.participantId}
              participantId={sharer.participantId}
              username={sharer.username}
              isPinned={pinned}
            />
          );
        };

        return (
          <div className="streams-tab-view">
            {hasScreenShares ? (
              <div className="streams-layout">
                {/* Main stream area */}
                <div className="streams-main">
                  <div className="streams-area">
                    {/* Pinned (main) stream */}
                    {pinnedSharer && renderStreamTile(pinnedSharer, true)}

                    {/* Other streams as smaller tiles */}
                    {otherSharers.length > 0 && (
                      <div className="streams-secondary">
                        {otherSharers.map((sharer) => renderStreamTile(sharer, false))}
                      </div>
                    )}
                  </div>

                  {/* Streamer controls (shown when you're the one sharing) */}
                  {localIsSharing && (
                    <div className="stream-your-controls">
                      <div className="stream-your-status">
                        <Radio size={14} className="stream-pulse-icon" />
                        <span>You are streaming</span>
                        <div className="stream-viewer-pill">
                          <Eye size={11} />
                          <span>{viewerCount}</span>
                        </div>
                      </div>
                      <div className="stream-your-actions">
                        <div className="stream-quality-select-wrap">
                          <select
                            className="stream-quality-select"
                            value={screenShareQuality}
                            onChange={(e) => setScreenShareQuality(e.target.value as typeof screenShareQuality)}
                          >
                            <option value="480p30">480p 30fps</option>
                            <option value="720p30">720p 30fps</option>
                            <option value="720p60">720p 60fps</option>
                            <option value="1080p30">1080p 30fps</option>
                            <option value="1080p60">1080p 60fps</option>
                            <option value="Lossless">Lossless</option>
                          </select>
                        </div>
                        <button
                          className="stream-stop-btn"
                          onClick={() => toggleScreenShare()}
                        >
                          <MonitorOff size={14} />
                          Stop Stream
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* removed viewers sidebar */}
              </div>
            ) : (
              <div className="streams-empty">
                <div className="streams-empty-icon">
                  <Monitor size={48} />
                </div>
                <h3>No Active Streams</h3>
                <p>When someone shares their screen, it will appear here.</p>
                <button
                  className="streams-start-btn"
                  onClick={() => toggleScreenShare()}
                >
                  <Monitor size={16} />
                  Start Streaming
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {isConnected && activeTab === "voice" && (
        <VoiceParticipantGrid
          participants={participants}
          members={members}
          localParticipantIdentity={room?.localParticipant?.identity}
          participantVolumes={participantVolumes}
          setParticipantVolume={setParticipantVolume}
          screenSharerIds={screenSharerIds}
          showDummyUsers={showDummyUsers}
          session={session}
          playerState={playerState}
          youtubeTrack={youtubeTrack}
          queue={queue}
          volume={volume}
          setVolume={setVolume}
        />
      )}

      {/* Controls bar -- always visible when connected */}
      {isConnected && (
        <VoiceControlsBar
          isMuted={isMuted}
          isDeafened={isDeafened}
          isScreenSharing={isScreenSharing}
          toggleMute={toggleMute}
          toggleDeafen={toggleDeafen}
          toggleScreenShare={toggleScreenShare}
          leaveVoiceChannel={leaveVoiceChannel}
        />
      )}
    </div>
  );
}
