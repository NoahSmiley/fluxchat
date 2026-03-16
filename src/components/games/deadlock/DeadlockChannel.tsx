import { useState } from "react";
import { Home, Users, Crosshair } from "lucide-react";
import deadlockLogo from "@/assets/games/deadlock-logo.png";
import "./styles/deadlock.css";

type Tab = "home" | "heroes" | "builds";

function HomeTab() {
  return (
    <div className="dl-home">
      <div className="dl-hero">
        <div className="dl-hero-content">
          <img src={deadlockLogo} alt="Deadlock" className="dl-hero-logo" />
          <div className="dl-hero-badge">HERO SHOOTER • MOBA • 6v6</div>
          <p className="dl-hero-desc">
            Valve's third-person hero shooter meets MOBA. Push lanes, farm souls, and team fight your way to victory.
          </p>
        </div>
      </div>

      <div className="dl-cards">
        <div className="dl-card">
          <h4>Ranked</h4>
          <p>Queue up ranked with the squad. Coordinate lanes and draft complementary heroes.</p>
        </div>
        <div className="dl-card">
          <h4>Hero Lab</h4>
          <p>Test new heroes and builds in unranked before bringing them to comp.</p>
        </div>
        <div className="dl-card">
          <h4>Community Nights</h4>
          <p>Weekly in-house 6v6 scrims. Check announcements for schedule.</p>
        </div>
      </div>
    </div>
  );
}

const HEROES = [
  { name: "Abrams", role: "Tank", lane: "Solo", desc: "Durable frontline brawler with self-sustain" },
  { name: "Bebop", role: "Support", lane: "Duo", desc: "Hook-based playmaker with team utility" },
  { name: "Dynamo", role: "Support", lane: "Duo", desc: "AOE healer and team fight disruptor" },
  { name: "Grey Talon", role: "Carry", lane: "Duo", desc: "Long-range sniper with area denial" },
  { name: "Haze", role: "Carry", lane: "Solo", desc: "Stealth assassin with high burst damage" },
  { name: "Infernus", role: "Carry", lane: "Solo", desc: "Burn damage specialist with AOE ult" },
  { name: "Ivy", role: "Support", lane: "Duo", desc: "Mobile support with targeted healing" },
  { name: "Kelvin", role: "Tank", lane: "Solo", desc: "Ice-based tank with crowd control" },
  { name: "Lady Geist", role: "Carry", lane: "Solo", desc: "Life-drain mage with scaling power" },
  { name: "Lash", role: "Tank", lane: "Solo", desc: "Aggressive diver with displacement" },
  { name: "McGinnis", role: "Support", lane: "Duo", desc: "Turret engineer with zone control" },
  { name: "Mo & Krill", role: "Tank", lane: "Solo", desc: "Burrow ganker with lockdown" },
  { name: "Paradox", role: "Carry", lane: "Duo", desc: "Time-manipulating duelist" },
  { name: "Pocket", role: "Carry", lane: "Solo", desc: "Briefcase-wielding burst mage" },
  { name: "Seven", role: "Carry", lane: "Solo", desc: "Lightning mage with channel ult" },
  { name: "Shiv", role: "Carry", lane: "Solo", desc: "Bleed-stacking melee assassin" },
  { name: "Vindicta", role: "Carry", lane: "Duo", desc: "Flying sniper with execute ultimate" },
  { name: "Viscous", role: "Tank", lane: "Duo", desc: "Slime ball with team-save abilities" },
  { name: "Warden", role: "Tank", lane: "Solo", desc: "Lockdown tank with binding abilities" },
  { name: "Wraith", role: "Carry", lane: "Solo", desc: "Card-throwing burst damage dealer" },
  { name: "Yamato", role: "Carry", lane: "Solo", desc: "Samurai duelist with power spike ult" },
];

