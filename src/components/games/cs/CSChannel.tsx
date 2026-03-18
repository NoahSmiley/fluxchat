import { useState, useCallback } from "react";
import { Copy, Check, Crosshair, Target, Zap, Activity, Waves, Swords } from "lucide-react";
import csLogo from "@/assets/games/cs-logo.png";
import "./styles/cs.css";

const CMD_GROUPS = [
  {
    label: "Practice",
    commands: [
      { cmd: "sv_cheats 1", desc: "Enable cheats" },
      { cmd: "mp_warmup_end", desc: "End warmup" },
      { cmd: "mp_freezetime 0", desc: "No freeze time" },
      { cmd: "sv_infinite_ammo 1", desc: "Infinite ammo" },
      { cmd: "sv_grenade_trajectory 1", desc: "Show nade path" },
      { cmd: "bind x noclip", desc: "Noclip on X" },
      { cmd: "bot_kick", desc: "Remove bots" },
    ],
  },
  {
    label: "Crosshair",
    commands: [
      { cmd: "cl_crosshairsize 2", desc: "Size" },
      { cmd: "cl_crosshairgap -2", desc: "Gap" },
      { cmd: "cl_crosshairthickness 0.5", desc: "Thickness" },
      { cmd: "cl_crosshaircolor 1", desc: "Green" },
    ],
  },
  {
    label: "Network",
    commands: [
      { cmd: "rate 786432", desc: "Max bandwidth" },
      { cmd: "cl_interp_ratio 1", desc: "Interp ratio" },
      { cmd: "cl_interp 0", desc: "Auto interp" },
    ],
  },
];

const SURF_SERVERS = [
  { name: "Surf Beginner", ip: "74.91.113.87:27015", tier: "T1-T2", map: "surf_beginner", difficulty: "Easy" },
  { name: "Surf Intermediate", ip: "74.91.113.87:27016", tier: "T3-T4", map: "surf_mesa", difficulty: "Medium" },
  { name: "Surf Advanced", ip: "74.91.113.87:27017", tier: "T5-T6", map: "surf_kitsune", difficulty: "Hard" },
];

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button className="cs-copy-btn" onClick={handleCopy} title="Copy">
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

export default function CSChannel() {
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const handleConnect = useCallback((ip: string) => {
    navigator.clipboard.writeText(`connect ${ip}`).then(() => {
      setCopiedIp(ip);
      setTimeout(() => setCopiedIp(null), 2000);
    });
  }, []);

  return (
    <div className="cs-page">
      {/* ── Status bar at top ── */}
      <div className="cs-topbar">
        <img src={csLogo} alt="" className="cs-topbar-logo" />
        <span className="cs-topbar-title">COUNTER-STRIKE 2</span>
        <span className="cs-topbar-sep">|</span>
        <span className="cs-topbar-sub">FLUX DIVISION — TACTICAL BRIEFING</span>
      </div>

      <div className="cs-scroll">
        {/* ── Featured ops banner ── */}
        <div className="cs-banner">
          <div className="cs-banner-scanlines" />
          <div className="cs-banner-content">
            <span className="cs-banner-label">CURRENT OPERATIONS</span>
            <h1 className="cs-banner-title">Frag out with the Flux crew</h1>
            <p className="cs-banner-desc">Competitive 5v5s, surf servers, and weekly custom game nights. All skill levels welcome.</p>
          </div>
          <div className="cs-banner-stats">
            <div className="cs-banner-stat">
              <strong>4</strong>
              <span>Game Modes</span>
            </div>
            <div className="cs-banner-stat">
              <strong>3</strong>
              <span>Surf Servers</span>
            </div>
            <div className="cs-banner-stat">
              <strong>25+</strong>
              <span>Console Cmds</span>
            </div>
          </div>
        </div>

        {/* ── Two-column content: game modes + commands ── */}
        <div className="cs-columns">
          {/* Left column — game modes + surf */}
          <div className="cs-col-main">
            <h2 className="cs-col-heading">Game Modes</h2>
            <div className="cs-mode-list">
              <div className="cs-mode-row">
                <div className="cs-mode-icon"><Crosshair size={18} /></div>
                <div className="cs-mode-info">
                  <h3>Competitive</h3>
                  <p>5v5 scrims and ranked play. Queue with the squad.</p>
                </div>
              </div>
              <div className="cs-mode-row">
                <div className="cs-mode-icon"><Zap size={18} /></div>
                <div className="cs-mode-info">
                  <h3>Deathmatch</h3>
                  <p>Free-for-all aim warmup. Crosshair placement drills.</p>
                </div>
              </div>
              <div className="cs-mode-row">
                <div className="cs-mode-icon"><Target size={18} /></div>
                <div className="cs-mode-info">
                  <h3>Retakes</h3>
                  <p>Post-plant scenarios. Practice site holds and retakes.</p>
                </div>
              </div>
              <div className="cs-mode-row">
                <div className="cs-mode-icon"><Activity size={18} /></div>
                <div className="cs-mode-info">
                  <h3>Wingman</h3>
                  <p>2v2 competitive on smaller maps. Duo queue.</p>
                </div>
              </div>
            </div>

            <h2 className="cs-col-heading" style={{ marginTop: 32 }}>
              <Waves size={16} /> Surf Servers
            </h2>
            <div className="cs-surf-table">
              {SURF_SERVERS.map((s) => (
                <div key={s.ip} className="cs-surf-row">
                  <div className="cs-surf-info">
                    <span className="cs-surf-name">{s.name}</span>
                    <code className="cs-surf-map">{s.map}</code>
                  </div>
                  <span className={`cs-surf-badge cs-surf-${s.difficulty.toLowerCase()}`}>{s.tier}</span>
                  <button className="cs-connect-btn" onClick={() => handleConnect(s.ip)}>
                    {copiedIp === s.ip ? "Copied" : "Connect"}
                  </button>
                </div>
              ))}
            </div>

            <div className="cs-tips-box">
              <div className="cs-tips-label"><Swords size={13} /> Pro Tips</div>
              <ul>
                <li>Always buy utility — flashes and smokes win rounds</li>
                <li>Practice counter-strafing for accurate first shots</li>
                <li>Learn 2-3 default smokes per map</li>
              </ul>
            </div>
          </div>

          {/* Right column — console commands reference */}
          <div className="cs-col-side">
            <h2 className="cs-col-heading">Console Reference</h2>
            {CMD_GROUPS.map((group) => (
              <div key={group.label} className="cs-cmd-group">
                <div className="cs-cmd-label">{`>> ${group.label}`}</div>
                {group.commands.map((c) => (
                  <div key={c.cmd} className="cs-cmd-row">
                    <code className="cs-cmd-code">{c.cmd}</code>
                    <span className="cs-cmd-desc">{c.desc}</span>
                    <CopyBtn text={c.cmd} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
