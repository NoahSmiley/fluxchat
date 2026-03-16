import { useState } from "react";
import { Home, Info, Copy, Check, Map, Swords, Shield } from "lucide-react";
import minecraftLogo from "@/assets/games/minecraft-logo.png";
import "./styles/minecraft.css";

const SERVER_IP = "play.fluxchat.net";

type Tab = "home" | "info";

function HomeTab() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(SERVER_IP).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mc-home">
      <div className="mc-hero">
        <div className="mc-hero-content">
          <img src={minecraftLogo} alt="Minecraft" className="mc-hero-logo" />
          <div className="mc-hero-badge">SURVIVAL • CREATIVE • MINIGAMES</div>
          <p className="mc-hero-desc">
            Build, explore, and survive together. Our Flux community server is always online.
          </p>
          <div className="mc-connect-row">
            <code className="mc-connect-ip">{SERVER_IP}</code>
            <button className="mc-connect-copy" onClick={handleCopy}>
              {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy IP</>}
            </button>
          </div>
          <div className="mc-connect-meta">Java Edition • 1.21+</div>
        </div>
      </div>

      <div className="mc-features">
        <div className="mc-feature-card">
          <div className="mc-feature-icon"><Swords size={20} /></div>
          <div className="mc-feature-info">
            <h4>Survival</h4>
            <p>Classic survival with land claims, economy, and community builds</p>
          </div>
        </div>
        <div className="mc-feature-card">
          <div className="mc-feature-icon"><Map size={20} /></div>
          <div className="mc-feature-info">
            <h4>Creative</h4>
            <p>Unlimited plots for building whatever you can imagine</p>
          </div>
        </div>
        <div className="mc-feature-card">
          <div className="mc-feature-icon"><Shield size={20} /></div>
          <div className="mc-feature-info">
            <h4>Minigames</h4>
            <p>Bed Wars, Skywars, and custom games built by the community</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoTab() {
  return (
    <div className="mc-info">
      <div className="mc-info-card">
        <h3>How to Join</h3>
        <ol className="mc-steps">
          <li>
            <span className="mc-step-num">1</span>
            <span>Open <strong>Minecraft Java Edition</strong> (1.21 or newer)</span>
          </li>
          <li>
            <span className="mc-step-num">2</span>
            <span>Go to <strong>Multiplayer</strong> → <strong>Add Server</strong></span>
          </li>
          <li>
            <span className="mc-step-num">3</span>
            <span>Enter server address: <code>{SERVER_IP}</code></span>
          </li>
          <li>
            <span className="mc-step-num">4</span>
            <span>Click <strong>Done</strong>, then <strong>Join Server</strong></span>
          </li>
        </ol>
      </div>

      <div className="mc-info-card">
        <h3>Rules</h3>
        <ul className="mc-rules">
          <li>No griefing or stealing from other players</li>
          <li>Be respectful in chat — same rules as the Flux server</li>
          <li>No hacked clients, x-ray, or exploits</li>
          <li>Keep builds appropriate</li>
          <li>Have fun — it's a game</li>
        </ul>
      </div>

      <div className="mc-info-card">
        <h3>Server Details</h3>
        <div className="mc-detail-grid">
          <div className="mc-detail-row">
            <span className="mc-detail-label">Version</span>
            <span className="mc-detail-value">Java 1.21+</span>
          </div>
          <div className="mc-detail-row">
            <span className="mc-detail-label">Gamemode</span>
            <span className="mc-detail-value">Survival / Creative / Minigames</span>
          </div>
          <div className="mc-detail-row">
            <span className="mc-detail-label">Difficulty</span>
            <span className="mc-detail-value">Hard</span>
          </div>
          <div className="mc-detail-row">
            <span className="mc-detail-label">Whitelist</span>
            <span className="mc-detail-value">Off — open to all Flux members</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MinecraftChannel() {
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div className="game-page minecraft-page">
      <div className="mc-header-bar">
        <div className="mc-header-brand">
          <img src={minecraftLogo} alt="Minecraft" className="mc-header-logo" />
        </div>
        <div className="mc-tabs">
          <button className={`mc-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>
            <Home size={14} /> Home
          </button>
          <button className={`mc-tab ${activeTab === "info" ? "active" : ""}`} onClick={() => setActiveTab("info")}>
            <Info size={14} /> Server Info
          </button>
        </div>
      </div>

      <div className="mc-tab-content">
        {activeTab === "home" && <HomeTab />}
        {activeTab === "info" && <InfoTab />}
      </div>
    </div>
  );
}