function HeroesTab() {
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const roles = ["Tank", "Carry", "Support"];

  const filtered = roleFilter ? HEROES.filter((h) => h.role === roleFilter) : HEROES;

  return (
    <div className="dl-heroes">
      <div className="dl-heroes-header">
        <h3>Hero Roster</h3>
        <div className="dl-role-filters">
          <button
            className={`dl-role-btn ${roleFilter === null ? "active" : ""}`}
            onClick={() => setRoleFilter(null)}
          >All</button>
          {roles.map((r) => (
            <button
              key={r}
              className={`dl-role-btn ${roleFilter === r ? "active" : ""}`}
              onClick={() => setRoleFilter(r)}
            >{r}</button>
          ))}
        </div>
      </div>

      <div className="dl-hero-grid">
        {filtered.map((hero) => (
          <div key={hero.name} className="dl-hero-card">
            <div className="dl-hero-card-top">
              <span className="dl-hero-name">{hero.name}</span>
              <span className={`dl-hero-role dl-role-${hero.role.toLowerCase()}`}>{hero.role}</span>
            </div>
            <span className="dl-hero-lane">{hero.lane} Lane</span>
            <p className="dl-hero-card-desc">{hero.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function BuildsTab() {
  return (
    <div className="dl-builds">
      <div className="dl-builds-intro">
        <h3>Community Builds</h3>
        <p>Popular item builds shared by Flux members. These are starting points — adapt to each game.</p>
      </div>

      <div className="dl-build-list">
        <div className="dl-build-card">
          <div className="dl-build-header">
            <span className="dl-build-hero">Haze</span>
            <span className="dl-build-tag">Burst Assassin</span>
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Early:</span> Headshot Booster → Melee Lifesteal → Sprint Boots
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Mid:</span> Mystic Shot → Titanic Magazine → Quicksilver Reload
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Late:</span> Glass Cannon → Silencer → Shadow Weave
          </div>
          <p className="dl-build-note">Focus on farming early. Go for picks after Fixation is online.</p>
        </div>

        <div className="dl-build-card">
          <div className="dl-build-header">
            <span className="dl-build-hero">Abrams</span>
            <span className="dl-build-tag">Frontline Tank</span>
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Early:</span> Extra Health → Melee Lifesteal → Healing Rite
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Mid:</span> Bullet Armor → Spirit Armor → Veil Walker
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Late:</span> Unstoppable → Leech → Colossus
          </div>
          <p className="dl-build-note">Play aggressive in lane. Use charge to initiate team fights.</p>
        </div>

        <div className="dl-build-card">
          <div className="dl-build-header">
            <span className="dl-build-hero">Dynamo</span>
            <span className="dl-build-tag">Healer Support</span>
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Early:</span> Extra Spirit → Healing Rite → Sprint Boots
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Mid:</span> Improved Cooldown → Mystic Reach → Decay
          </div>
          <div className="dl-build-items">
            <span className="dl-build-phase">Late:</span> Refresher → Diviner's Kevlar → Ethereal Shift
          </div>
          <p className="dl-build-note">Stay behind your tank. Save ult for multi-man team fights.</p>
        </div>
      </div>
    </div>
  );
}

export default function DeadlockChannel() {
  const [activeTab, setActiveTab] = useState<Tab>("home");

  return (
    <div className="game-page dl-page">
      <div className="dl-header-bar">
        <div className="dl-header-brand">
          <img src={deadlockLogo} alt="Deadlock" className="dl-header-logo" />
        </div>
        <div className="dl-tabs">
          <button className={`dl-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>
            <Home size={14} /> Home
          </button>
          <button className={`dl-tab ${activeTab === "heroes" ? "active" : ""}`} onClick={() => setActiveTab("heroes")}>
            <Users size={14} /> Heroes
          </button>
          <button className={`dl-tab ${activeTab === "builds" ? "active" : ""}`} onClick={() => setActiveTab("builds")}>
            <Crosshair size={14} /> Builds
          </button>
        </div>
      </div>

      <div className="dl-tab-content">
        {activeTab === "home" && <HomeTab />}
        {activeTab === "heroes" && <HeroesTab />}
        {activeTab === "builds" && <BuildsTab />}
      </div>
    </div>
  );
}
