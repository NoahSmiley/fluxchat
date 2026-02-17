import { useEffect, useRef, useState, useCallback } from "react";
import { useVoiceStore } from "../stores/voice.js";
import { useUIStore } from "../stores/ui.js";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { useKeybindsStore, type KeybindAction, type KeybindEntry } from "../stores/keybinds.js";
import { useSpotifyStore } from "../stores/spotify.js";
import { useUpdater } from "../hooks/useUpdater.js";
import { getDebugEnabled, setDebugEnabled, dumpLogs } from "../lib/debug.js";
import { avatarColor } from "../lib/avatarColor.js";
import { X, Copy, Check } from "lucide-react";
import type { RingStyle } from "../types/shared.js";

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

type SettingsTab = "appearance" | "voice" | "keybinds" | "updates" | "spotify" | "cs2" | "server" | "debug";

const TAB_LABELS: Record<SettingsTab, string> = {
  appearance: "Appearance",
  voice: "Voice & Audio",
  keybinds: "Keybinds",
  updates: "Updates",
  spotify: "Spotify",
  cs2: "CS2 / Leetify",
  server: "Server",
  debug: "Debug",
};

const RING_STYLES: { value: RingStyle; label: string; desc: string }[] = [
  { value: "default", label: "Default", desc: "Standard ring based on role" },
  { value: "chroma", label: "Chroma", desc: "Animated rainbow gradient" },
  { value: "pulse", label: "Pulse", desc: "Breathing glow effect" },
  { value: "wave", label: "Wave", desc: "Flowing gradient animation" },
  { value: "none", label: "None", desc: "No ring border" },
];

