import { useEffect, useRef, useState, useCallback } from "react";
import { useVoiceStore } from "../stores/voice.js";
import { useUIStore } from "../stores/ui.js";
import { useKeybindsStore, type KeybindAction, type KeybindEntry } from "../stores/keybinds.js";
import { X } from "lucide-react";

function useMicLevel(enabled: boolean): { level: number; status: string } {
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState("idle");
  const rafRef = useRef<number>(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Float32Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    analyserRef.current = null;
    dataRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setLevel(0);
  }, []);

  useEffect(() => {
    if (!enabled) { cleanup(); setStatus("idle"); return; }

    let cancelled = false;
    setStatus("requesting mic...");

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        setStatus("got stream, creating analyser...");

        const ctx = new AudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        ctxRef.current = ctx;

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyserRef.current = analyser;
        dataRef.current = new Float32Array(analyser.fftSize);

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        setStatus("running");

        const tick = () => {
          if (cancelled) return;
          if (analyserRef.current && dataRef.current) {
            analyserRef.current.getFloatTimeDomainData(dataRef.current);
            let sum = 0;
            for (let i = 0; i < dataRef.current.length; i++) {
              sum += dataRef.current[i] * dataRef.current[i];
            }
            setLevel(Math.sqrt(sum / dataRef.current.length));
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e: any) {
        setStatus(`error: ${e?.message || e}`);
        console.error("Mic level error:", e);
      }
    })();

    return () => { cancelled = true; cleanup(); };
  }, [enabled, cleanup]);

  return { level, status };
}

