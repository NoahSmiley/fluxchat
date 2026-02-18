import { useState, useEffect, useCallback } from "react";
import { useChatStore } from "../stores/chat.js";
import { useAuthStore } from "../stores/auth.js";
import { Crosshair, Trophy, TrendingUp, Users, Star, Swords, Map as MapIcon, Copy, Check, Globe, Waves, Search, ExternalLink, Settings } from "lucide-react";
import { useUIStore } from "../stores/ui.js";
import { avatarColor } from "../lib/avatarColor.js";

// ── CS2 Shield Logo SVG ──
function CS2Logo({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <defs>
        <linearGradient id="cs2grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#de9b35" />
          <stop offset="100%" stopColor="#b8781e" />
        </linearGradient>
      </defs>
      <path
        d="M50 5 L90 25 L90 55 Q90 80 50 95 Q10 80 10 55 L10 25 Z"
        fill="url(#cs2grad)"
        stroke="#f5c563"
        strokeWidth="2"
      />
      <text x="50" y="62" textAnchor="middle" fontSize="38" fontWeight="900" fill="#1a1a1a" fontFamily="Arial Black, sans-serif">
        2
      </text>
    </svg>
  );
}

// ── Crosshair Preview SVG ──
function CrosshairPreview({ color, size: s, gap, thickness, dot }: {
  color: string; size: number; gap: number; thickness: number; dot: boolean;
}) {
  const cx = 40, cy = 40;
  return (
    <svg width={80} height={80} viewBox="0 0 80 80" className="gc-crosshair-svg">
      <rect x={0} y={0} width={80} height={80} rx={8} fill="rgba(0,0,0,0.5)" />
      {/* top */}
      <rect x={cx - thickness / 2} y={cy - gap - s} width={thickness} height={s} fill={color} />
      {/* bottom */}
      <rect x={cx - thickness / 2} y={cy + gap} width={thickness} height={s} fill={color} />
      {/* left */}
      <rect x={cx - gap - s} y={cy - thickness / 2} width={s} height={thickness} fill={color} />
      {/* right */}
      <rect x={cx + gap} y={cy - thickness / 2} width={s} height={thickness} fill={color} />
      {dot && <circle cx={cx} cy={cy} r={thickness / 2} fill={color} />}
    </svg>
  );
}

// ── Copy button with feedback ──
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button className={`gc-copy-btn ${copied ? "copied" : ""}`} onClick={handleCopy} title="Copy to clipboard">
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {label ?? (copied ? "Copied!" : "Copy")}
    </button>
  );
}

// ── Leetify API types ──
interface LeetifyRatings {
  aim: number;
  positioning: number;
  utility: number;
  leetify: number;
  ctLeetify: number;
  tLeetify: number;
  opening: number;
  clutch: number;
}

interface LeetifyGame {
  gameFinishedAt: string;
  skillLevel: number | null;
  matchResult: string;
  mapName?: string;
  kills?: number;
  deaths?: number;
}

interface LeetifyProfile {
  recentGameRatings: LeetifyRatings;
  games: LeetifyGame[];
  steamNickname?: string;
}

const MOCK_NEWS = [
  { id: 1, title: "Operation Overdrive Now Live", desc: "New cases, missions, and the return of classic maps.", date: "Feb 14, 2026" },
  { id: 2, title: "Map Pool Update: Season 15", desc: "Vertigo removed, Train returns to Active Duty.", date: "Feb 10, 2026" },
  { id: 3, title: "Balance Patch 1.40.2", desc: "M4A1-S rate of fire increased. AK-47 first-shot accuracy improved.", date: "Feb 7, 2026" },
];

