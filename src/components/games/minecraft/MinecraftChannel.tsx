import { useState } from "react";
import { Copy, Check, ChevronDown, Circle } from "lucide-react";
import minecraftLogo from "@/assets/games/minecraft-logo.png";
import "./styles/minecraft.css";

const SERVER_IP = "play.fluxchat.net";

const RULES = [
  { title: "No Griefing", detail: "Don't destroy or modify other players' builds without permission. This includes TNT, lava, and water griefing." },
  { title: "Respect Others", detail: "Same rules as the Flux server — be kind in chat, no hate speech, harassment, or toxicity." },
  { title: "No Cheating", detail: "Hacked clients, x-ray texture packs, duplication exploits, and any unfair advantage mods are banned." },
  { title: "Keep Builds Appropriate", detail: "No offensive structures or pixel art. Builds should be something everyone can enjoy." },
  { title: "Have Fun", detail: "It's a game. Don't take things too seriously, help new players, and enjoy the community." },
];

function CopyIpButton() {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(SERVER_IP).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="mc-cta" onClick={handleCopy}>
      {copied ? <><Check size={16} /> Copied!</> : <><Copy size={16} /> Copy Server IP</>}
    </button>
  );
}

function RuleItem({ rule, index }: { rule: typeof RULES[number]; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`mc-rule ${open ? "mc-rule-open" : ""}`}>
      <button className="mc-rule-header" onClick={() => setOpen(!open)}>
        <span className="mc-rule-num">{index + 1}</span>
        <span className="mc-rule-title">{rule.title}</span>
        <ChevronDown size={14} className={`mc-rule-chevron ${open ? "mc-rule-chevron-open" : ""}`} />
      </button>
      {open && <div className="mc-rule-body">{rule.detail}</div>}
    </div>
  );
}

