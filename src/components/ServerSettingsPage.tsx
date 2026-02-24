import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Trash2, X } from "lucide-react";
import { useChatStore } from "../stores/chat/index.js";
import { useAuthStore } from "../stores/auth.js";
import { useUIStore } from "../stores/ui.js";
import * as api from "../lib/api.js";
import type { WhitelistEntry, MemberWithUser } from "../types/shared.js";
import { SoundboardTab } from "./music/SoundboardTab.js";
import { EmojiTab } from "./EmojiTab.js";

function OverviewTab({
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
                if (e.key === "Enter" && serverNameInput.trim()) {
                  setServerNameSaving(true);
                  updateServer(server.id, serverNameInput.trim())
                    .then(() => { setEditingServerName(false); setServerNameSaving(false); })
                    .catch(() => setServerNameSaving(false));
                }
                if (e.key === "Escape") setEditingServerName(false);
              }}
              autoFocus
              style={{ flex: 1 }}
            />
            <button
              className="btn-small btn-primary"
              disabled={serverNameSaving}
              onClick={() => {
                if (!serverNameInput.trim()) return;
                setServerNameSaving(true);
                updateServer(server.id, serverNameInput.trim())
                  .then(() => { setEditingServerName(false); setServerNameSaving(false); })
                  .catch(() => setServerNameSaving(false));
              }}
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

function MembersTab({
  server,
  user,
  members,
}: {
  server: ReturnType<typeof useChatStore.getState>["servers"][0];
  user: ReturnType<typeof useAuthStore.getState>["user"];
  members: MemberWithUser[];
}) {
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([]);
  const [whitelistInput, setWhitelistInput] = useState("");
  const [whitelistLoading, setWhitelistLoading] = useState(false);

  useEffect(() => {
    api.getWhitelist().then(setWhitelist).catch(() => {});
  }, []);

  async function handleAddWhitelist() {
    const email = whitelistInput.trim();
    if (!email) return;
    setWhitelistLoading(true);
    try {
      const added = await api.addToWhitelist([email]);
      if (added.length > 0) setWhitelist((prev) => [...added, ...prev]);
      setWhitelistInput("");
    } catch { /* ignore */ }
    setWhitelistLoading(false);
  }

  async function handleRemoveWhitelist(id: string) {
    try {
      await api.removeFromWhitelist(id);
      setWhitelist((prev) => prev.filter((e) => e.id !== id));
    } catch { /* ignore */ }
  }

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
        <h3 className="settings-card-title">Email Whitelist</h3>
        <p className="settings-card-desc">Only whitelisted emails can register.</p>
        <div className="settings-row" style={{ gap: 8 }}>
          <input
            type="email"
            placeholder="user@example.com"
            value={whitelistInput}
            onChange={(e) => setWhitelistInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddWhitelist(); }}
            style={{ flex: 1 }}
          />
          <button className="btn-small btn-primary" onClick={handleAddWhitelist} disabled={whitelistLoading}>Add</button>
        </div>
        {whitelist.map((entry) => (
          <div key={entry.id} className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">{entry.email}</span>
            </div>
            <button className="btn-small btn-danger" onClick={() => handleRemoveWhitelist(entry.id)} title="Remove">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {whitelist.length === 0 && (
          <p className="settings-card-desc" style={{ opacity: 0.5 }}>No emails whitelisted yet.</p>
        )}
      </div>

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

type Tab = "overview" | "members" | "emojis" | "soundboard";
const TAB_LABELS: Record<Tab, string> = { overview: "Overview", members: "Members", emojis: "Emojis", soundboard: "Soundboard" };
const TABS: Tab[] = ["overview", "members", "emojis", "soundboard"];

export function ServerSettingsPage() {
  const closeServerSettings = useUIStore((s) => s.closeServerSettings);
  const { servers, activeServerId, updateServer, leaveServer, members } = useChatStore(useShallow((s) => ({
    servers: s.servers, activeServerId: s.activeServerId, updateServer: s.updateServer,
    leaveServer: s.leaveServer, members: s.members,
  })));
  const user = useAuthStore((s) => s.user);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const server = servers.find((s) => s.id === activeServerId);
  const isOwner = server?.role === "owner";

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeServerSettings(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeServerSettings]);

  if (!server) return null;

  return (
    <div className="settings-page">
      <div className="settings-nav">
        <div className="settings-nav-header">
          <h2>{server.name}</h2>
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
        <button className="settings-nav-close" onClick={closeServerSettings}>
          <X size={16} />
          <span>Close</span>
        </button>
      </div>

      <div className="settings-content">
        <h1 className="settings-content-title">{TAB_LABELS[activeTab]}</h1>
        {activeTab === "overview" && (
          <OverviewTab
            server={server}
            isOwner={!!isOwner}
            user={user}
            updateServer={updateServer}
            leaveServer={leaveServer}
            close={closeServerSettings}
          />
        )}
        {activeTab === "members" && (
          <MembersTab
            server={server}
            user={user}
            members={members}
          />
        )}
        {activeTab === "emojis" && (
          <EmojiTab serverId={server.id} />
        )}
        {activeTab === "soundboard" && (
          <SoundboardTab serverId={server.id} />
        )}
      </div>
    </div>
  );
}
