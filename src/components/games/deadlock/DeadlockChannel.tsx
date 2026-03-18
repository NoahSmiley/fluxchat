import { useState, useMemo } from "react";
import { Copy, Check, Shield, Sword, Heart, ChevronRight } from "lucide-react";
import deadlockLogo from "@/assets/games/deadlock-logo.png";
import "./styles/deadlock.css";

// ── Hero data ──

interface Hero {
  name: string;
  role: "Tank" | "Carry" | "Support";
  lane: string;
  desc: string;
  abilities: string[];
  tip: string;
}

const HEROES: Hero[] = [
  { name: "Abrams", role: "Tank", lane: "Solo", desc: "Durable frontline brawler with self-sustain and gap-closing charge", abilities: ["Shoulder Charge", "Infernal Resilience", "Seismic Impact", "Phantasmal Slash"], tip: "Play aggressive in lane. Use charge to initiate team fights." },
  { name: "Bebop", role: "Support", lane: "Duo", desc: "Hook-based playmaker with team displacement and bomb utility", abilities: ["Hook", "Sticky Bomb", "Hyperbeam", "Afterburn"], tip: "Land hooks from fog. Combo with sticky bomb for burst." },
  { name: "Dynamo", role: "Support", lane: "Duo", desc: "AOE healer and team fight disruptor with massive ultimate", abilities: ["Kinetic Pulse", "Quantum Entanglement", "Rejuvenating Aurora", "Singularity"], tip: "Stay behind your tank. Save ult for multi-man fights." },
  { name: "Grey Talon", role: "Carry", lane: "Duo", desc: "Long-range sniper with area denial and rain of arrows", abilities: ["Charged Shot", "Rain of Arrows", "Guided Owl", "Spirit Snare"], tip: "Position on high ground. Use owl for scouting." },
  { name: "Haze", role: "Carry", lane: "Solo", desc: "Stealth assassin with high burst damage and execute potential", abilities: ["Sleep Dagger", "Smoke Bomb", "Fixation", "Bullet Dance"], tip: "Farm early, go for picks once Fixation is online." },
  { name: "Infernus", role: "Carry", lane: "Solo", desc: "Burn damage specialist with devastating AOE ultimate", abilities: ["Catalyst", "Flame Dash", "Afterburn", "Concussive Combustion"], tip: "Stack burn then ult for maximum damage output." },
  { name: "Ivy", role: "Support", lane: "Duo", desc: "Mobile support with targeted healing and stone form save", abilities: ["Kudzu Bomb", "Air Drop", "Stone Form", "Watcher's Covenant"], tip: "Use Air Drop for rotations. Save Stone Form for carries." },
  { name: "Kelvin", role: "Tank", lane: "Solo", desc: "Ice-based tank with crowd control and terrain manipulation", abilities: ["Frost Grenade", "Ice Path", "Arctic Beam", "Frozen Shelter"], tip: "Use Ice Path to engage or escape. Shelter wins team fights." },
  { name: "Lady Geist", role: "Carry", lane: "Solo", desc: "Life-drain mage with scaling power and soul exchange", abilities: ["Essence Bomb", "Life Drain", "Malice", "Soul Exchange"], tip: "Trade HP aggressively. Soul Exchange turns losing fights." },
  { name: "Lash", role: "Tank", lane: "Solo", desc: "Aggressive diver with displacement and ground slam", abilities: ["Ground Strike", "Grapple", "Flog", "Death Slam"], tip: "Grapple to high ground, then Death Slam onto grouped enemies." },
  { name: "McGinnis", role: "Support", lane: "Duo", desc: "Turret engineer with zone control and healing station", abilities: ["Mini Turret", "Medicinal Specter", "Spectral Wall", "Heavy Barrage"], tip: "Place turrets on objectives. Wall blocks key choke points." },
  { name: "Mo & Krill", role: "Tank", lane: "Solo", desc: "Burrow ganker with lockdown and sustain", abilities: ["Scorn", "Burrow", "Sand Blast", "Combo"], tip: "Burrow from fog for surprise engages. Combo locks down carries." },
  { name: "Paradox", role: "Carry", lane: "Duo", desc: "Time-manipulating duelist with swap and kinetic carbine", abilities: ["Pulse Grenade", "Time Wall", "Kinetic Carbine", "Paradoxical Swap"], tip: "Swap enemies into your team. Time Wall blocks abilities." },
  { name: "Pocket", role: "Carry", lane: "Solo", desc: "Briefcase-wielding burst mage with barrage ultimate", abilities: ["Barrage", "Flying Cloak", "Enchanter's Satchel", "Affliction"], tip: "Fly above enemies and rain down Barrage for area control." },
  { name: "Seven", role: "Carry", lane: "Solo", desc: "Lightning mage with devastating channel ultimate", abilities: ["Lightning Ball", "Static Charge", "Power Surge", "Storm Cloud"], tip: "Farm stacks on Static Charge. Ult in team fights from safety." },
  { name: "Shiv", role: "Carry", lane: "Solo", desc: "Bleed-stacking melee assassin with execute rage", abilities: ["Serrated Knives", "Bloodletting", "Slice and Dice", "Killing Blow"], tip: "Stack bleeds then execute with Killing Blow at low HP." },
  { name: "Vindicta", role: "Carry", lane: "Duo", desc: "Flying sniper with global execute ultimate", abilities: ["Stake", "Flight", "Crow Familiar", "Assassinate"], tip: "Fly for positioning. Assassinate low HP targets globally." },
  { name: "Viscous", role: "Tank", lane: "Duo", desc: "Slime ball with team-save abilities and puddle punch", abilities: ["Splatter", "Puddle Punch", "The Cube", "Goo Ball"], tip: "Cube saves allies from burst. Goo Ball for engage or escape." },
  { name: "Warden", role: "Tank", lane: "Solo", desc: "Lockdown tank with binding abilities and last stand", abilities: ["Alchemical Flask", "Willpower", "Binding Word", "Last Stand"], tip: "Binding Word combos with team follow-up. Willpower through burst." },
  { name: "Wraith", role: "Carry", lane: "Solo", desc: "Card-throwing burst damage dealer with teleport", abilities: ["Card Trick", "Full Auto", "Project Mind", "Telekinesis"], tip: "Use Project Mind to scout, then teleport for picks." },
  { name: "Yamato", role: "Carry", lane: "Solo", desc: "Samurai duelist with power spike ult and shadow form", abilities: ["Power Slash", "Crimson Slash", "Shadow Transformation", "Flying Strike"], tip: "Shadow Transformation makes you immune. Time it for enemy burst." },
];