export default function MinecraftChannel() {
  return (
    <div className="mc-page">
      {/* ── Top nav bar ── */}
      <nav className="mc-nav">
        <div className="mc-nav-brand">
          <img src={minecraftLogo} alt="" className="mc-nav-logo" />
          <span className="mc-nav-name">Flux MC</span>
        </div>
        <div className="mc-nav-links">
          <span className="mc-nav-link mc-nav-active">Home</span>
          <span className="mc-nav-link">Game Modes</span>
          <span className="mc-nav-link">Rules</span>
        </div>
        <div className="mc-nav-right">
          <div className="mc-nav-status">
            <Circle size={7} fill="#22c55e" stroke="none" />
            <span>Online</span>
          </div>
          <code className="mc-nav-ip">{SERVER_IP}</code>
        </div>
      </nav>

      <div className="mc-scroll">
        {/* ── Hero — left text, right decorative ── */}
        <section className="mc-hero">
          <div className="mc-hero-left">
            <span className="mc-hero-badge">Minecraft Java 1.21+</span>
            <h1 className="mc-hero-title">
              Your next adventure<br />starts <span className="mc-green">here.</span>
            </h1>
            <p className="mc-hero-desc">
              Join the Flux Minecraft community. Survival, creative, and minigames —
              all on one server, always online, zero pay-to-win.
            </p>
            <div className="mc-hero-actions">
              <CopyIpButton />
              <div className="mc-hero-ip">
                <span className="mc-hero-ip-label">Server Address</span>
                <code className="mc-hero-ip-value">{SERVER_IP}</code>
              </div>
            </div>
            <div className="mc-hero-stats">
              <div className="mc-hero-stat">
                <strong>50</strong>
                <span>Players</span>
              </div>
              <div className="mc-hero-stat">
                <strong>24/7</strong>
                <span>Uptime</span>
              </div>
              <div className="mc-hero-stat">
                <strong>Hard</strong>
                <span>Difficulty</span>
              </div>
            </div>
          </div>
          <div className="mc-hero-right">
            <div className="mc-hero-visual">
              <img src={minecraftLogo} alt="" className="mc-hero-block" />
            </div>
          </div>
        </section>

        {/* ── Alternating section: Survival (text left, visual right) ── */}
        <section className="mc-feature mc-feature-alt">
          <div className="mc-feature-text">
            <span className="mc-feature-label">Game Mode</span>
            <h2>Survival</h2>
            <p>Classic survival with land claims, player economy, and community builds.
            Gather resources, build your base, and thrive with friends. Our economy plugin
            lets you trade with other players, set up shops, and earn your way to the top.</p>
            <div className="mc-feature-tags">
              <span>PvE</span><span>Economy</span><span>Land Claims</span>
            </div>
          </div>
          <div className="mc-feature-visual">
            <div className="mc-feature-icon-box mc-icon-green-box">⛏</div>
          </div>
        </section>

        {/* ── Alternating section: Creative (visual left, text right) ── */}
        <section className="mc-feature">
          <div className="mc-feature-visual">
            <div className="mc-feature-icon-box mc-icon-cyan-box">🏗</div>
          </div>
          <div className="mc-feature-text">
            <span className="mc-feature-label">Game Mode</span>
            <h2>Creative</h2>
            <p>Unlimited creative plots for building whatever you imagine. WorldEdit access
            for trusted members. Showcase your masterpiece to the whole server — we host
            build competitions every month with prizes.</p>
            <div className="mc-feature-tags">
              <span>Building</span><span>WorldEdit</span><span>Plots</span>
            </div>
          </div>
        </section>

        {/* ── Alternating section: Minigames (text left, visual right) ── */}
        <section className="mc-feature mc-feature-alt">
          <div className="mc-feature-text">
            <span className="mc-feature-label">Game Mode</span>
            <h2>Minigames</h2>
            <p>Bed Wars, SkyWars, and custom community games. Compete with friends and climb
            the leaderboards. New games added regularly based on community votes.</p>
            <div className="mc-feature-tags">
              <span>PvP</span><span>Competitive</span><span>Custom</span>
            </div>
          </div>
          <div className="mc-feature-visual">
            <div className="mc-feature-icon-box mc-icon-amber-box">⚔</div>
          </div>
        </section>

        {/* ── How to join — step bar ── */}
        <section className="mc-join-section">
          <h2 className="mc-join-heading">Get Started in 30 Seconds</h2>
          <div className="mc-join-steps">
            <div className="mc-join-step">
              <div className="mc-join-num">1</div>
              <strong>Open Minecraft</strong>
              <span>Java Edition 1.21+</span>
            </div>
            <div className="mc-join-line" />
            <div className="mc-join-step">
              <div className="mc-join-num">2</div>
              <strong>Add Server</strong>
              <span>Multiplayer → Add</span>
            </div>
            <div className="mc-join-line" />
            <div className="mc-join-step">
              <div className="mc-join-num">3</div>
              <strong>Enter IP</strong>
              <code>{SERVER_IP}</code>
            </div>
            <div className="mc-join-line" />
            <div className="mc-join-step">
              <div className="mc-join-num">4</div>
              <strong>Play!</strong>
              <span>See you there</span>
            </div>
          </div>
        </section>

        {/* ── Rules ── */}
        <section className="mc-rules-section">
          <div className="mc-rules-header">
            <h2>Server Rules</h2>
            <p>Keep it fun for everyone.</p>
          </div>
          <div className="mc-rules-list">
            {RULES.map((rule, i) => (
              <RuleItem key={rule.title} rule={rule} index={i} />
            ))}
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="mc-footer">
          <div className="mc-footer-left">
            <img src={minecraftLogo} alt="" className="mc-footer-logo" />
            <span>Flux Minecraft Server</span>
          </div>
          <div className="mc-footer-right">
            <code>{SERVER_IP}</code>
            <span>Java Edition 1.21+ · Hard · 50 Slots</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