export function SettingsModal() {
  const { settingsOpen, closeSettings } = useUIStore();
  const { audioSettings, updateAudioSetting } = useVoiceStore();
  const { servers, activeServerId, updateServer } = useChatStore();
  const { user, updateProfile } = useAuthStore();
  const { keybinds } = useKeybindsStore();
  const { account, startOAuthFlow, unlinkAccount, polling, oauthError } = useSpotifyStore();
  const updater = useUpdater();
  const { level: micLevel } = useMicLevel(settingsOpen && audioSettings.inputSensitivityEnabled);
  const [debugMode, setDebugMode] = useState(getDebugEnabled);
  const [logsCopied, setLogsCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [serverNameInput, setServerNameInput] = useState("");
  const [serverNameSaving, setServerNameSaving] = useState(false);
  const [editingServerName, setEditingServerName] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const [ringSaving, setRingSaving] = useState(false);
  const [steamIdInput, setSteamIdInput] = useState(user?.steamId ?? "");
  const [steamIdSaving, setSteamIdSaving] = useState(false);
  const [steamIdSaved, setSteamIdSaved] = useState(false);

  const server = servers.find((s) => s.id === activeServerId) ?? servers[0];
  const isOwnerOrAdmin = server && (server.role === "owner" || server.role === "admin");

  // Stop recording keybind when modal closes
  useEffect(() => {
    return () => { useKeybindsStore.getState().stopRecording(); };
  }, []);

  if (!settingsOpen) return null;

  const tabs: SettingsTab[] = ["appearance", "voice", "keybinds", "updates", "spotify", "cs2", ...(isOwnerOrAdmin ? ["server" as SettingsTab] : []), "debug"];

  return (
    <div className="settings-page">
      <div className="settings-nav">
        <div className="settings-nav-header">
          <h2>Settings</h2>
        </div>
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`settings-nav-item ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <div className="settings-nav-spacer" />
        <button className="settings-nav-close" onClick={closeSettings}>
          <X size={16} />
          <span>Close</span>
        </button>
      </div>

      <div className="settings-content">
        <h1 className="settings-content-title">{TAB_LABELS[activeTab]}</h1>

        {activeTab === "appearance" && (
          <>
            <div className="settings-card">
              <h3 className="settings-card-title">Avatar Ring</h3>
              <p className="settings-card-desc">Choose how your avatar ring appears to everyone.</p>

              {/* Ring style preview */}
              <div className="ring-preview-container">
                <div className={`ring-preview-avatar-ring ring-style-${user?.ringStyle ?? "default"} ${(user?.ringSpin) ? "ring-spin-active" : ""}`} style={{ "--ring-color": avatarColor(user?.username ?? "") } as React.CSSProperties}>
                  <div className="ring-preview-avatar" style={{ background: avatarColor(user?.username ?? "") }}>
                    {user?.image ? (
                      <img src={user.image} alt={user.username} className="ring-preview-img" />
                    ) : (
                      user?.username?.charAt(0).toUpperCase()
                    )}
                  </div>
                </div>
              </div>

              {/* Ring style picker */}
              <div className="ring-style-picker">
                {RING_STYLES.map((rs) => (
                  <button
                    key={rs.value}
                    className={`ring-style-option ${(user?.ringStyle ?? "default") === rs.value ? "active" : ""}`}
                    disabled={ringSaving}
                    onClick={async () => {
                      setRingSaving(true);
                      try { await updateProfile({ ringStyle: rs.value }); } catch {}
                      setRingSaving(false);
                    }}
                  >
                    <div className={`ring-style-swatch ring-style-${rs.value}`} style={{ "--ring-color": avatarColor(user?.username ?? "") } as React.CSSProperties} />
                    <span className="ring-style-label">{rs.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="settings-card">
              <h3 className="settings-card-title">Animation</h3>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Spin</span>
                  <span className="settings-row-desc">Continuously rotate your avatar ring</span>
                </div>
                <ToggleSwitch
                  checked={user?.ringSpin ?? false}
                  onChange={async (v) => {
                    setRingSaving(true);
                    try { await updateProfile({ ringSpin: v }); } catch {}
                    setRingSaving(false);
                  }}
                />
              </div>
            </div>
          </>
        )}

        {activeTab === "voice" && (
          <>
            <div className="settings-card">
              <h3 className="settings-card-title">Processing</h3>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Noise Cancellation</span>
                  <span className="settings-row-desc">AI-powered noise cancellation</span>
                </div>
                <ToggleSwitch checked={audioSettings.krispEnabled} onChange={(v) => updateAudioSetting("krispEnabled", v)} />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Noise Suppression</span>
                  <span className="settings-row-desc">Browser-native noise reduction</span>
                </div>
                <ToggleSwitch checked={audioSettings.noiseSuppression} onChange={(v) => updateAudioSetting("noiseSuppression", v)} />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Echo Cancellation</span>
                  <span className="settings-row-desc">Reduces echo from speakers</span>
                </div>
                <ToggleSwitch checked={audioSettings.echoCancellation} onChange={(v) => updateAudioSetting("echoCancellation", v)} />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Auto Gain Control</span>
                  <span className="settings-row-desc">Automatically adjusts microphone volume</span>
                </div>
                <ToggleSwitch checked={audioSettings.autoGainControl} onChange={(v) => updateAudioSetting("autoGainControl", v)} />
              </div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Silence Detection</span>
                  <span className="settings-row-desc">Reduces bandwidth when not speaking (DTX)</span>
                </div>
                <ToggleSwitch checked={audioSettings.dtx} onChange={(v) => updateAudioSetting("dtx", v)} />
              </div>
            </div>

            <div className="settings-card">
              <h3 className="settings-card-title">Input Sensitivity</h3>
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Manual Threshold</span>
                  <span className="settings-row-desc">Gate your mic based on input volume</span>
                </div>
                <ToggleSwitch checked={audioSettings.inputSensitivityEnabled} onChange={(v) => updateAudioSetting("inputSensitivityEnabled", v)} />
              </div>
              {audioSettings.inputSensitivityEnabled && (
                <div className="settings-slider-row">
                  <div className="settings-slider-header">
                    <span>Threshold</span>
                    <span className="settings-slider-value">{audioSettings.inputSensitivity}%</span>
                  </div>
                  <div className="sensitivity-meter-bar">
                    <div className="sensitivity-meter-fill" style={{ width: `${Math.min(micLevel * 700, 100)}%` }} />
                    <div className="sensitivity-meter-threshold" style={{ left: `${audioSettings.inputSensitivity}%` }} />
                  </div>
                  <input type="range" min="0" max="100" step="1" value={audioSettings.inputSensitivity} onChange={(e) => updateAudioSetting("inputSensitivity", parseInt(e.target.value))} className="settings-slider" />
                </div>
              )}
            </div>

            <div className="settings-card">
              <h3 className="settings-card-title">Audio Filters</h3>
              <div className="settings-slider-row">
                <div className="settings-slider-header">
                  <span>High-Pass Filter</span>
                  <span className="settings-slider-value">{audioSettings.highPassFrequency === 0 ? "Off" : `${audioSettings.highPassFrequency} Hz`}</span>
                </div>
                <input type="range" min="0" max="2000" step="10" value={audioSettings.highPassFrequency} onChange={(e) => updateAudioSetting("highPassFrequency", parseInt(e.target.value))} className="settings-slider" />
              </div>
              <div className="settings-slider-row">
                <div className="settings-slider-header">
                  <span>Low-Pass Filter</span>
                  <span className="settings-slider-value">{audioSettings.lowPassFrequency === 0 ? "Off" : `${audioSettings.lowPassFrequency} Hz`}</span>
                </div>
                <input type="range" min="0" max="20000" step="100" value={audioSettings.lowPassFrequency} onChange={(e) => updateAudioSetting("lowPassFrequency", parseInt(e.target.value))} className="settings-slider" />
              </div>
            </div>
          </>
        )}

        {activeTab === "keybinds" && (
          <div className="settings-card">
            <h3 className="settings-card-title">Voice Controls</h3>
            <p className="settings-card-desc">Active only when connected to a voice channel.</p>
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
        )}

        {activeTab === "updates" && (
          <div className="settings-card">
            <h3 className="settings-card-title">App Version</h3>
            <p className="settings-card-desc">v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}</p>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">
                  {updater.status === "checking" && "Checking for updates..."}
                  {updater.status === "available" && `Update available: v${updater.version}`}
                  {updater.status === "downloading" && `Downloading... ${updater.progress}%`}
                  {updater.status === "ready" && "Update ready — restart to apply"}
                  {updater.status === "up-to-date" && "You're up to date"}
                  {updater.status === "error" && "Update check failed"}
                  {updater.status === "idle" && "Check for updates"}
                </span>
                {updater.error && <span className="settings-row-desc" style={{ color: "var(--danger)" }}>{updater.error}</span>}
              </div>
              {updater.status === "idle" && <button className="btn-small" onClick={updater.checkForUpdate}>Check</button>}
              {updater.status === "up-to-date" && <button className="btn-small" onClick={updater.checkForUpdate}>Check Again</button>}
              {updater.status === "available" && <button className="btn-small" onClick={updater.downloadAndInstall}>Update</button>}
              {updater.status === "ready" && <button className="btn-small" onClick={updater.relaunch}>Restart</button>}
            </div>
            {updater.status === "downloading" && (
              <div className="update-progress-bar">
                <div className="update-progress-fill" style={{ width: `${updater.progress}%` }} />
              </div>
            )}
          </div>
        )}

        {activeTab === "spotify" && (
          <div className="settings-card">
            <h3 className="settings-card-title">Spotify Integration</h3>
            <p className="settings-card-desc">Link your account for group listening sessions in voice channels.</p>
            {account?.linked ? (
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">{account.displayName || "Spotify Account"}</span>
                  <span className="settings-row-desc">Your Spotify account is linked</span>
                </div>
                <button className="btn-small btn-danger" onClick={unlinkAccount}>Unlink</button>
              </div>
            ) : (
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Connect Spotify</span>
                  <span className="settings-row-desc">Required for music playback (Premium needed)</span>
                </div>
                <button className="btn-spotify" onClick={startOAuthFlow} disabled={polling}>
                  {polling ? "Waiting..." : "Link Spotify"}
                </button>
                {oauthError && <span className="settings-row-error">{oauthError}</span>}
              </div>
            )}
          </div>
        )}

        {activeTab === "cs2" && (
          <div className="settings-card">
            <h3 className="settings-card-title">CS2 / Leetify Integration</h3>
            <p className="settings-card-desc">Link your Steam ID to see your Leetify stats and team performance in the CS2 hub.</p>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Steam ID</span>
                <span className="settings-row-desc">Your Steam64 ID (e.g. 76561198...)</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  className="settings-input"
                  value={steamIdInput}
                  onChange={(e) => { setSteamIdInput(e.target.value); setSteamIdSaved(false); }}
                  placeholder="76561198..."
                  style={{ width: 200 }}
                />
                <button
                  className="btn-small"
                  disabled={steamIdSaving || steamIdInput.trim() === (user?.steamId ?? "")}
                  onClick={async () => {
                    setSteamIdSaving(true);
                    try {
                      await updateProfile({ steamId: steamIdInput.trim() || null });
                      setSteamIdSaved(true);
                      setTimeout(() => setSteamIdSaved(false), 2000);
                    } catch { /* ignore */ }
                    setSteamIdSaving(false);
                  }}
                >
                  {steamIdSaving ? "Saving..." : steamIdSaved ? "Saved!" : "Save"}
                </button>
                {user?.steamId && (
                  <button
                    className="btn-small btn-danger"
                    onClick={async () => {
                      setSteamIdSaving(true);
                      try {
                        await updateProfile({ steamId: null });
                        setSteamIdInput("");
                      } catch { /* ignore */ }
                      setSteamIdSaving(false);
                    }}
                  >
                    Unlink
                  </button>
                )}
              </div>
            </div>
            {user?.steamId && (
              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-label">Status</span>
                  <span className="settings-row-desc" style={{ color: "#4caf50" }}>Linked — Your stats will appear in the CS2 hub</span>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "server" && isOwnerOrAdmin && server && (
          <div className="settings-card">
            <h3 className="settings-card-title">Server Management</h3>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Server Name</span>
                <span className="settings-row-desc">{server.name}</span>
              </div>
              {server.role === "owner" && !editingServerName && (
                <button className="btn-small" onClick={() => { setServerNameInput(server.name); setEditingServerName(true); }}>Rename</button>
              )}
            </div>
            {editingServerName && (
              <div className="settings-row" style={{ gap: 8 }}>
                <input type="text" value={serverNameInput} onChange={(e) => setServerNameInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && serverNameInput.trim()) { setServerNameSaving(true); updateServer(server.id, serverNameInput.trim()).then(() => { setEditingServerName(false); setServerNameSaving(false); }).catch(() => setServerNameSaving(false)); } if (e.key === "Escape") setEditingServerName(false); }} autoFocus style={{ flex: 1 }} />
                <button className="btn-small btn-primary" disabled={serverNameSaving} onClick={() => { if (!serverNameInput.trim()) return; setServerNameSaving(true); updateServer(server.id, serverNameInput.trim()).then(() => { setEditingServerName(false); setServerNameSaving(false); }).catch(() => setServerNameSaving(false)); }}>Save</button>
                <button className="btn-small" onClick={() => setEditingServerName(false)}>Cancel</button>
              </div>
            )}
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Invite Code</span>
                <span className="settings-row-desc"><code>{server.inviteCode}</code></span>
              </div>
              <button className="btn-small" onClick={() => { if (server.inviteCode) { navigator.clipboard.writeText(server.inviteCode); setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000); } }}>
                {inviteCopied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>
          </div>
        )}

        {activeTab === "debug" && (
          <div className="settings-card">
            <h3 className="settings-card-title">Diagnostics</h3>
            <p className="settings-card-desc">Logs are buffered in memory even when debug mode is off.</p>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Debug Mode</span>
                <span className="settings-row-desc">Show detailed logs in browser console</span>
              </div>
              <ToggleSwitch checked={debugMode} onChange={(v) => { setDebugEnabled(v); setDebugMode(v); }} />
            </div>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Export Logs</span>
                <span className="settings-row-desc">Copy all buffered logs to clipboard for bug reports</span>
              </div>
              <button className="btn-small" onClick={() => { navigator.clipboard.writeText(dumpLogs()).then(() => { setLogsCopied(true); setTimeout(() => setLogsCopied(false), 2000); }); }}>
                {logsCopied ? "Copied!" : "Copy Logs"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