// ── Pro Crosshairs Data ──
const PRO_CROSSHAIRS = [
  { name: "s1mple", team: "NAVI", code: "CSGO-m58cB-AyBDC-AV6tp-Gwq2K-QGKeB", color: "#00ffff", size: 10, gap: 3, thickness: 2, dot: true, desc: "Cyan dot crosshair" },
  { name: "ZywOo", team: "Vitality", code: "CSGO-Os4Wd-wVikQ-bAPFj-5baaP-YhQXG", color: "#00ff00", size: 8, gap: 3, thickness: 1.5, dot: false, desc: "Small green classic" },
  { name: "m0NESY", team: "G2", code: "CSGO-wAD3c-ykt5L-zvZ98-vBisR-6sWPA", color: "#00ff00", size: 9, gap: 3, thickness: 1.5, dot: false, desc: "Compact green" },
  { name: "donk", team: "Spirit", code: "CSGO-YaywQ-JMjpG-RA64A-HyG2r-QT43L", color: "#ffffff", size: 8, gap: 2, thickness: 1.5, dot: false, desc: "White minimal" },
  { name: "NiKo", team: "G2", code: "CSGO-fHfcZ-kYmFD-JTPnU-O2aCJ-nzXaF", color: "#00ff00", size: 10, gap: 3, thickness: 2, dot: false, desc: "Green medium" },
  { name: "dev1ce", team: "Astralis", code: "CSGO-wtG7o-YzmoS-Xxpua-jn2Xo-PsSyL", color: "#00ff00", size: 9, gap: 3, thickness: 1, dot: false, desc: "Thin green" },
  { name: "frozen", team: "MOUZ", code: "CSGO-CXpf5-F6PEn-dprUp-JzNQa-aBu2M", color: "#00ff00", size: 5, gap: 2, thickness: 1, dot: true, desc: "Tiny green dot" },
  { name: "ropz", team: "FaZe", code: "CSGO-XrDOx-O74Yt-AYbxH-sD3OQ-jRMUP", color: "#00ff00", size: 9, gap: 3, thickness: 2, dot: false, desc: "Classic green" },
];

// ── Surf Maps & Servers ──
const SURF_MAPS = [
  { name: "surf_mesa", difficulty: "Beginner", tier: "T1", desc: "Classic intro surf map with smooth ramps" },
  { name: "surf_beginner", difficulty: "Beginner", tier: "T1", desc: "Perfect for learning the basics of surfing" },
  { name: "surf_utopia_v3", difficulty: "Intermediate", tier: "T3", desc: "Beautiful scenery with challenging stages" },
  { name: "surf_kitsune", difficulty: "Intermediate", tier: "T3", desc: "Japanese-themed map with flowing ramps" },
  { name: "surf_greatriver_v2", difficulty: "Advanced", tier: "T4", desc: "Long, technical map for experienced surfers" },
  { name: "surf_forbidden_ways", difficulty: "Advanced", tier: "T5", desc: "One of the most challenging surf maps" },
  { name: "surf_lt_omnific", difficulty: "Expert", tier: "T6", desc: "Elite-tier map requiring precise air control" },
];

const SURF_SERVERS = [
  { name: "KZG Surf", region: "NA", ip: "surf.kzg.gg", players: "32/64", ping: "~25ms", desc: "Killzone Gaming — Largest surf community" },
  { name: "Cybershoke Surf", region: "EU", ip: "cybershoke.net", players: "48/64", ping: "~15ms", desc: "60+ servers categorized by difficulty" },
  { name: "Xplay Surf", region: "EU", ip: "xplay.gg", players: "24/32", ping: "~20ms", desc: "Skill-focused surf with progression" },
  { name: "Insanity Gaming", region: "NA", ip: "insanity.gg", players: "16/32", ping: "~30ms", desc: "Low latency, active moderation" },
  { name: "Flow State", region: "NA", ip: "flowstate.gg", players: "20/32", ping: "~28ms", desc: "Flow training modes for learning" },
];

type Tab = "team" | "crosshairs" | "surf";