const BUILDS: Record<string, { tag: string; early: string[]; mid: string[]; late: string[]; note: string }[]> = {
  Haze: [{ tag: "Burst Assassin", early: ["Headshot Booster", "Melee Lifesteal", "Sprint Boots"], mid: ["Mystic Shot", "Titanic Magazine", "Quicksilver Reload"], late: ["Glass Cannon", "Silencer", "Shadow Weave"], note: "Focus on farming early. Go for picks after Fixation is online." }],
  Abrams: [{ tag: "Frontline Tank", early: ["Extra Health", "Melee Lifesteal", "Healing Rite"], mid: ["Bullet Armor", "Spirit Armor", "Veil Walker"], late: ["Unstoppable", "Leech", "Colossus"], note: "Play aggressive in lane. Use charge to initiate team fights." }],
  Dynamo: [{ tag: "Healer Support", early: ["Extra Spirit", "Healing Rite", "Sprint Boots"], mid: ["Improved Cooldown", "Mystic Reach", "Decay"], late: ["Refresher", "Diviner's Kevlar", "Ethereal Shift"], note: "Stay behind your tank. Save ult for multi-man team fights." }],
  Seven: [{ tag: "Lightning Carry", early: ["Extra Spirit", "Mystic Burst", "Sprint Boots"], mid: ["Improved Spirit", "Torment Pulse", "Mystic Reach"], late: ["Escalating Exposure", "Refresher", "Boundless Spirit"], note: "Stack Static Charge on creeps. Position safely for Storm Cloud." }],
};

const ROLE_ICON = {
  Tank: Shield,
  Carry: Sword,
  Support: Heart,
};

const ABILITY_KEYS = ["LMB", "Q", "E", "R"];

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button className="dl-copy-btn" onClick={handleCopy} title={`Copy ${label}`}>
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

