import { useVoiceStore } from "../../stores/voice.js";

function qualityColor(value: number, goodBelow: number, warnBelow: number): string {
  if (value <= goodBelow) return "var(--stats-good)";
  if (value <= warnBelow) return "var(--stats-warn)";
  return "var(--stats-bad)";
}

function rttColor(rtt: number): string {
  if (rtt < 80) return "var(--stats-good)";
  if (rtt < 200) return "var(--stats-warn)";
  return "var(--stats-bad)";
}

function lossColor(loss: number): string {
  if (loss < 1) return "var(--stats-good)";
  if (loss < 5) return "var(--stats-warn)";
  return "var(--stats-bad)";
}

export function StatsOverlay() {
  const stats = useVoiceStore((s) => s.webrtcStats);
  const showStatsOverlay = useVoiceStore((s) => s.showStatsOverlay);

  if (!showStatsOverlay || !stats) return null;

  const hasVideo = stats.videoWidth > 0 || stats.videoBitrate > 0;

  return (
    <div className="stats-overlay">
      <div className="stats-overlay-title">Connection Stats</div>

      <div className="stats-overlay-section">
        <div className="stats-overlay-label">Audio</div>
        <div className="stats-overlay-row">
          <span>Bitrate</span>
          <span>{stats.audioBitrate} kbps</span>
        </div>
        {stats.audioCodec && (
          <div className="stats-overlay-row">
            <span>Codec</span>
            <span>{stats.audioCodec.toUpperCase()}</span>
          </div>
        )}
        {stats.audioSampleRate > 0 && (
          <div className="stats-overlay-row">
            <span>Sample Rate</span>
            <span>{stats.audioSampleRate / 1000} kHz</span>
          </div>
        )}
        {stats.audioChannels > 0 && (
          <div className="stats-overlay-row">
            <span>Channels</span>
            <span>{stats.audioChannels >= 2 ? "Stereo" : "Mono"}</span>
          </div>
        )}
        <div className="stats-overlay-row">
          <span>FEC</span>
          <span>{stats.opusFec ? "Yes" : "No"}</span>
        </div>
        <div className="stats-overlay-row">
          <span>Packet Loss</span>
          <span style={{ color: lossColor(stats.audioPacketLoss) }}>
            {stats.audioPacketLoss}%
          </span>
        </div>
        <div className="stats-overlay-row">
          <span>Jitter</span>
          <span style={{ color: qualityColor(stats.audioJitter * 1000, 20, 50) }}>
            {(stats.audioJitter * 1000).toFixed(1)} ms
          </span>
        </div>
        <div className="stats-overlay-row">
          <span>RTT</span>
          <span style={{ color: rttColor(stats.rtt) }}>
            {stats.rtt} ms
          </span>
        </div>
      </div>

      {hasVideo && (
        <div className="stats-overlay-section">
          <div className="stats-overlay-label">Video</div>
          {stats.videoBitrate > 0 && (
            <div className="stats-overlay-row">
              <span>Bitrate</span>
              <span>{stats.videoBitrate} kbps</span>
            </div>
          )}
          {stats.videoCodec && (
            <div className="stats-overlay-row">
              <span>Codec</span>
              <span>{stats.videoCodec.toUpperCase()}</span>
            </div>
          )}
          {stats.videoWidth > 0 && (
            <div className="stats-overlay-row">
              <span>Resolution</span>
              <span>{stats.videoWidth}x{stats.videoHeight}</span>
            </div>
          )}
          {stats.videoFramerate > 0 && (
            <div className="stats-overlay-row">
              <span>FPS</span>
              <span>{stats.videoFramerate}</span>
            </div>
          )}
        </div>
      )}

      {stats.connectionType && (
        <div className="stats-overlay-row">
          <span>Type</span>
          <span>{stats.connectionType}</span>
        </div>
      )}
    </div>
  );
}
