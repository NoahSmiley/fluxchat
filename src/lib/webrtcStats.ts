import type { Room } from "livekit-client";
import { Track } from "livekit-client";

export interface WebRTCQualityStats {
  // Audio
  audioBitrate: number; // kbps
  audioCodec: string;
  audioPacketLoss: number; // percentage 0-100
  audioJitter: number; // seconds
  rtt: number; // milliseconds
  audioSampleRate: number; // Hz (e.g. 48000)
  audioChannels: number; // 1=mono, 2=stereo
  opusFec: boolean; // whether FEC is negotiated

  // Video (when screen sharing)
  videoBitrate: number; // kbps
  videoCodec: string;
  videoWidth: number;
  videoHeight: number;
  videoFramerate: number;

  // Connection
  connectionType: string; // e.g. "relay", "srflx", "host"
}

// Previous byte counts for delta-based bitrate calculation
let prevAudioBytesSent = 0;
let prevAudioBytesReceived = 0;
let prevVideoBytesSent = 0;
let prevTimestamp = 0;

export function resetStatsDelta(): void {
  prevAudioBytesSent = 0;
  prevAudioBytesReceived = 0;
  prevVideoBytesSent = 0;
  prevTimestamp = 0;
}

export async function collectWebRTCStats(room: Room): Promise<WebRTCQualityStats> {
  const stats: WebRTCQualityStats = {
    audioBitrate: 0,
    audioCodec: "",
    audioPacketLoss: 0,
    audioJitter: 0,
    rtt: 0,
    audioSampleRate: 0,
    audioChannels: 0,
    opusFec: false,
    videoBitrate: 0,
    videoCodec: "",
    videoWidth: 0,
    videoHeight: 0,
    videoFramerate: 0,
    connectionType: "",
  };

  const now = Date.now();
  const elapsed = prevTimestamp > 0 ? (now - prevTimestamp) / 1000 : 0;
  prevTimestamp = now;

  // RTCP-based RTT (from remote-inbound-rtp) — used as fallback only
  let rtcpRtt = 0;

  // Collect audio sender stats (our mic — only one publication expected)
  const audioPubs = [...room.localParticipant.audioTrackPublications.values()];
  const firstAudioPub = audioPubs.find((p) => p.track?.sender);
  if (firstAudioPub?.track?.sender) {
    const report = await firstAudioPub.track.sender.getStats();
    for (const s of report.values()) {
      if (s.type === "outbound-rtp" && s.kind === "audio") {
        const bytesSent = s.bytesSent ?? 0;
        if (elapsed > 0 && prevAudioBytesSent > 0) {
          const deltaBytes = bytesSent - prevAudioBytesSent;
          stats.audioBitrate = Math.round((deltaBytes * 8) / elapsed / 1000); // kbps
        }
        prevAudioBytesSent = bytesSent;

        // Packet loss
        const sent = s.packetsSent ?? 0;
        const lost = s.packetsLost ?? 0;
        if (sent + lost > 0) {
          stats.audioPacketLoss = Math.round((lost / (sent + lost)) * 10000) / 100;
        }
      }

      if (s.type === "remote-inbound-rtp" && s.kind === "audio") {
        stats.audioJitter = s.jitter ?? 0;
        // Store RTCP-based RTT as fallback only — prefer ICE candidate-pair below
        rtcpRtt = Math.round((s.roundTripTime ?? 0) * 1000);
      }

      if (s.type === "codec") {
        // Extract codec name from mimeType like "audio/opus"
        if (s.mimeType?.startsWith("audio/")) {
          stats.audioCodec = s.mimeType.split("/")[1] ?? "";
          // Extract sample rate and channels from codec stats
          stats.audioSampleRate = s.clockRate ?? 0;
          stats.audioChannels = s.channels ?? 0;
          // Check for FEC in SDP format line
          if (s.sdpFmtpLine) {
            stats.opusFec = (s.sdpFmtpLine as string).includes("useinbandfec=1");
          }
        }
      }
    }
  }

  // Fallback: get channels from track settings if not available from codec stats
  if (stats.audioChannels === 0 && firstAudioPub?.track) {
    const trackSettings = (firstAudioPub.track as any).mediaStreamTrack?.getSettings?.();
    if (trackSettings?.channelCount) {
      stats.audioChannels = trackSettings.channelCount;
    }
  }

  // Collect audio receiver stats (to supplement packet loss from remote)
  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.audioTrackPublications.values()) {
      const receiver = pub.track?.receiver;
      if (!receiver) continue;

      const report = await receiver.getStats();
      for (const s of report.values()) {
        if (s.type === "inbound-rtp" && s.kind === "audio") {
          if (elapsed > 0 && prevAudioBytesReceived > 0) {
            // Use received bitrate if we don't have sent bitrate
            if (stats.audioBitrate === 0) {
              const deltaBytes = (s.bytesReceived ?? 0) - prevAudioBytesReceived;
              stats.audioBitrate = Math.round((deltaBytes * 8) / elapsed / 1000);
            }
          }
          prevAudioBytesReceived = s.bytesReceived ?? 0;

          // Inbound packet loss
          const received = s.packetsReceived ?? 0;
          const lost = s.packetsLost ?? 0;
          if (received + lost > 0 && stats.audioPacketLoss === 0) {
            stats.audioPacketLoss = Math.round((lost / (received + lost)) * 10000) / 100;
          }

          if (!stats.audioCodec && s.codecId) {
            // Will be resolved from codec stats
          }
          stats.audioJitter = stats.audioJitter || (s.jitter ?? 0);
        }

        if (s.type === "codec" && !stats.audioCodec) {
          if (s.mimeType?.startsWith("audio/")) {
            stats.audioCodec = s.mimeType.split("/")[1] ?? "";
          }
        }
      }
      break; // Only need first remote participant stats
    }
  }

  // Collect video sender stats (screen share)
  for (const pub of room.localParticipant.videoTrackPublications.values()) {
    if (pub.source !== Track.Source.ScreenShare) continue;
    const sender = pub.track?.sender;
    if (!sender) continue;

    const report = await sender.getStats();
    for (const s of report.values()) {
      if (s.type === "outbound-rtp" && s.kind === "video") {
        if (elapsed > 0 && prevVideoBytesSent > 0) {
          const deltaBytes = (s.bytesSent ?? 0) - prevVideoBytesSent;
          stats.videoBitrate = Math.round((deltaBytes * 8) / elapsed / 1000);
        }
        prevVideoBytesSent = s.bytesSent ?? 0;
        stats.videoWidth = s.frameWidth ?? 0;
        stats.videoHeight = s.frameHeight ?? 0;
        stats.videoFramerate = Math.round(s.framesPerSecond ?? 0);
      }

      if (s.type === "codec") {
        if (s.mimeType?.startsWith("video/")) {
          stats.videoCodec = s.mimeType.split("/")[1] ?? "";
        }
      }
    }
  }

  // Collect video receiver stats (viewing someone's screen share)
  if (stats.videoBitrate === 0) {
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.videoTrackPublications.values()) {
        if (pub.source !== Track.Source.ScreenShare) continue;
        const receiver = pub.track?.receiver;
        if (!receiver) continue;

        const report = await receiver.getStats();
        for (const s of report.values()) {
          if (s.type === "inbound-rtp" && s.kind === "video") {
            stats.videoWidth = s.frameWidth ?? 0;
            stats.videoHeight = s.frameHeight ?? 0;
            stats.videoFramerate = Math.round(s.framesPerSecond ?? 0);
          }

          if (s.type === "codec") {
            if (s.mimeType?.startsWith("video/")) {
              stats.videoCodec = s.mimeType.split("/")[1] ?? "";
            }
          }
        }
        break;
      }
      if (stats.videoWidth > 0) break;
    }
  }

  // Connection type from ICE candidate pair
  try {
    const pc = (room as any).engine?.pcManager?.publisher?.getStats
      ? (room as any).engine?.pcManager?.publisher
      : null;
    if (pc) {
      const pcReport = await pc.getStats();
      for (const s of pcReport.values()) {
        if (s.type === "candidate-pair" && s.state === "succeeded") {
          const iceRtt = Math.round((s.currentRoundTripTime ?? 0) * 1000);
          if (iceRtt > 0) {
            stats.rtt = iceRtt;
          }

          // Find the local candidate to get connection type
          for (const c of pcReport.values()) {
            if (c.type === "local-candidate" && c.id === s.localCandidateId) {
              stats.connectionType = c.candidateType ?? "";
              break;
            }
          }
          break;
        }
      }
    }
  } catch {}

  // Fall back to RTCP-based RTT if ICE candidate-pair RTT unavailable
  if (stats.rtt === 0 && rtcpRtt > 0) {
    stats.rtt = rtcpRtt;
  }

  return stats;
}