export default function DeadlockChannel() {
  const [selectedHero, setSelectedHero] = useState<Hero>(HEROES[4]); // Haze default
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const roles = ["Tank", "Carry", "Support"] as const;

  const filtered = useMemo(
    () => (roleFilter ? HEROES.filter((h) => h.role === roleFilter) : HEROES),
    [roleFilter],
  );

  const heroBuilds = BUILDS[selectedHero.name] || [];
  const RoleIcon = ROLE_ICON[selectedHero.role];

  return (
    <div className="dl-page">
      {/* ── Toolbar ── */}
      <div className="dl-toolbar">
        <div className="dl-toolbar-left">
          <img src={deadlockLogo} alt="" className="dl-toolbar-logo" />
          <span className="dl-toolbar-title">DEADLOCK</span>
          <span className="dl-toolbar-sep" />
          <span className="dl-toolbar-sub">HERO DATABASE</span>
        </div>
        <div className="dl-toolbar-filters">
          <button
            className={`dl-filter-btn ${roleFilter === null ? "dl-filter-active" : ""}`}
            onClick={() => setRoleFilter(null)}
          >All ({HEROES.length})</button>
          {roles.map((r) => (
            <button
              key={r}
              className={`dl-filter-btn dl-filter-${r.toLowerCase()} ${roleFilter === r ? "dl-filter-active" : ""}`}
              onClick={() => setRoleFilter(r)}
            >{r}</button>
          ))}
        </div>
      </div>

      {/* ── Two-panel body ── */}
      <div className="dl-panels">
        {/* Left: hero grid */}
        <div className="dl-grid-panel">
          <div className="dl-hero-grid">
            {filtered.map((hero) => {
              const Icon = ROLE_ICON[hero.role];
              const isActive = selectedHero.name === hero.name;
              return (
                <button
                  key={hero.name}
                  className={`dl-hero-tile ${isActive ? "dl-hero-tile-active" : ""} dl-tile-${hero.role.toLowerCase()}`}
                  onClick={() => setSelectedHero(hero)}
                >
                  <div className="dl-tile-icon">
                    <Icon size={18} />
                  </div>
                  <div className="dl-tile-info">
                    <span className="dl-tile-name">{hero.name}</span>
                    <span className="dl-tile-meta">{hero.role} · {hero.lane}</span>
                  </div>
                  <ChevronRight size={14} className="dl-tile-arrow" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: hero detail */}
        <div className={`dl-detail-panel dl-detail-${selectedHero.role.toLowerCase()}`}>
          <div className="dl-detail-scroll">
            {/* Hero header */}
            <div className="dl-detail-header">
              <div className="dl-detail-watermark" aria-hidden="true">{selectedHero.name[0]}</div>
              <div className="dl-detail-role-badge">
                <RoleIcon size={14} />
                <span>{selectedHero.role}</span>
              </div>
              <h1 className="dl-detail-name">{selectedHero.name}</h1>
              <div className="dl-detail-lane">{selectedHero.lane} Lane</div>
              <p className="dl-detail-desc">{selectedHero.desc}</p>
            </div>

            {/* Abilities */}
            <div className="dl-detail-section">
              <h2 className="dl-detail-section-title">Abilities</h2>
              <div className="dl-ability-grid">
                {selectedHero.abilities.map((ability, i) => (
                  <div key={ability} className="dl-ability-card">
                    <div className="dl-ability-key-box">{ABILITY_KEYS[i]}</div>
                    <div className="dl-ability-card-info">
                      <span className="dl-ability-card-name">{ability}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Strategy */}
            <div className="dl-detail-section">
              <h2 className="dl-detail-section-title">Strategy</h2>
              <div className="dl-strategy-box">
                <p>{selectedHero.tip}</p>
              </div>
            </div>

            {/* Builds */}
            {heroBuilds.length > 0 && (
              <div className="dl-detail-section">
                <h2 className="dl-detail-section-title">Recommended Build</h2>
                {heroBuilds.map((build) => (
                  <div key={build.tag} className="dl-build-card">
                    <div className="dl-build-tag">{build.tag}</div>
                    <div className="dl-build-phases">
                      <div className="dl-build-phase">
                        <span className="dl-phase-dot dl-phase-early" />
                        <span className="dl-phase-label">Early</span>
                        <div className="dl-phase-items">
                          {build.early.map((item) => (
                            <span key={item} className="dl-item">{item}</span>
                          ))}
                        </div>
                      </div>
                      <div className="dl-build-phase">
                        <span className="dl-phase-dot dl-phase-mid" />
                        <span className="dl-phase-label">Mid</span>
                        <div className="dl-phase-items">
                          {build.mid.map((item) => (
                            <span key={item} className="dl-item">{item}</span>
                          ))}
                        </div>
                      </div>
                      <div className="dl-build-phase">
                        <span className="dl-phase-dot dl-phase-late" />
                        <span className="dl-phase-label">Late</span>
                        <div className="dl-phase-items">
                          {build.late.map((item) => (
                            <span key={item} className="dl-item">{item}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="dl-build-note">{build.note}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Quick copy */}
            <div className="dl-detail-section">
              <CopyText text={selectedHero.name} label="Copy hero name" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