// ── Per-member Leetify cache ──
const leetifyCache = new Map<string, { data: LeetifyProfile | null; fetched: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

async function fetchLeetifyProfile(steamId: string): Promise<LeetifyProfile | null> {
  const cached = leetifyCache.get(steamId);
  if (cached && Date.now() - cached.fetched < CACHE_TTL) return cached.data;
  try {
    const resp = await fetch(`https://api.leetify.com/api/profile/${steamId}`);
    if (!resp.ok) { leetifyCache.set(steamId, { data: null, fetched: Date.now() }); return null; }
    const data = await resp.json();
    leetifyCache.set(steamId, { data, fetched: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// ── Main Component ──
export function GameChannelView() {
  const { members, onlineUsers, userStatuses, userActivities } = useChatStore();
  const { user } = useAuthStore();
  const { openSettings } = useUIStore();
  const [activeTab, setActiveTab] = useState<Tab>("team");

  // Auto-load user's own Leetify data from their linked Steam ID
  const [myLeetify, setMyLeetify] = useState<LeetifyProfile | null>(null);
  const [myLoading, setMyLoading] = useState(false);

  // Team members' Leetify data
  const [teamLeetify, setTeamLeetify] = useState<Record<string, LeetifyProfile | null>>({});
  const [teamLoading, setTeamLoading] = useState(false);

  // Fetch own stats
  useEffect(() => {
    if (!user?.steamId) { setMyLeetify(null); return; }
    setMyLoading(true);
    fetchLeetifyProfile(user.steamId).then((d) => { setMyLeetify(d); setMyLoading(false); });
  }, [user?.steamId]);

  // Fetch team stats
  useEffect(() => {
    const linkedMembers = members.filter((m) => m.steamId && m.userId !== user?.id);
    if (linkedMembers.length === 0) { setTeamLeetify({}); return; }
    setTeamLoading(true);
    Promise.all(
      linkedMembers.map(async (m) => {
        const data = await fetchLeetifyProfile(m.steamId!);
        return [m.userId, data] as const;
      })
    ).then((results) => {
      const map: Record<string, LeetifyProfile | null> = {};
      for (const [uid, data] of results) map[uid] = data;
      setTeamLeetify(map);
      setTeamLoading(false);
    });
  }, [members, user?.id]);

  const isLinked = !!user?.steamId;

  return (
    <div className="game-channel">
      {/* Hero Header */}
      <div className="gc-hero">
        <div className="gc-hero-bg" />
        <div className="gc-hero-content">
          <CS2Logo size={52} />
          <div className="gc-hero-text">
            <h1>COUNTER-STRIKE 2</h1>
          </div>
          <div className="gc-tabs">
            {([["team", "Team"], ["crosshairs", "Crosshairs"], ["surf", "Surf"]] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                className={`gc-tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="game-channel-scroll">
        <div className="gc-body">
          {activeTab === "team" && (
            <TeamTab
              user={user}
              isLinked={isLinked}
              myLeetify={myLeetify}
              myLoading={myLoading}
              members={members}
              onlineUsers={onlineUsers}
              userActivities={userActivities}
              teamLeetify={teamLeetify}
              teamLoading={teamLoading}
              openSettings={openSettings}
            />
          )}
          {activeTab === "crosshairs" && <CrosshairsTab />}
          {activeTab === "surf" && <SurfTab />}
        </div>
      </div>
    </div>
  );
}

// ── Team Tab ──
function TeamTab({ user, isLinked, myLeetify, myLoading, members, onlineUsers, userActivities, teamLeetify, teamLoading, openSettings }: {
  user: any;
  isLinked: boolean;
  myLeetify: LeetifyProfile | null;
  myLoading: boolean;
  members: any[];
  onlineUsers: Set<string>;
  userActivities: Record<string, any>;
  teamLeetify: Record<string, LeetifyProfile | null>;
  teamLoading: boolean;
  openSettings: () => void;
}) {
  const ratings = myLeetify?.recentGameRatings;
  const linkedMembers = members.filter((m: any) => m.steamId && m.userId !== user?.id);
  const playingCS2 = members.filter((m: any) => {
    const activity = userActivities[m.userId];
    return activity && activity.name === "Counter-Strike 2";
  });

  return (
    <>
      {/* Link prompt */}
      {!isLinked && (
        <section className="gc-section gc-link-prompt">
          <div className="gc-link-card">
            <Search size={20} />
            <div>
              <div className="gc-link-title">Link your Steam ID</div>
              <div className="gc-link-desc">Connect your Steam account in Settings to see your Leetify stats and compare with teammates.</div>
            </div>
            <button className="gc-btn-play gc-btn-sm" onClick={openSettings}>
              <Settings size={14} /> Open Settings
            </button>
          </div>
        </section>
      )}

      {/* Team members playing CS2 right now */}
      {playingCS2.length > 0 && (
        <section className="gc-section">
          <h2 className="gc-section-title">
            <Users size={16} />
            Playing Now
          </h2>
          <div className="gc-team-playing">
            {playingCS2.map((m: any) => (
              <div key={m.userId} className="gc-team-member-live">
                <span className="gc-team-avatar" style={{ background: avatarColor(m.username) }}>
                  {m.image ? <img src={m.image} alt={m.username} /> : m.username.charAt(0).toUpperCase()}
                </span>
                <div className="gc-team-member-info">
                  <span className="gc-team-member-name">{m.username}</span>
                  <span className="gc-team-member-status">Playing CS2</span>
                </div>
                <span className="gc-live-dot" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* My Stats */}
      {isLinked && (
        <section className="gc-section">
          <h2 className="gc-section-title">
            <Trophy size={16} />
            Your Performance
            {myLeetify?.steamNickname && <span className="gc-player-name">{myLeetify.steamNickname}</span>}
          </h2>
          {myLoading ? (
            <div className="gc-loading">Loading your stats...</div>
          ) : ratings ? (
            <div className="gc-ratings-grid">
              {[
                { label: "Leetify Rating", value: ratings.leetify, color: "#f5c563" },
                { label: "Aim", value: ratings.aim, color: "#e06c75" },
                { label: "Positioning", value: ratings.positioning, color: "#61afef" },
                { label: "Utility", value: ratings.utility, color: "#98c379" },
                { label: "Opening Duels", value: ratings.opening, color: "#c678dd" },
                { label: "Clutch", value: ratings.clutch, color: "#d19a66" },
                { label: "CT Side", value: ratings.ctLeetify, color: "#56b6c2" },
                { label: "T Side", value: ratings.tLeetify, color: "#e5c07b" },
              ].map((r) => (
                <div key={r.label} className="gc-rating-bar">
                  <div className="gc-rating-header">
                    <span className="gc-rating-label">{r.label}</span>
                    <span className="gc-rating-value" style={{ color: r.color }}>{r.value.toFixed(1)}</span>
                  </div>
                  <div className="gc-rating-track">
                    <div className="gc-rating-fill" style={{ width: `${Math.min(100, r.value)}%`, background: r.color }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="gc-error">Could not load Leetify data. Make sure your profile is public.</div>
          )}
        </section>
      )}

      {/* Recent Matches */}
      {myLeetify && myLeetify.games.length > 0 && (
        <section className="gc-section">
          <h2 className="gc-section-title">
            <Swords size={16} />
            Recent Matches
          </h2>
          <div className="gc-matches">
            {myLeetify.games.slice(0, 8).map((g, i) => (
              <div key={i} className={`gc-match gc-match-${g.matchResult}`}>
                <div className={`gc-match-result ${g.matchResult === "win" ? "win" : g.matchResult === "loss" ? "loss" : "draw"}`}>
                  {g.matchResult === "win" ? "W" : g.matchResult === "loss" ? "L" : "D"}
                </div>
                <div className="gc-match-map">
                  <MapIcon size={13} />
                  {g.mapName ?? "Unknown"}
                </div>
                <div className="gc-match-score">{g.skillLevel != null ? `Elo ${g.skillLevel.toLocaleString()}` : "—"}</div>
                <div className="gc-match-kd">
                  <span className="gc-match-kills">{g.kills ?? 0}</span>/<span className="gc-match-deaths">{g.deaths ?? 0}</span>
                </div>
                <div className="gc-match-ago">{new Date(g.gameFinishedAt).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Team Comparison */}
      {linkedMembers.length > 0 && (
        <section className="gc-section">
          <h2 className="gc-section-title">
            <Users size={16} />
            Team Stats
          </h2>
          {teamLoading ? (
            <div className="gc-loading">Loading team stats...</div>
          ) : (
            <div className="gc-team-grid">
              {linkedMembers.map((m: any) => {
                const data = teamLeetify[m.userId];
                const r = data?.recentGameRatings;
                const isOnline = onlineUsers.has(m.userId);
                return (
                  <div key={m.userId} className={`gc-team-card ${isOnline ? "" : "offline"}`}>
                    <div className="gc-team-card-header">
                      <span className="gc-team-avatar" style={{ background: avatarColor(m.username) }}>
                        {m.image ? <img src={m.image} alt={m.username} /> : m.username.charAt(0).toUpperCase()}
                      </span>
                      <div>
                        <div className="gc-team-card-name">{data?.steamNickname ?? m.username}</div>
                        <div className="gc-team-card-sub">{isOnline ? "Online" : "Offline"}</div>
                      </div>
                    </div>
                    {r ? (
                      <div className="gc-team-card-stats">
                        <div className="gc-team-stat">
                          <span className="gc-team-stat-val" style={{ color: "#f5c563" }}>{r.leetify.toFixed(1)}</span>
                          <span className="gc-team-stat-lbl">Rating</span>
                        </div>
                        <div className="gc-team-stat">
                          <span className="gc-team-stat-val" style={{ color: "#e06c75" }}>{r.aim.toFixed(1)}</span>
                          <span className="gc-team-stat-lbl">Aim</span>
                        </div>
                        <div className="gc-team-stat">
                          <span className="gc-team-stat-val" style={{ color: "#61afef" }}>{r.positioning.toFixed(1)}</span>
                          <span className="gc-team-stat-lbl">Pos.</span>
                        </div>
                        <div className="gc-team-stat">
                          <span className="gc-team-stat-val" style={{ color: "#98c379" }}>{r.utility.toFixed(1)}</span>
                          <span className="gc-team-stat-lbl">Util</span>
                        </div>
                      </div>
                    ) : (
                      <div className="gc-team-card-no-data">No Leetify data</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* News */}
      <section className="gc-section">
        <h2 className="gc-section-title">
          <TrendingUp size={16} />
          News & Updates
        </h2>
        <div className="gc-news">
          {MOCK_NEWS.map((n) => (
            <div key={n.id} className="gc-news-item">
              <div className="gc-news-date">{n.date}</div>
              <div className="gc-news-title">{n.title}</div>
              <div className="gc-news-desc">{n.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ── Crosshairs Tab ──
function CrosshairsTab() {
  return (
    <>
      <section className="gc-section">
        <h2 className="gc-section-title">
          <Crosshair size={16} />
          Pro Player Crosshairs
        </h2>
        <p className="gc-section-desc">Copy a crosshair code, then paste it in CS2: Settings → Crosshair → Share or Import</p>
        <div className="gc-crosshairs-grid">
          {PRO_CROSSHAIRS.map((ch) => (
            <div key={ch.name} className="gc-crosshair-card">
              <div className="gc-crosshair-preview">
                <CrosshairPreview color={ch.color} size={ch.size} gap={ch.gap} thickness={ch.thickness} dot={ch.dot} />
              </div>
              <div className="gc-crosshair-info">
                <div className="gc-crosshair-player">
                  <span className="gc-crosshair-name">{ch.name}</span>
                  <span className="gc-crosshair-team">{ch.team}</span>
                </div>
                <div className="gc-crosshair-desc">{ch.desc}</div>
                <div className="gc-crosshair-code">
                  <code>{ch.code}</code>
                  <CopyButton text={ch.code} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ── Surf Tab ──
function SurfTab() {
  return (
    <>
      {/* Surf Servers */}
      <section className="gc-section">
        <h2 className="gc-section-title">
          <Globe size={16} />
          Community Surf Servers
        </h2>
        <div className="gc-surf-servers">
          {SURF_SERVERS.map((s) => (
            <div key={s.name} className="gc-surf-server">
              <div className="gc-surf-server-main">
                <div className="gc-surf-server-name">{s.name}</div>
                <div className="gc-surf-server-desc">{s.desc}</div>
              </div>
              <div className="gc-surf-server-meta">
                <span className="gc-surf-region">{s.region}</span>
                <span className="gc-surf-players">{s.players}</span>
                <span className="gc-surf-ping">{s.ping}</span>
              </div>
              <CopyButton text={`connect ${s.ip}`} label="Connect" />
            </div>
          ))}
        </div>
      </section>

      {/* Surf Maps */}
      <section className="gc-section">
        <h2 className="gc-section-title">
          <Waves size={16} />
          Popular Surf Maps
        </h2>
        <div className="gc-surf-maps">
          {SURF_MAPS.map((m) => (
            <div key={m.name} className="gc-surf-map">
              <div className="gc-surf-map-header">
                <span className="gc-surf-map-name">{m.name}</span>
                <span className={`gc-surf-tier gc-tier-${m.tier.toLowerCase()}`}>{m.tier}</span>
                <span className={`gc-surf-diff gc-diff-${m.difficulty.toLowerCase()}`}>{m.difficulty}</span>
              </div>
              <div className="gc-surf-map-desc">{m.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
