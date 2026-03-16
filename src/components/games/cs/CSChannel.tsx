import { useState, useCallback } from "react";
import { Home, Terminal, Waves, Copy, Check } from "lucide-react";
import csLogo from "@/assets/games/cs-logo.png";
import "./styles/cs.css";

type Tab = "home" | "commands" | "surf";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="cs-copy-btn" onClick={handleCopy} title="Copy">
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function CommandRow({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="cs-cmd-row">
      <div className="cs-cmd-left">
        <code className="cs-cmd">{cmd}</code>
        <CopyButton text={cmd} />
      </div>
      <span className="cs-cmd-desc">{desc}</span>
    </div>
  );
}

function HomeTab() {
  return (
    <div className="cs-home">
      <div className="cs-hero">
        <div className="cs-hero-content">
          <img src={csLogo} alt="Counter-Strike" className="cs-hero-logo" />
          <div className="cs-hero-badge">COMPETITIVE • CASUAL • SURF • DEATHMATCH</div>
          <p className="cs-hero-desc">
            Frag out with the Flux crew. Competitive 5v5s, surf servers, and custom game nights.
          </p>
        </div>
      </div>

      <div className="cs-cards">
        <div className="cs-card">
          <h4>5v5 Competitive</h4>
          <p>Organized scrims and ranked play. Hop in voice and queue up with the squad.</p>
        </div>
        <div className="cs-card">
          <h4>Surf</h4>
          <p>Community surf servers for when you want to chill and grind movement.</p>
        </div>
        <div className="cs-card">
          <h4>Deathmatch & Retakes</h4>
          <p>Warm up your aim or practice site holds before comp matches.</p>
        </div>
      </div>
    </div>
  );
}

function CommandsTab() {
  return (
    <div className="cs-commands">
      <div className="cs-cmd-section">
        <h3>Practice Config</h3>
        <p className="cs-cmd-section-desc">Paste into console for offline practice</p>
        <div className="cs-cmd-list">
          <CommandRow cmd="sv_cheats 1" desc="Enable cheats" />
          <CommandRow cmd="mp_warmup_end" desc="End warmup" />
          <CommandRow cmd="mp_freezetime 0" desc="No freeze time" />
          <CommandRow cmd="mp_roundtime_defuse 60" desc="60 min rounds" />
          <CommandRow cmd="sv_infinite_ammo 1" desc="Infinite ammo" />
          <CommandRow cmd="sv_grenade_trajectory 1" desc="Show grenade trajectory" />
          <CommandRow cmd="sv_grenade_trajectory_time 10" desc="Trajectory display time" />
          <CommandRow cmd="bind x noclip" desc="Bind noclip to X" />
        </div>
      </div>

      <div className="cs-cmd-section">
        <h3>Crosshair</h3>
        <div className="cs-cmd-list">
          <CommandRow cmd="cl_crosshairsize 2" desc="Crosshair size" />
          <CommandRow cmd="cl_crosshairgap -2" desc="Crosshair gap" />
          <CommandRow cmd="cl_crosshairthickness 0.5" desc="Thickness" />
          <CommandRow cmd="cl_crosshair_drawoutline 1" desc="Outline on" />
          <CommandRow cmd="cl_crosshaircolor 1" desc="Green crosshair" />
        </div>
      </div>

      <div className="cs-cmd-section">
        <h3>Network</h3>
        <div className="cs-cmd-list">
          <CommandRow cmd="rate 786432" desc="Max bandwidth" />
          <CommandRow cmd="cl_interp_ratio 1" desc="Interp ratio" />
          <CommandRow cmd="cl_interp 0" desc="Auto interp" />
          <CommandRow cmd="cl_cmdrate 128" desc="Command rate" />
          <CommandRow cmd="cl_updaterate 128" desc="Update rate" />
        </div>
      </div>
    </div>
  );
}

function SurfTab() {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = useCallback((ip: string) => {
    navigator.clipboard.writeText(ip).then(() => {
      setCopied(ip);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  const servers = [
    { name: "Surf Beginner", ip: "74.91.113.87:27015", tier: "Tier 1-2", desc: "Easy maps for learning surf" },
    { name: "Surf Intermediate", ip: "74.91.113.87:27016", tier: "Tier 3-4", desc: "Medium difficulty maps" },
    { name: "Surf Advanced", ip: "74.91.113.87:27017", tier: "Tier 5-6", desc: "Hard maps for experienced surfers" },
  ];

  return (
    <div className="cs-surf">
      <div className="cs-surf-intro">
        <h3>Surf Servers</h3>
        <p>Community surf servers sorted by difficulty. Connect via console.</p>
      </div>

      <div className="cs-surf-list">
        {servers.map((s) => (
          <div key={s.ip} className="cs-surf-card">
            <div className="cs-surf-header">
              <span className="cs-surf-name">{s.name}</span>
              <span className="cs-surf-tier">{s.tier}</span>
            </div>
            <p className="cs-surf-desc">{s.desc}</p>
            <div className="cs-surf-connect">
              <code>connect {s.ip}</code>
              <button className="cs-copy-btn" onClick={() => handleCopy(`connect ${s.ip}`)}>
                {copied === `connect ${s.ip}` ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="cs-surf-tips">
        <h4>Surf Tips</h4>
        <ul>
          <li>Hold <kbd>A</kbd> or <kbd>D</kbd> to strafe — never hold <kbd>W</kbd></li>
          <li>Move your mouse gently in the direction you're strafing</li>
          <li>Land on ramps at a shallow angle for max speed</li>
          <li>Use <code>cl_showpos 1</code> to see your velocity</li>
        </ul>
      </div>
    </div>
  );
}

export default function CSChannel() {
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div className="game-page cs-page">
      <div className="cs-header-bar">
        <div className="cs-header-brand">
          <img src={csLogo} alt="Counter-Strike" className="cs-header-logo" />
        </div>
        <div className="cs-tabs">
          <button className={`cs-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>
            <Home size={14} /> Home
          </button>
          <button className={`cs-tab ${activeTab === "commands" ? "active" : ""}`} onClick={() => setActiveTab("commands")}>
            <Terminal size={14} /> Commands
          </button>
          <button className={`cs-tab ${activeTab === "surf" ? "active" : ""}`} onClick={() => setActiveTab("surf")}>
            <Waves size={14} /> Surf
          </button>
        </div>
      </div>

      <div className="cs-tab-content">
        {activeTab === "home" && <HomeTab />}
        {activeTab === "commands" && <CommandsTab />}
        {activeTab === "surf" && <SurfTab />}
      </div>
    </div>
  );
}