function ToggleSwitch({ checked, onChange }: {
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <button
      className={`toggle-switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="toggle-switch-thumb" />
    </button>
  );
}

function KrispBadge() {
  return (
    <span className="krisp-badge">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-5-5 1.41-1.41L11 14.17l7.59-7.59L20 8l-9 9z"
          fill="currentColor"
        />
      </svg>
      Krisp
    </span>
  );
}

const ACTION_LABELS: Record<KeybindAction, string> = {
  "push-to-talk": "Push to Talk",
  "push-to-mute": "Push to Mute",
  "toggle-mute": "Toggle Mute",
  "toggle-deafen": "Toggle Deafen",
};

const ACTION_DESCRIPTIONS: Record<KeybindAction, string> = {
  "push-to-talk": "Hold key to unmute, release to mute",
  "push-to-mute": "Hold key to mute, release to unmute",
  "toggle-mute": "Press to toggle microphone mute",
  "toggle-deafen": "Press to toggle deafen (mutes all audio)",
};

function KeybindButton({ entry }: { entry: KeybindEntry }) {
  const { recording, startRecording, stopRecording, clearKeybind } = useKeybindsStore();
  const isRecording = recording === entry.action;

  return (
    <div className="keybind-button-group">
      <button
        className={`keybind-button ${isRecording ? "recording" : ""}`}
        onClick={() => isRecording ? stopRecording() : startRecording(entry.action)}
      >
        {isRecording ? "Press a key..." : (entry.label ?? "Not set")}
      </button>
      {entry.key && (
        <button
          className="keybind-clear"
          onClick={() => clearKeybind(entry.action)}
          title="Clear keybind"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function SettingsModal() {
  const { settingsOpen, closeSettings } = useUIStore();
  const { audioSettings, updateAudioSetting } = useVoiceStore();
  const { keybinds } = useKeybindsStore();
  const { level: micLevel } = useMicLevel(settingsOpen && audioSettings.inputSensitivityEnabled);

  // Stop recording keybind when modal closes
  useEffect(() => {
    return () => { useKeybindsStore.getState().stopRecording(); };
  }, []);

  if (!settingsOpen) return null;

  return (
    <div className="modal-overlay" onClick={closeSettings}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Settings</h2>
          <button className="settings-modal-close" onClick={closeSettings}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-modal-body">
          {/* Voice Processing */}
          <div className="settings-section">
            <h3 className="settings-section-title">Voice Processing</h3>
            <p className="settings-section-desc">
              Configure noise reduction and audio processing for your microphone.
            </p>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">
                  AI Noise Suppression <KrispBadge />
                </span>
                <span className="settings-row-desc">
                  Uses machine learning to remove background noise
                </span>
              </div>
              <ToggleSwitch
                checked={audioSettings.krispEnabled}
                onChange={(v) => updateAudioSetting("krispEnabled", v)}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Noise Suppression</span>
                <span className="settings-row-desc">Browser-native noise reduction</span>
              </div>
              <ToggleSwitch
                checked={audioSettings.noiseSuppression}
                onChange={(v) => updateAudioSetting("noiseSuppression", v)}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Echo Cancellation</span>
                <span className="settings-row-desc">Reduces echo from speakers</span>
              </div>
              <ToggleSwitch
                checked={audioSettings.echoCancellation}
                onChange={(v) => updateAudioSetting("echoCancellation", v)}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Auto Gain Control</span>
                <span className="settings-row-desc">Automatically adjusts microphone volume</span>
              </div>
              <ToggleSwitch
                checked={audioSettings.autoGainControl}
                onChange={(v) => updateAudioSetting("autoGainControl", v)}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Silence Detection</span>
                <span className="settings-row-desc">Reduces bandwidth when not speaking (DTX)</span>
              </div>
              <ToggleSwitch
                checked={audioSettings.dtx}
                onChange={(v) => updateAudioSetting("dtx", v)}
              />
            </div>
          </div>

          {/* Input Sensitivity */}
          <div className="settings-section">
            <h3 className="settings-section-title">Input Sensitivity</h3>
            <p className="settings-section-desc">
              Set a volume threshold — your mic won't transmit below it.
            </p>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Manual Threshold</span>
                <span className="settings-row-desc">Gate your mic based on input volume</span>
              </div>
              <ToggleSwitch
                checked={audioSettings.inputSensitivityEnabled}
                onChange={(v) => updateAudioSetting("inputSensitivityEnabled", v)}
              />
            </div>

            {audioSettings.inputSensitivityEnabled && (
              <div className="settings-slider-row">
                <div className="settings-slider-header">
                  <span>Threshold</span>
                  <span className="settings-slider-value">{audioSettings.inputSensitivity}%</span>
                </div>
                <div className="sensitivity-meter-bar">
                  <div
                    className="sensitivity-meter-fill"
                    style={{ width: `${Math.min(micLevel * 700, 100)}%` }}
                  />
                  <div
                    className="sensitivity-meter-threshold"
                    style={{ left: `${audioSettings.inputSensitivity}%` }}
                  />
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={audioSettings.inputSensitivity}
                  onChange={(e) => updateAudioSetting("inputSensitivity", parseInt(e.target.value))}
                  className="settings-slider"
                />
              </div>
            )}
          </div>

          {/* Audio Filters */}
          <div className="settings-section">
            <h3 className="settings-section-title">Audio Filters</h3>
            <p className="settings-section-desc">
              Apply frequency filters to incoming audio from other users.
            </p>

            <div className="settings-slider-row">
              <div className="settings-slider-header">
                <span>High-Pass Filter</span>
                <span className="settings-slider-value">
                  {audioSettings.highPassFrequency === 0 ? "Off" : `${audioSettings.highPassFrequency} Hz`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2000"
                step="10"
                value={audioSettings.highPassFrequency}
                onChange={(e) => updateAudioSetting("highPassFrequency", parseInt(e.target.value))}
                className="settings-slider"
              />
            </div>

            <div className="settings-slider-row">
              <div className="settings-slider-header">
                <span>Low-Pass Filter</span>
                <span className="settings-slider-value">
                  {audioSettings.lowPassFrequency === 0 ? "Off" : `${audioSettings.lowPassFrequency} Hz`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="20000"
                step="100"
                value={audioSettings.lowPassFrequency}
                onChange={(e) => updateAudioSetting("lowPassFrequency", parseInt(e.target.value))}
                className="settings-slider"
              />
            </div>
          </div>

          {/* Keybinds */}
          <div className="settings-section">
            <h3 className="settings-section-title">Keybinds</h3>
            <p className="settings-section-desc">
              Set keyboard shortcuts for voice controls. Active only when connected to voice.
            </p>

            {keybinds.map((entry) => (
              <div className="settings-row" key={entry.action}>
                <div className="settings-row-info">
                  <span className="settings-row-label">{ACTION_LABELS[entry.action]}</span>
                  <span className="settings-row-desc">{ACTION_DESCRIPTIONS[entry.action]}</span>
                </div>
                <KeybindButton entry={entry} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
