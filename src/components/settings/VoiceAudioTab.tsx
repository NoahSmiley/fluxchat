import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useVoiceStore } from "@/stores/voice/index.js";
import { ToggleSwitch } from "@/components/SettingsModal.js";

export function VoiceAudioTab() {
  const { audioSettings, updateAudioSetting, lobbyMusicVolume, setLobbyMusicVolume } = useVoiceStore(useShallow((s) => ({
    audioSettings: s.audioSettings, updateAudioSetting: s.updateAudioSetting,
    lobbyMusicVolume: s.lobbyMusicVolume, setLobbyMusicVolume: s.setLobbyMusicVolume,
  })));

  const [lobbyMusicEnabled, setLobbyMusicEnabled] = useState(
    () => localStorage.getItem("flux-lobby-music-enabled") !== "false"
  );

  return (
    <>
      <div className="settings-card">
        <h3 className="settings-card-title">AI Noise Suppression</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Model</span>
            <span className="settings-row-desc">Select an AI model for noise cancellation</span>
          </div>
          <select
            className="settings-select"
            value={audioSettings.noiseSuppressionModel}
            onChange={(e) => updateAudioSetting("noiseSuppressionModel", e.target.value)}
          >
            <option value="off">Off</option>
            <option value="speex">Speex (DSP)</option>
            <option value="rnnoise">RNNoise (lightweight)</option>
            <option value="dtln">DTLN (balanced)</option>
            <option value="deepfilter">DeepFilterNet3 (high quality)</option>
            <option value="nsnet2">FluxAI (advanced)</option>
          </select>
        </div>
        {audioSettings.noiseSuppressionModel !== "off" && (
          <div className="settings-model-info">
            {audioSettings.noiseSuppressionModel === "speex" && "DSP-based, ultra-lightweight (~50KB). Minimal CPU usage and near-zero latency. Basic noise reduction."}
            {audioSettings.noiseSuppressionModel === "rnnoise" && "Recurrent neural network. Low CPU, <10ms latency. Good general-purpose suppression at 48kHz."}
            {audioSettings.noiseSuppressionModel === "dtln" && "Dual-signal transformer. Moderate CPU, balanced quality. Processes at 16kHz with auto-resampling."}
            {audioSettings.noiseSuppressionModel === "deepfilter" && "DeepFilterNet3 — deep neural network. Higher CPU, best quality. Full-band 48kHz processing. WASM+model fetched on first use (~1MB)."}
            {audioSettings.noiseSuppressionModel === "nsnet2" && "FluxAI — custom GRU neural network with ONNX Runtime. 16kHz processing, ~20ms latency. Advanced noise suppression."}
          </div>
        )}
        {audioSettings.noiseSuppressionModel !== "off" && (
          <div className="settings-slider-row">
            <div className="settings-slider-header">
              <span>Suppression Strength</span>
              <span className="settings-slider-value">{audioSettings.suppressionStrength}%</span>
            </div>
            <input type="range" min="0" max="100" step="1" value={audioSettings.suppressionStrength} onChange={(e) => updateAudioSetting("suppressionStrength", parseInt(e.target.value))} className="settings-slider" />
          </div>
        )}
        {audioSettings.noiseSuppressionModel === "rnnoise" && (
          <div className="settings-slider-row">
            <div className="settings-slider-header">
              <span>VAD Threshold</span>
              <span className="settings-slider-value">{audioSettings.vadThreshold}%</span>
            </div>
            <input type="range" min="0" max="100" step="1" value={audioSettings.vadThreshold} onChange={(e) => updateAudioSetting("vadThreshold", parseInt(e.target.value))} className="settings-slider" />
          </div>
        )}
      </div>

      {/* Lobby Music */}
      <div className="settings-card">
        <h3 className="settings-card-title">Lobby Music</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Play ambient music when alone</span>
            <span className="settings-row-desc">Lofi tunes fade in after 30s alone in a voice channel</span>
          </div>
          <ToggleSwitch
            checked={lobbyMusicEnabled}
            onChange={(v) => {
              localStorage.setItem("flux-lobby-music-enabled", v ? "true" : "false");
              setLobbyMusicEnabled(v);
            }}
          />
        </div>
        <div className="settings-slider-row">
          <div className="settings-slider-header">
            <span>Volume</span>
            <span className="settings-slider-value">{Math.round(lobbyMusicVolume * 100)}%</span>
          </div>
          <input type="range" min="0" max="100" step="1" value={Math.round(lobbyMusicVolume * 100)} onChange={(e) => setLobbyMusicVolume(parseInt(e.target.value) / 100)} className="settings-slider" />
        </div>
      </div>
    </>
  );
}
