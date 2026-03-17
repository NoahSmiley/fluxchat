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
import { IntroExitSoundsCard } from "./settings/IntroExitSoundsCard.js";
import { SoundboardTab } from "./music/SoundboardTab.js";
import { EmojiTab } from "./EmojiTab.js";
import { useChatStore } from "@/stores/chat/index.js";
import { useAuthStore } from "@/stores/auth.js";
import * as api from "@/lib/api/index.js";
import type { MemberWithUser } from "@/types/shared.js";

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
    <>
      <div className="settings-card">
        <h3 className="settings-card-title">Volume</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Microphone Volume</span>
            <span className="settings-row-desc">{Math.round((audioSettings.micVolume ?? 1) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={Math.round((audioSettings.micVolume ?? 1) * 100)}
            onChange={(e) => updateAudioSetting("micVolume", parseInt(e.target.value) / 100)}
            className="settings-range"
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Speaker Volume</span>
            <span className="settings-row-desc">{Math.round((audioSettings.speakerVolume ?? 1) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={Math.round((audioSettings.speakerVolume ?? 1) * 100)}
            onChange={(e) => updateAudioSetting("speakerVolume", parseInt(e.target.value) / 100)}
            className="settings-range"
          />
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Devices</h3>
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

      <div className="settings-card">
        <h3 className="settings-card-title">Audio Processing</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Noise Suppression</span>
            <span className="settings-row-desc">AI-based noise cancellation removes background noise in real time</span>
            <img src="/krisp-logo.png" alt="Powered by Krisp" style={{ height: 12, width: "auto", alignSelf: "flex-start", opacity: 0.5, marginTop: 4 }} />
          </div>
          <ToggleSwitch checked={!!audioSettings.noiseSuppression} onChange={(v) => updateAudioSetting("noiseSuppression", v)} />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Echo Cancellation</span>
            <span className="settings-row-desc">Prevents echo when using speakers</span>
          </div>
          <ToggleSwitch checked={audioSettings.echoCancellation} onChange={(v) => updateAudioSetting("echoCancellation", v)} />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Automatic Gain Control</span>
            <span className="settings-row-desc">Normalizes volume levels automatically</span>
          </div>
          <ToggleSwitch checked={audioSettings.autoGainControl} onChange={(v) => updateAudioSetting("autoGainControl", v)} />
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Adaptive Bitrate</span>
            <span className="settings-row-desc">Adjusts quality based on network conditions</span>
          </div>
          <ToggleSwitch checked={audioSettings.adaptiveBitrate} onChange={(v) => updateAudioSetting("adaptiveBitrate", v)} />
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-card-title">Voice Activity</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Voice Gating</span>
            <span className="settings-row-desc">Only transmit when speaking</span>
          </div>
          <ToggleSwitch checked={audioSettings.voiceGating} onChange={(v) => updateAudioSetting("voiceGating", v)} />
        </div>
        {audioSettings.voiceGating && (
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Sensitivity</span>
              <span className="settings-row-desc">Left = most sensitive (picks up whispers), Right = least sensitive (need to be loud)</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={audioSettings.sensitivity}
              onChange={(e) => updateAudioSetting("sensitivity", parseFloat(e.target.value))}
              className="settings-range"
            />
          </div>
        )}
      </div>

      <IntroExitSoundsCard />

    </>
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

function ServerOverviewTab({
  server,
  isOwner,
  user,
  updateServer,
  leaveServer,
  close,
}: {
  server: ReturnType<typeof useChatStore.getState>["servers"][0];
  isOwner: boolean;
  user: ReturnType<typeof useAuthStore.getState>["user"];
  updateServer: (id: string, name: string) => Promise<void>;
  leaveServer: (id: string) => Promise<void>;
  close: () => void;
}) {
  const [editingServerName, setEditingServerName] = useState(false);
  const [serverNameInput, setServerNameInput] = useState("");
  const [serverNameSaving, setServerNameSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  function handleServerNameSave() {
    if (!serverNameInput.trim()) return;
    setServerNameSaving(true);
    updateServer(server.id, serverNameInput.trim())
      .then(() => { setEditingServerName(false); setServerNameSaving(false); })
      .catch(() => setServerNameSaving(false));
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      await leaveServer(server.id);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave server");
      setLeaving(false);
    }
  }

  return (
    <>
      {error && <div className="auth-error">{error}</div>}

      <div className="settings-card">
        <h3 className="settings-card-title">Server Management</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Server Name</span>
            <span className="settings-row-desc">{server.name}</span>
          </div>
          {isOwner && !editingServerName && (
            <button className="btn-small" onClick={() => { setServerNameInput(server.name); setEditingServerName(true); }}>Rename</button>
          )}
        </div>
        {editingServerName && (
          <div className="settings-row" style={{ gap: 8 }}>
            <input
              type="text"
              value={serverNameInput}
              onChange={(e) => setServerNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleServerNameSave();
                if (e.key === "Escape") setEditingServerName(false);
              }}
              autoFocus
              style={{ flex: 1 }}
            />
            <button
              className="btn-small btn-primary"
              disabled={serverNameSaving}
              onClick={handleServerNameSave}
            >Save</button>
            <button className="btn-small" onClick={() => setEditingServerName(false)}>Cancel</button>
          </div>
        )}
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Owner</span>
            <span className="settings-row-desc">{isOwner ? `${user?.username} (you)` : server.ownerId.slice(0, 8)}</span>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Created</span>
            <span className="settings-row-desc">{new Date(server.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {!isOwner && (
        <div className="settings-card">
          <h3 className="settings-card-title">Danger Zone</h3>
          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Leave Server</span>
              <span className="settings-row-desc">You can rejoin with an invite code.</span>
            </div>
            <button className="btn-small btn-danger" onClick={handleLeave} disabled={leaving}>
              {leaving ? "Leaving..." : "Leave"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ServerMembersTab({
  server,
  user,
  members,
}: {
  server: ReturnType<typeof useChatStore.getState>["servers"][0];
  user: ReturnType<typeof useAuthStore.getState>["user"];
  members: MemberWithUser[];
}) {
  async function handleToggleRole(member: { userId: string; role: string }) {
    const newRole = member.role === "admin" ? "member" : "admin";
    try {
      await api.updateMemberRole(member.userId, newRole);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  const serverMembers = members.filter((m) => m.serverId === server.id).sort((a, b) => {
    const order: Record<string, number> = { owner: 0, admin: 1, member: 2 };
    return (order[a.role] ?? 3) - (order[b.role] ?? 3);
  });

  return (
    <>
      <div className="settings-card">
        <h3 className="settings-card-title">Members</h3>
        <p className="settings-card-desc">Owner can demote any admin. Admins can promote members and demote admins within 72h of their promotion.</p>
        {serverMembers.map((m) => (
          <div key={m.userId} className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{m.username}</span>
              <span className="settings-row-desc">{m.role}</span>
            </div>
            {m.role !== "owner" && m.userId !== user?.id && (
              <button className="btn-small" onClick={() => handleToggleRole(m)}>
                {m.role === "admin" ? "Demote" : "Promote"}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

type SettingsTab = "profile" | "appearance" | "notifications" | "voice" | "keybinds" | "updates" | "spotify" | "cs2" | "debug" | "server-overview" | "server-members" | "server-emojis" | "server-soundboard";

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
  "server-overview": "Overview",
  "server-members": "Members",
  "server-emojis": "Emojis",
  "server-soundboard": "Soundboard",
};

const APP_TABS: SettingsTab[] = ["profile", "appearance", "notifications", "voice", "keybinds", "updates", "spotify", "cs2", "debug"];
const SERVER_TABS: SettingsTab[] = ["server-overview", "server-members", "server-emojis", "server-soundboard"];

export function SettingsModal() {
  const { settingsOpen, settingsTab, closeSettings } = useUIStore(useShallow((s) => ({
    settingsOpen: s.settingsOpen, settingsTab: s.settingsTab, closeSettings: s.closeSettings,
  })));
  const { keybinds } = useKeybindsStore(useShallow((s) => ({ keybinds: s.keybinds })));
  const { account, startOAuthFlow, unlinkAccount, polling, oauthError } = useSpotifyStore(useShallow((s) => ({
    account: s.account, startOAuthFlow: s.startOAuthFlow, unlinkAccount: s.unlinkAccount,
    polling: s.polling, oauthError: s.oauthError,
  })));
  const { betaUpdates, setBetaUpdates } = useUIStore(useShallow((s) => ({
    betaUpdates: s.betaUpdates, setBetaUpdates: s.setBetaUpdates,
  })));
  const { servers, activeServerId, updateServer, leaveServer, members } = useChatStore(useShallow((s) => ({
    servers: s.servers, activeServerId: s.activeServerId, updateServer: s.updateServer,
    leaveServer: s.leaveServer, members: s.members,
  })));
  const user = useAuthStore((s) => s.user);
  const server = servers.find((s) => s.id === activeServerId);
  const isOwner = server?.role === "owner";
  const updater = useUpdater(betaUpdates);

  const [debugMode, setDebugMode] = useState(getDebugEnabled);
  const [logsCopied, setLogsCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    settingsTab && settingsTab in TAB_LABELS ? settingsTab as SettingsTab : "profile"
  );

  // Sync active tab when settingsTab changes from store (e.g. "Browse" button)
  useEffect(() => {
    if (settingsTab && settingsTab in TAB_LABELS) {
      setActiveTab(settingsTab as SettingsTab);
    }
  }, [settingsTab]);

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
        {APP_TABS.map((tab) => (
          <button
            key={tab}
            className={`settings-nav-item ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        {server && (
          <>
            <div className="settings-nav-divider">{server.name}</div>
            {SERVER_TABS.map((tab) => (
              <button
                key={tab}
                className={`settings-nav-item ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </>
        )}
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
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Krisp Diagnostic</span>
                <span className="settings-row-desc">Step-by-step test of Krisp noise filter in this WebView</span>
              </div>
              <button className="btn-small" onClick={() => { window.location.href = "/krisp-test.html"; }}>
                Open Diagnostic
              </button>
            </div>
          </div>
        )}

        {activeTab === "server-overview" && server && (
          <ServerOverviewTab
            server={server}
            isOwner={!!isOwner}
            user={user}
            updateServer={updateServer}
            leaveServer={leaveServer}
            close={closeSettings}
          />
        )}
        {activeTab === "server-members" && server && (
          <ServerMembersTab
            server={server}
            user={user}
            members={members}
          />
        )}
        {activeTab === "server-emojis" && server && (
          <EmojiTab serverId={server.id} />
        )}
        {activeTab === "server-soundboard" && server && (
          <SoundboardTab serverId={server.id} />
        )}
      </div>
    </div>
  );
}
