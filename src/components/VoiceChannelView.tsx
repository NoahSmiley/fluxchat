import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Track, VideoQuality, type RemoteTrackPublication } from "livekit-client";
import { useVoiceStore } from "../stores/voice.js";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { useSpotifyStore } from "../stores/spotify.js";
import * as api from "../lib/api.js";
import { MusicPanel } from "./MusicPanel.js";
import { SoundboardPanel } from "./SoundboardPanel.js";
import {
  ArrowUpRight, Volume2, Volume1, VolumeX, Mic, MicOff, Headphones, HeadphoneOff,
  PhoneOff, Monitor, MonitorOff, Pin, PinOff, Maximize2, Minimize2,
  Music, Square, Eye, Radio, Plus, Activity,
} from "lucide-react";
import { StatsOverlay } from "./StatsOverlay.js";
import { avatarColor, ringClass, ringGradientStyle, bannerBackground } from "../lib/avatarColor.js";
import { useUIStore } from "../stores/ui.js";

function applyMaxQuality(pub: RemoteTrackPublication) {
  // Request 1080p — matches the max resolution we actually publish
  pub.setVideoDimensions({ width: 1920, height: 1080 });
  pub.setVideoQuality(VideoQuality.HIGH);
}

// ── Single Stream Tile ──
// Attaches a LiveKit video track to a <video> element for one screen sharer.
function StreamTile({ participantId, username, isPinned }: {
  participantId: string;
  username: string;
  isPinned: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pubRef = useRef<RemoteTrackPublication | null>(null);
  const { room, pinScreenShare, unpinScreenShare, toggleTheatreMode, theatreMode } = useVoiceStore();

  useEffect(() => {
    if (!room || !videoRef.current) return;

    let track: Track | undefined;
    pubRef.current = null;

    if (participantId === room.localParticipant.identity) {
      for (const pub of room.localParticipant.videoTrackPublications.values()) {
        if (pub.source === Track.Source.ScreenShare && pub.track) {
          track = pub.track;
          break;
        }
      }
    } else {
      const participant = room.remoteParticipants.get(participantId);
      if (participant) {
        for (const pub of participant.videoTrackPublications.values()) {
          if (pub.source === Track.Source.ScreenShare && pub.track) {
            track = pub.track;
            pubRef.current = pub as RemoteTrackPublication;
            break;
          }
        }
      }
    }

    const videoEl = videoRef.current;

    if (track && videoEl) {
      track.attach(videoEl);
      videoEl.play().catch(() => {});
      if (pubRef.current) {
        const pub = pubRef.current;
        requestAnimationFrame(() => applyMaxQuality(pub));
      }

      // If the video is still black after attach (track not yet producing frames),
      // retry attach when the track's underlying media stream starts
      const mst = track.mediaStreamTrack;
      if (mst && mst.readyState === "live" && videoEl.videoWidth === 0) {
        const retryAttach = () => {
          if (videoRef.current) {
            track!.attach(videoRef.current);
            videoRef.current.play().catch(() => {});
          }
        };
        // Retry on a short interval until we get frames
        const retryId = setInterval(() => {
          if (!videoRef.current || videoRef.current.videoWidth > 0) {
            clearInterval(retryId);
            return;
          }
          retryAttach();
        }, 200);
        // Stop retrying after 3s
        setTimeout(() => clearInterval(retryId), 3000);
      }
    }

    return () => {
      if (track && videoEl) {
        track.detach(videoEl);
      }
      pubRef.current = null;
    };
  }, [room, participantId]);

  return (
    <div className={`stream-tile ${isPinned ? "pinned" : ""}`}>
      <video ref={videoRef} autoPlay playsInline className="stream-tile-video" />

      {/* Bottom bar — username + hover actions */}
      <div className="stream-tile-bottom-bar">
        <span className="stream-tile-label">{username}'s screen</span>
        <div className="stream-tile-actions">
          {isPinned ? (
            <>
              <button className="stream-tile-btn" onClick={toggleTheatreMode} title={theatreMode ? "Exit Theatre Mode" : "Theatre Mode"}>
                {theatreMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button className="stream-tile-btn" onClick={() => import("@tauri-apps/api/core").then(({ invoke }) => invoke("open_popout_window", { windowType: "screenshare" })).catch(() => {})} title="Pop out">
                <ArrowUpRight size={14} />
              </button>
              <button className="stream-tile-btn" onClick={unpinScreenShare} title="Unpin">
                <PinOff size={14} />
              </button>
            </>
          ) : (
            <button className="stream-tile-btn" onClick={() => pinScreenShare(participantId)} title="Pin as main">
              <Pin size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dummy Stream Tile (for preview when showDummyUsers is on) ──
function DummyStreamTile({ participantId, username, isPinned }: {
  participantId: string;
  username: string;
  isPinned: boolean;
}) {
  const color = avatarColor(username);
  const { pinScreenShare, unpinScreenShare } = useVoiceStore();

  return (
    <div className={`stream-tile ${isPinned ? "pinned" : ""}`}>
      <div className="dummy-stream-video" style={{ background: `linear-gradient(135deg, ${color}22, ${color}08)` }}>
        <Monitor size={isPinned ? 64 : 32} style={{ color: `${color}44` }} />
      </div>

      <div className="stream-tile-bottom-bar">
        <span className="stream-tile-label">{username}'s screen</span>
        <div className="stream-tile-actions">
          {isPinned ? (
            <button className="stream-tile-btn" onClick={unpinScreenShare} title="Unpin">
              <PinOff size={14} />
            </button>
          ) : (
            <button className="stream-tile-btn" onClick={() => pinScreenShare(participantId)} title="Pin as main">
              <Pin size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

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

// ── Speaking Avatar ──
// The glow ring animates via rAF reading audio levels directly from the store (no re-render).
// Only the binary speaking boolean triggers a React re-render.
function SpeakingAvatar({ userId, username, image, large, role, memberRingStyle, memberRingSpin, memberRingPatternSeed, isStreaming }: {
  userId: string; username: string; image?: string | null; large?: boolean; role?: string;
  memberRingStyle?: string; memberRingSpin?: boolean; memberRingPatternSeed?: number | null;
  isStreaming?: boolean;
}) {
  const speaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  const rc = ringClass(memberRingStyle, memberRingSpin, role, false, memberRingPatternSeed);

  return (
    <div className={`voice-avatar-wrapper ${large ? "large" : ""}`}>
      <div className={`voice-participant-ring ${rc}`} style={{ "--ring-color": avatarColor(username), ...ringGradientStyle(memberRingPatternSeed, memberRingStyle) } as React.CSSProperties}>
        <div className={`voice-participant-avatar ${speaking ? "speaking" : ""} ${large ? "large" : ""}`}>
          {image ? (
            <img src={image} alt={username} className="avatar-img" />
          ) : (
            username.charAt(0).toUpperCase()
          )}
        </div>
      </div>
      {isStreaming && (
        <div className="voice-avatar-streaming-badge" title="Streaming">
          <Radio size={10} />
        </div>
      )}
    </div>
  );
}

/** Wraps a participant tile so the speaking class updates via store subscription, not parent re-render */
function ParticipantTile({ userId, username, banner, children }: { userId: string; username: string; banner?: string; children: ReactNode }) {
  const speaking = useVoiceStore((s) => s.speakingUserIds.has(userId));
  const color = avatarColor(username);
  return (
    <div
      className={`voice-participant-tile ${speaking ? "speaking" : ""} ${banner ? "has-banner" : ""}`}
      style={{
        "--ring-color": color,
        ...(banner ? { "--tile-banner": banner } : {}),
      } as React.CSSProperties}
    >
      {banner && <div className="voice-tile-banner" />}
      {children}
    </div>
  );
}

// ── Lobby Music Bar (Easter Egg) ──
function LobbyMusicBar() {
  const lobbyMusicPlaying = useVoiceStore((s) => s.lobbyMusicPlaying);
  const lobbyMusicVolume = useVoiceStore((s) => s.lobbyMusicVolume);
  const setLobbyMusicVolume = useVoiceStore((s) => s.setLobbyMusicVolume);
  const stopLobbyMusicAction = useVoiceStore((s) => s.stopLobbyMusicAction);

  if (!lobbyMusicPlaying) return null;

  return (
    <div className="lobby-music-bar">
      <div className="lobby-music-info">
        <Music size={16} className="lobby-music-icon" />
        <span className="lobby-music-label">Waiting Room Music</span>
      </div>
      <div className="lobby-music-controls">
        <button
          className="lobby-music-mute-btn"
          onClick={() => setLobbyMusicVolume(lobbyMusicVolume > 0 ? 0 : 0.15)}
          title={lobbyMusicVolume === 0 ? "Unmute" : "Mute"}
        >
          {lobbyMusicVolume === 0 ? <VolumeX size={16} /> : <Volume1 size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max="50"
          value={Math.round(lobbyMusicVolume * 100)}
          onChange={(e) => setLobbyMusicVolume(parseInt(e.target.value) / 100)}
          className="volume-slider lobby-music-slider"
          title={`Volume: ${Math.round(lobbyMusicVolume * 100)}%`}
        />
        <button
          className="lobby-music-stop-btn"
          onClick={stopLobbyMusicAction}
          title="Stop"
        >
          <Square size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Room Switcher Bar ──
// Simple pill-style row: "Lobby (9) | Room 1 (3) [x] | +"
function RoomSwitcherBar() {
  const { channels, activeServerId } = useChatStore();
  const { connectedChannelId, channelParticipants, joinVoiceChannel } = useVoiceStore();
  const { user } = useAuthStore();
  const [creating, setCreating] = useState(false);

  const rooms = useMemo(() => channels.filter((c) => c.isRoom), [channels]);

  async function handleCreateRoom() {
    if (!activeServerId || creating) return;
    setCreating(true);
    try {
      // Only count rooms with active participants (empty stale rooms don't matter)
      const cp = useVoiceStore.getState().channelParticipants;
      const activeRoomNames = new Set(rooms.filter((r) => (cp[r.id]?.length ?? 0) > 0 || connectedChannelId === r.id).map((r) => r.name));
      let n = 1;
      while (activeRoomNames.has(`Room ${n}`)) n++;
      const name = `Room ${n}`;
      const newRoom = await api.createRoom(activeServerId, name);
      useChatStore.getState().selectChannel(newRoom.id);
      joinVoiceChannel(newRoom.id);
    } catch (err) {
      console.error("Failed to create room:", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleCloseRoom(roomId: string) {
    if (!activeServerId) return;
    try {
      await api.deleteChannel(activeServerId, roomId);
      // Optimistically remove from store (don't wait for WebSocket room_deleted event)
      const { channels, activeChannelId, selectChannel } = useChatStore.getState();
      const remaining = channels.filter((c) => c.id !== roomId);
      useChatStore.setState({ channels: remaining });
      if (activeChannelId === roomId && remaining.length > 0) selectChannel(remaining[0].id);
    } catch (err) {
      console.error("Failed to close room:", err);
    }
  }

  return (
    <div className="room-switcher">
      {rooms.map((room) => {
        const count = (channelParticipants[room.id] ?? []).length;
        const isCurrent = connectedChannelId === room.id;
        const isCreator = room.creatorId === user?.id;
        const isAdminOrOwner = (() => {
          const { servers, activeServerId } = useChatStore.getState();
          const server = servers.find((s) => s.id === activeServerId);
          return server && (server.role === "owner" || server.role === "admin");
        })();
        const canDelete = (isCreator || isAdminOrOwner) && count === 0;
        return (
          <button
            key={room.id}
            className={`room-switcher-pill ${isCurrent ? "active" : ""}`}
            onClick={() => {
              if (!isCurrent) {
                useChatStore.getState().selectChannel(room.id);
                joinVoiceChannel(room.id);
              }
            }}
          >
            {room.name}
            {count > 0 && <span className="room-switcher-count">{count}</span>}
            {canDelete && (
              <span
                className="room-switcher-close"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseRoom(room.id);
                }}
                title="Close room"
              >
                &times;
              </span>
            )}
          </button>
        );
      })}
      {!(connectedChannelId && (channelParticipants[connectedChannelId]?.length ?? 0) <= 1) && (
        <button className="room-switcher-create" onClick={handleCreateRoom} disabled={creating}>
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

// ── Main Export ──
export function VoiceChannelView() {
  const { channels, activeChannelId, activeServerId, members } = useChatStore();
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
    showStatsOverlay,
    toggleStatsOverlay,
  } = useVoiceStore();
  const { loadSession, account, playerState, session, queue, volume, setVolume, youtubeTrack } = useSpotifyStore();
  const showDummyUsers = useUIStore((s) => s.showDummyUsers);
  const [activeTab, setActiveTab] = useState<"voice" | "streams" | "music" | "sounds">("voice");
  const channel = channels.find((c) => c.id === activeChannelId);
  const isConnected = connectedChannelId === activeChannelId;
  // Track if we're switching rooms (was connected, now reconnecting)
  const wasInVoice = useRef(false);
  useEffect(() => {
    if (isConnected) wasInVoice.current = true;
    else if (!connecting) wasInVoice.current = false;
  }, [isConnected, connecting]);
  // Show voice UI during room switches (keep UI stable instead of flashing "Connecting...")
  const showVoiceUI = isConnected || (connecting && wasInVoice.current);
  const rooms = useMemo(() => channels.filter((c) => c.isRoom), [channels]);
  const allScreenSharers = (showDummyUsers && rooms[0]?.id === channel?.id)
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
      {showVoiceUI && (
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

      {connectionError && (
        <div className="voice-error">{connectionError}</div>
      )}

      {!showVoiceUI && !connecting && (
        <div className="voice-join-prompt">
          <span className="voice-join-icon"><Volume2 size={48} /></span>
          <h2>{channel?.name ?? "Voice"}</h2>
          <p>Create or join a room to talk with others.</p>
          <button
            className="btn-primary voice-join-btn"
            onClick={async () => {
              // Create a new room and join it
              if (!activeServerId) return;
              // Only count rooms with active participants
              const cp = useVoiceStore.getState().channelParticipants;
              const activeRoomNames = new Set(rooms.filter((r) => (cp[r.id]?.length ?? 0) > 0 || connectedChannelId === r.id).map((r) => r.name));
              let n = 1;
              while (activeRoomNames.has(`Room ${n}`)) n++;
              const name = `Room ${n}`;
              try {
                const newRoom = await api.createRoom(activeServerId, name);
                useChatStore.getState().selectChannel(newRoom.id);
                joinVoiceChannel(newRoom.id);
              } catch (err) {
                console.error("Failed to create room:", err);
              }
            }}
          >
            Create Room
          </button>
        </div>
      )}

      {connecting && !showVoiceUI && (
        <div className="voice-connecting">
          <div className="loading-spinner" />
          <p>Connecting...</p>
        </div>
      )}

      {showVoiceUI && activeTab === "music" && activeChannelId && (
        <MusicPanel voiceChannelId={activeChannelId} />
      )}

      {showVoiceUI && activeTab === "sounds" && activeServerId && activeChannelId && (
        <SoundboardPanel serverId={activeServerId} channelId={activeChannelId} />
      )}

      {showVoiceUI && activeTab === "streams" && (() => {
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

      {showVoiceUI && activeTab === "voice" && (
        <>
          {/* Participants */}
          <div className="voice-participants-grid">
            {/* DEBUG: dummy voice tiles (only in persistent lobby) */}
            {showDummyUsers && rooms[0]?.id === channel?.id && [
              { userId: "__d1", username: "xKira", bannerCss: "aurora", bannerPatternSeed: null, ringStyle: "sapphire", ringSpin: true, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/128?img=1" },
              { userId: "__d2", username: "Blaze", bannerCss: "sunset", bannerPatternSeed: null, ringStyle: "ruby", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/128?img=8" },
              { userId: "__d3", username: "PhaseShift", bannerCss: "doppler", bannerPatternSeed: 42, ringStyle: "chroma", ringSpin: true, ringPatternSeed: null, role: "owner", image: "https://i.pravatar.cc/128?img=12" },
              { userId: "__d4", username: "Cosmo", bannerCss: "space", bannerPatternSeed: null, ringStyle: "emerald", ringSpin: false, ringPatternSeed: null, role: "admin", image: "https://i.pravatar.cc/128?img=15" },
              { userId: "__d5", username: "ghost404", bannerCss: null, bannerPatternSeed: null, ringStyle: "default", ringSpin: false, ringPatternSeed: null, role: "member", image: "https://i.pravatar.cc/128?img=22" },
              { userId: "__d6", username: "Prism", bannerCss: "gamma_doppler", bannerPatternSeed: 77, ringStyle: "doppler", ringSpin: false, ringPatternSeed: 77, role: "member", image: "https://i.pravatar.cc/128?img=33" },
              { userId: "__d7", username: "Nyx", bannerCss: "cityscape", bannerPatternSeed: null, ringStyle: "gamma_doppler", ringSpin: true, ringPatternSeed: 150, role: "member", image: "https://i.pravatar.cc/128?img=47" },
              { userId: "__d8", username: "ZeroDay", bannerCss: "doppler", bannerPatternSeed: 200, ringStyle: "ruby", ringSpin: true, ringPatternSeed: null, role: "admin", image: "https://i.pravatar.cc/128?img=51" },
            ].map((d) => (
              <ParticipantTile key={d.userId} userId={d.userId} username={d.username} banner={bannerBackground(d.bannerCss, d.bannerPatternSeed)}>
                <SpeakingAvatar
                  userId={d.userId}
                  username={d.username}
                  image={d.image}
                  role={d.role}
                  memberRingStyle={d.ringStyle}
                  memberRingSpin={d.ringSpin}
                  memberRingPatternSeed={d.ringPatternSeed}
                  large
                />
                <span className="voice-tile-name">{d.username}</span>
              </ParticipantTile>
            ))}
            {/* END DEBUG */}
            {participants.map((user) => {
              const member = members.find((m) => m.userId === user.userId);
              const tileBanner = bannerBackground(member?.bannerCss, member?.bannerPatternSeed);
              return (
              <ParticipantTile key={user.userId} userId={user.userId} username={user.username} banner={tileBanner}>
                <SpeakingAvatar
                  userId={user.userId}
                  username={user.username}
                  image={member?.image}
                  role={member?.role}
                  memberRingStyle={member?.ringStyle}
                  memberRingSpin={member?.ringSpin}
                  memberRingPatternSeed={member?.ringPatternSeed}
                  isStreaming={screenSharerIds.has(user.userId)}
                  large
                />
                <span className="voice-tile-name">
                  {user.username}
                  {!!(user.isMuted || user.isDeafened) && (
                    <span className="voice-tile-status-icons">
                      {!!user.isMuted && <MicOff size={14} className="voice-tile-status-icon" />}
                      {!!user.isDeafened && <HeadphoneOff size={14} className="voice-tile-status-icon" />}
                    </span>
                  )}
                </span>
                {user.userId !== room?.localParticipant?.identity && (
                  <div className="voice-tile-volume">
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={Math.round((participantVolumes[user.userId] ?? 1.0) * 100)}
                      onChange={(e) => setParticipantVolume(user.userId, parseInt(e.target.value) / 100)}
                      className="volume-slider"
                      title={`Volume: ${Math.round((participantVolumes[user.userId] ?? 1.0) * 100)}%`}
                    />
                  </div>
                )}
              </ParticipantTile>
            );
            })}
          </div>

          {/* Lobby music bar (easter egg) */}
          <LobbyMusicBar />


          {/* Mini now-playing bar (Spotify or YouTube) */}
          {session && (() => {
            const spotifyTrack = playerState?.track_window?.current_track;
            const npName = youtubeTrack ? youtubeTrack.name : spotifyTrack?.name;
            const npArtist = youtubeTrack ? youtubeTrack.artist : spotifyTrack?.artists.map(a => a.name).join(", ");
            const npArt = youtubeTrack ? youtubeTrack.imageUrl : spotifyTrack?.album.images[0]?.url;
            if (!npName) return null;
            const nextTrack = queue[0];
            return (
              <div className="voice-now-playing">
                {npArt && (
                  <img src={npArt} alt="" className="voice-np-art" />
                )}
                <div className="voice-np-info">
                  <span className="voice-np-name">{npName}</span>
                  <span className="voice-np-artist">{npArtist}</span>
                </div>
                <div className="voice-np-volume">
                  <button
                    className="voice-np-mute-btn"
                    onClick={() => setVolume(volume > 0 ? 0 : 0.5)}
                    title={volume === 0 ? "Unmute Music" : "Mute Music"}
                  >
                    {volume === 0 ? <VolumeX size={16} /> : <Volume1 size={16} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(volume * 100)}
                    onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
                    className="volume-slider voice-np-slider"
                  />
                </div>
                {nextTrack && (
                  <span className="voice-np-next" title={`Next: ${nextTrack.trackName}`}>
                    Next: {nextTrack.trackName}
                  </span>
                )}
              </div>
            );
          })()}
        </>
      )}

      {/* Stats overlay — floating on top when visible */}
      {isConnected && <StatsOverlay />}

      {/* Controls bar — always visible when connected */}
      {isConnected && (
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
            className={`voice-ctrl-btn ${showStatsOverlay ? "active" : ""}`}
            onClick={toggleStatsOverlay}
            title={showStatsOverlay ? "Hide Stats" : "Connection Stats"}
          >
            <Activity size={20} />
          </button>
          <button
            className="voice-ctrl-btn disconnect"
            onClick={leaveVoiceChannel}
            title="Disconnect"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
