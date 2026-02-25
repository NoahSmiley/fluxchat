import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useUIStore } from "@/stores/ui.js";
import { useKeybindsStore, type KeybindAction, type KeybindEntry } from "@/stores/keybinds.js";
import { useSpotifyStore } from "@/stores/spotify/index.js";
import { useUpdater } from "@/hooks/useUpdater.js";
import { getDebugEnabled, setDebugEnabled, dumpLogs } from "@/lib/debug.js";
import { X } from "lucide-react";
import { ProfileTab } from "./settings/ProfileTab.js";
import { AppearanceTab } from "./settings/AppearanceTab.js";
import { NotificationsTab } from "./settings/NotificationsTab.js";
import { useVoiceStore } from "@/stores/voice/index.js";

function VoiceSettingsTab() {
  const { audioSettings, updateAudioSetting } = useVoiceStore(useShallow((s) => ({
    audioSettings: s.audioSettings, updateAudioSetting: s.updateAudioSetting,
  })));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {});
    const onChange = () => navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {});
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, []);

  const inputs = devices.filter((d) => d.kind === "audioinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");

  return (
    <div className="settings-card">
      <h3 className="settings-card-title">Voice & Audio</h3>
      <div className="voice-device-row">
        <label className="voice-device-label">Input Device</label>
        <select
          className="settings-select voice-device-select"
          value={audioSettings.audioInputDeviceId}
          onChange={(e) => updateAudioSetting("audioInputDeviceId", e.target.value)}
        >
          <option value="">System Default</option>
          {inputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </div>
      <div className="voice-device-row">
        <label className="voice-device-label">Output Device</label>
        <select
          className="settings-select voice-device-select"
          value={audioSettings.audioOutputDeviceId}
          onChange={(e) => updateAudioSetting("audioOutputDeviceId", e.target.value)}
        >
          <option value="">System Default</option>
          {outputs.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 8)}`}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ToggleSwitch({ checked, onChange }: {
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
  const { recording, startRecording, stopRecording, clearKeybind } = useKeybindsStore(useShallow((s) => ({
    recording: s.recording, startRecording: s.startRecording, stopRecording: s.stopRecording, clearKeybind: s.clearKeybind,
  })));
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

type SettingsTab = "profile" | "appearance" | "notifications" | "voice" | "keybinds" | "updates" | "spotify" | "cs2" | "debug";

const TAB_LABELS: Record<SettingsTab, string> = {
  profile: "Profile",
  appearance: "Appearance",
  notifications: "Notifications",
  voice: "Voice & Audio",
  keybinds: "Keybinds",
  updates: "Updates",
  spotify: "Spotify",
  cs2: "CS2 / Leetify",
  debug: "Debug",
};

const TABS = Object.keys(TAB_LABELS) as SettingsTab[];

export function SettingsModal() {
  const { settingsOpen, closeSettings } = useUIStore(useShallow((s) => ({
    settingsOpen: s.settingsOpen, closeSettings: s.closeSettings,
  })));
  const { keybinds } = useKeybindsStore(useShallow((s) => ({ keybinds: s.keybinds })));
  const { account, startOAuthFlow, unlinkAccount, polling, oauthError } = useSpotifyStore(useShallow((s) => ({
    account: s.account, startOAuthFlow: s.startOAuthFlow, unlinkAccount: s.unlinkAccount,
    polling: s.polling, oauthError: s.oauthError,
  })));
  const { betaUpdates, setBetaUpdates } = useUIStore(useShallow((s) => ({
    betaUpdates: s.betaUpdates, setBetaUpdates: s.setBetaUpdates,
  })));
  const updater = useUpdater(betaUpdates);

  const [debugMode, setDebugMode] = useState(getDebugEnabled);
  const [logsCopied, setLogsCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // Stop recording keybind when modal closes
  useEffect(() => {
    return () => { useKeybindsStore.getState().stopRecording(); };
  }, []);

  if (!settingsOpen) return null;

  return (
    <div className="settings-page">
      <div className="settings-nav">
        <div className="settings-nav-header">
          <h2>Settings</h2>
        </div>
        {TABS.map((tab) => (
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

        {activeTab === "profile" && <ProfileTab />}

        {activeTab === "appearance" && <AppearanceTab />}

        {activeTab === "notifications" && <NotificationsTab />}

        {activeTab === "voice" && <VoiceSettingsTab />}

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
            <p className="settings-card-desc">v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev"}{betaUpdates ? " (Beta Channel)" : ""}</p>
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Beta Updates</span>
                <span className="settings-row-desc">Receive early access builds (may be less stable)</span>
              </div>
              <ToggleSwitch checked={betaUpdates} onChange={setBetaUpdates} />
            </div>
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
            <p className="settings-card-desc" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Coming Soon</p>
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
