import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, Coins, Package, Backpack, Store, Hammer, Eye } from "lucide-react";
import { useEconomyStore } from "../stores/economy.js";
import { useAuthStore } from "../stores/auth.js";
import type { CaseInfo, CaseDetail, CaseItem, CaseOpenResult, InventoryItem, ItemRarity, MarketplaceListing } from "../types/shared.js";
import { RARITY_COLORS as COLORS, RARITY_ORDER } from "../types/shared.js";
import { ItemPreview } from "./items/ItemPreview.js";
import { ItemViewer3D } from "./items/ItemViewer3D.js";
import { seedToPattern, type DopplerType } from "./items/dopplerPattern.js";

const CASE_THEMES: Record<string, { primary: string; secondary: string; accent: string; glow: string }> = {
  case_standard: { primary: "#4b69ff", secondary: "#3a54cc", accent: "#6b8aff", glow: "#4b69ff" },
  case_premium:  { primary: "#d32ee6", secondary: "#a024b3", accent: "#e96bfa", glow: "#d32ee6" },
  case_founders: { primary: "#f5c563", secondary: "#d4a032", accent: "#ffe08a", glow: "#f5c563" },
};

function CaseIllustration({ caseId, size = 80 }: { caseId: string; size?: number }) {
  const theme = CASE_THEMES[caseId] ?? CASE_THEMES.case_standard;
  const id = `cg-${caseId}`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={theme.primary} />
          <stop offset="100%" stopColor={theme.secondary} />
        </linearGradient>
        <linearGradient id={`${id}-lid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.accent} />
          <stop offset="100%" stopColor={theme.primary} />
        </linearGradient>
        <filter id={`${id}-glow`}><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {/* Glow behind */}
      <ellipse cx="60" cy="100" rx="36" ry="8" fill={theme.glow} opacity="0.25" filter={`url(#${id}-glow)`} />
      {/* Box body */}
      <rect x="22" y="48" width="76" height="50" rx="6" fill={`url(#${id}-body)`} opacity="0.9" />
      {/* Metal edge trim */}
      <rect x="22" y="48" width="76" height="4" rx="2" fill={theme.accent} opacity="0.5" />
      {/* Lock plate */}
      <rect x="50" y="62" width="20" height="14" rx="3" fill="rgba(0,0,0,0.35)" />
      <circle cx="60" cy="69" r="3" fill={theme.accent} opacity="0.8" />
      {/* Lid — slightly raised */}
      <path d="M20 50 L24 26 Q26 22 30 22 L90 22 Q94 22 96 26 L100 50 Z" fill={`url(#${id}-lid)`} opacity="0.95" />
      {/* Lid highlight */}
      <path d="M30 26 L90 26" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" />
      {/* Side accents */}
      <rect x="30" y="54" width="2" height="38" rx="1" fill="rgba(255,255,255,0.12)" />
      <rect x="88" y="54" width="2" height="38" rx="1" fill="rgba(255,255,255,0.12)" />
      {/* Star / emblem based on tier */}
      {caseId === "case_founders" && (
        <polygon points="60,30 63,39 73,39 65,45 68,54 60,48 52,54 55,45 47,39 57,39" fill="#1a1a1a" opacity="0.5" />
      )}
      {caseId === "case_premium" && (
        <path d="M54 34 L60 28 L66 34 L60 40 Z" fill="rgba(255,255,255,0.35)" />
      )}
      {caseId === "case_standard" && (
        <circle cx="60" cy="36" r="6" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
      )}
    </svg>
  );
}

function rarityLabel(r: ItemRarity) {
  return r === "ultra_rare" ? "Ultra Rare" : r.charAt(0).toUpperCase() + r.slice(1);
}

function rarityGlow(r: ItemRarity) {
  return COLORS[r] ?? "#888";
}

function typeLabel(type: string) {
  return type.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const REEL_ITEM_WIDTH = 140;
const TOTAL_REEL_ITEMS = 60;

function CaseReel({ caseDetail, wonItem, spinning, onFinish }: {
  caseDetail: CaseDetail;
  wonItem: CaseOpenResult | null;
  spinning: boolean;
  onFinish: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [reelItems, setReelItems] = useState<CaseItem[]>([]);
  const [landed, setLanded] = useState(false);
  const winIndex = useRef(45);

  useEffect(() => {
    if (!spinning || !wonItem || caseDetail.items.length === 0) return;

    const items = caseDetail.items;
    const strip: CaseItem[] = [];
    const totalWeight = items.reduce((s, i) => s + i.weight, 0);

    function pickRandom(): CaseItem {
      let roll = Math.random() * totalWeight;
      for (const item of items) {
        roll -= item.weight;
        if (roll <= 0) return item;
      }
      return items[items.length - 1];
    }

    for (let i = 0; i < TOTAL_REEL_ITEMS; i++) strip.push(pickRandom());

    const wonCaseItem = items.find(i => i.catalogItemId === wonItem.catalogItemId);
    if (wonCaseItem) strip[winIndex.current] = wonCaseItem;

    setReelItems(strip);
    setLanded(false);
  }, [spinning, wonItem, caseDetail.items]);

  useEffect(() => {
    if (!spinning || reelItems.length === 0 || !stripRef.current || !containerRef.current) return;

    const strip = stripRef.current;
    const containerWidth = containerRef.current.offsetWidth;
    const centerOffset = containerWidth / 2 - REEL_ITEM_WIDTH / 2;
    const jitter = (Math.random() - 0.5) * (REEL_ITEM_WIDTH * 0.4);
    const targetX = winIndex.current * REEL_ITEM_WIDTH - centerOffset + jitter;

    strip.style.transition = "none";
    strip.style.transform = "translateX(0px)";
    strip.offsetHeight; // force reflow
    strip.style.transition = "transform 5s cubic-bezier(0.15, 0.85, 0.25, 1)";
    strip.style.transform = `translateX(-${targetX}px)`;

    const timer = setTimeout(() => { setLanded(true); onFinish(); }, 5200);
    return () => clearTimeout(timer);
  }, [reelItems, spinning, onFinish]);

  if (reelItems.length === 0) return null;

  return (
    <div className="case-reel-wrapper">
      <div className="case-reel-marker" />
      <div className="case-reel-marker-bottom" />
      <div className="case-reel-container" ref={containerRef}>
        <div className="case-reel-strip" ref={stripRef}>
          {reelItems.map((item, i) => (
            <div
              key={i}
              className={`case-reel-item ${landed && i === winIndex.current ? "winner" : ""}`}
              style={{ borderBottomColor: rarityGlow(item.rarity) }}
            >
              <div className="case-reel-item-icon">
                <ItemPreview type={item.type} rarity={item.rarity} previewCss={item.previewCss} cardSeries={item.cardSeries} cardNumber={item.cardNumber} isHolographic={item.isHolographic ?? false} size="sm" />
              </div>
              <div className="case-reel-item-name">{item.name}</div>
              <div className="case-reel-item-rarity" style={{ color: rarityGlow(item.rarity) }}>
                {rarityLabel(item.rarity)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WinReveal({ item, onClose }: { item: CaseOpenResult; onClose: () => void }) {
  const color = rarityGlow(item.rarity);
  const canInspect3D = item.type === "ring_style" || item.type === "trading_card" || item.type === "profile_banner";

  return (
    <div className="case-win-reveal" onClick={onClose}>
      <div className="case-win-glow" style={{ background: `radial-gradient(circle, ${color}40 0%, transparent 70%)` }} />
      <div className={`case-win-card ${canInspect3D ? "case-win-card-3d" : ""}`} style={{ borderColor: color }} onClick={(e) => e.stopPropagation()}>
        {canInspect3D ? (
          <ItemViewer3D
            name={item.name}
            rarity={item.rarity}
            type={item.type}
            previewCss={item.previewCss}
            cardSeries={item.cardSeries}
            cardNumber={item.cardNumber}
            isHolographic={item.isHolographic ?? false}
            patternSeed={item.patternSeed}
            onClose={onClose}
          />
        ) : (
          <>
            <div className="case-win-icon">
              <ItemPreview type={item.type} rarity={item.rarity} previewCss={item.previewCss} cardSeries={item.cardSeries} cardNumber={item.cardNumber} isHolographic={item.isHolographic ?? false} patternSeed={item.patternSeed} size="lg" />
            </div>
            <h2 className="case-win-name" style={{ color }}>{item.name}</h2>
            <div className="case-win-rarity" style={{ color }}>{rarityLabel(item.rarity)}</div>
            <div className="case-win-type">{typeLabel(item.type)}</div>
            <button className="case-win-close-btn" onClick={onClose}>Continue</button>
          </>
        )}
      </div>
    </div>
  );
}

function CasesTab() {
  const { wallet, cases, caseDetail, casesLoading, fetchCases, fetchCaseDetail, openCase, fetchWallet } = useEconomyStore();
  const [view, setView] = useState<"list" | "detail" | "opening">("list");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [wonItem, setWonItem] = useState<CaseOpenResult | null>(null);
  const [showWin, setShowWin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  function handleSelectCase(c: CaseInfo) {
    setSelectedCaseId(c.id);
    fetchCaseDetail(c.id);
    setView("detail");
    setError(null);
  }

  function handleBack() {
    setView("list"); setSelectedCaseId(null); setWonItem(null);
    setShowWin(false); setSpinning(false); setError(null);
  }

  async function handleOpenCase() {
    if (!selectedCaseId || spinning) return;
    setError(null);
    try {
      const result = await openCase(selectedCaseId);
      setWonItem(result);
      setView("opening");
      setSpinning(true);
    } catch (err: any) {
      setError(err?.message ?? "Failed to open case");
    }
  }

  const handleReelFinish = useCallback(() => {
    setSpinning(false);
    useEconomyStore.setState({ suppressOwnDrops: false });
    setTimeout(() => setShowWin(true), 600);
  }, []);

  function handleWinClose() {
    setShowWin(false); setWonItem(null); setView("detail"); fetchWallet();
  }

  const selectedCase = cases.find(c => c.id === selectedCaseId);

  return (
    <>
      {view !== "list" && (
        <button className="case-back-btn" onClick={handleBack} style={{ marginBottom: 12 }}>
          <ChevronLeft size={16} /> <span style={{ fontSize: 13 }}>Back to cases</span>
        </button>
      )}

      {view === "list" && (
        <div className="case-list">
          {casesLoading && cases.length === 0 ? (
            <div className="case-loading">Loading cases...</div>
          ) : cases.length === 0 ? (
            <div className="case-loading">No cases available</div>
          ) : cases.map((c) => (
            <button key={c.id} className="case-card" onClick={() => handleSelectCase(c)}>
              <div className="case-card-icon"><CaseIllustration caseId={c.id} size={80} /></div>
              <div className="case-card-name">{c.name}</div>
              <div className="case-card-price"><Coins size={12} /><span>{c.price}</span></div>
            </button>
          ))}
        </div>
      )}

      {view === "detail" && (casesLoading && !caseDetail ? (
        <div className="case-loading">Loading case...</div>
      ) : caseDetail ? (
        <div className="case-detail">
          <div className="case-detail-header">
            <div className="case-detail-icon"><CaseIllustration caseId={caseDetail.id} size={72} /></div>
            <div className="case-detail-info">
              <h3>{caseDetail.name}</h3>
              <div className="case-detail-price"><Coins size={14} /><span>{caseDetail.price} coins</span></div>
            </div>
            <button
              className="case-open-btn"
              onClick={handleOpenCase}
              disabled={spinning || (wallet?.balance ?? 0) < caseDetail.price}
            >
              {(wallet?.balance ?? 0) < caseDetail.price ? "Not enough coins" : "Open Case"}
            </button>
          </div>
          {error && <div className="case-error">{error}</div>}
          <div className="case-contents-label">Possible Items</div>
          <div className="case-contents-grid">
            {caseDetail.items.map((item) => {
              const totalWeight = caseDetail.items.reduce((s, i) => s + i.weight, 0);
              const pct = ((item.weight / totalWeight) * 100).toFixed(1);
              return (
                <div key={item.id} className="case-content-item" style={{ borderLeftColor: rarityGlow(item.rarity) }}>
                  <div className="case-content-item-icon">
                    <ItemPreview type={item.type} rarity={item.rarity} previewCss={item.previewCss} cardSeries={item.cardSeries} cardNumber={item.cardNumber} isHolographic={item.isHolographic ?? false} size="sm" />
                  </div>
                  <div className="case-content-item-info">
                    <div className="case-content-item-name">{item.name}</div>
                    <div className="case-content-item-meta">
                      <span style={{ color: rarityGlow(item.rarity) }}>{rarityLabel(item.rarity)}</span>
                      <span className="case-content-item-pct">{pct}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="case-loading">Failed to load case details.</div>
      ))}

      {view === "opening" && caseDetail && wonItem && (
        <div className="case-opening-view">
          <CaseReel caseDetail={caseDetail} wonItem={wonItem} spinning={spinning} onFinish={handleReelFinish} />
        </div>
      )}

      {showWin && wonItem && <WinReveal item={wonItem} onClose={handleWinClose} />}
    </>
  );
}

function InventoryTab() {
  const { inventory, inventoryLoading, fetchInventory, toggleEquip } = useEconomyStore();
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [rarityFilter, setRarityFilter] = useState<string | null>(null);
  const [viewerItem, setViewerItem] = useState<InventoryItem | null>(null);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  const filtered = inventory.filter(item => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (rarityFilter && item.rarity !== rarityFilter) return false;
    return true;
  });

  const typeOptions: { value: string; label: string }[] = [
    { value: "ring_style", label: "Rings" },
    { value: "name_color", label: "Name Colors" },
    { value: "chat_badge", label: "Badges" },
    { value: "profile_banner", label: "Banners" },
    { value: "message_effect", label: "Effects" },
    { value: "trading_card", label: "Cards" },
  ];

  const canInspect = (type: string) => type === "trading_card" || type === "ring_style" || type === "profile_banner";

  // If viewer is open, show it inline (replaces inventory grid)
  if (viewerItem) {
    return (
      <ItemViewer3D
        name={viewerItem.name}
        rarity={viewerItem.rarity}
        type={viewerItem.type}
        previewCss={viewerItem.previewCss}
        cardSeries={viewerItem.cardSeries}
        cardNumber={viewerItem.cardNumber}
        isHolographic={viewerItem.isHolographic ?? false}
        patternSeed={viewerItem.patternSeed}
        onClose={() => setViewerItem(null)}
      />
    );
  }

  return (
    <div>
      <div className="economy-filter-bar">
        <button
          className={`economy-filter-btn ${!typeFilter ? "active" : ""}`}
          onClick={() => setTypeFilter(null)}
        >All</button>
        {typeOptions.map(t => (
          <button
            key={t.value}
            className={`economy-filter-btn ${typeFilter === t.value ? "active" : ""}`}
            onClick={() => setTypeFilter(typeFilter === t.value ? null : t.value)}
          >{t.label}</button>
        ))}
        <div style={{ flex: 1 }} />
        {RARITY_ORDER.map(r => (
          <button
            key={r}
            className={`economy-filter-btn ${rarityFilter === r ? "active" : ""}`}
            onClick={() => setRarityFilter(rarityFilter === r ? null : r)}
            style={{ borderColor: rarityFilter === r ? rarityGlow(r) : undefined, color: rarityFilter === r ? rarityGlow(r) : undefined }}
          >{rarityLabel(r)}</button>
        ))}
      </div>

      {inventoryLoading && inventory.length === 0 ? (
        <div className="case-loading">Loading inventory...</div>
      ) : filtered.length === 0 ? (
        <div className="case-loading">{inventory.length === 0 ? "Your inventory is empty. Open some cases!" : "No items match the filter."}</div>
      ) : (
        <div className="inventory-grid">
          {filtered.map(item => (
            <div
              key={item.id}
              className={`inventory-item-card ${item.equipped ? "equipped" : ""}`}
            >
              {item.equipped && <div className="item-equipped-badge">Equipped</div>}
              <div className="inventory-item-icon">
                <ItemPreview type={item.type} rarity={item.rarity} previewCss={item.previewCss} cardSeries={item.cardSeries} cardNumber={item.cardNumber} isHolographic={item.isHolographic ?? false} patternSeed={item.patternSeed} size={item.type === "ring_style" ? "xl" : "md"} />
              </div>
              <div className="inventory-item-name">{item.name}</div>
              {(item.type === "ring_style" || item.type === "profile_banner") && item.patternSeed != null && (() => {
                const dt: DopplerType = item.previewCss === "gamma_doppler" ? "gamma_doppler" : "doppler";
                const pat = seedToPattern(item.patternSeed!, dt);
                return <div className={`inventory-item-pattern ${pat.isRare ? "rare" : ""}`}>{pat.patternName}{pat.isRare ? "" : ` #${item.patternSeed}`}</div>;
              })()}
              <div className="inventory-item-rarity" style={{ color: rarityGlow(item.rarity) }}>{rarityLabel(item.rarity)}</div>
              <div className="inventory-item-actions">
                <button
                  className={`inventory-equip-btn ${item.equipped ? "unequip" : ""}`}
                  onClick={() => toggleEquip(item.id)}
                >
                  {item.equipped ? "Unequip" : "Equip"}
                </button>
                {canInspect(item.type) && (
                  <button
                    className="inventory-inspect-btn"
                    onClick={() => setViewerItem(item)}
                    title="Inspect in 3D"
                  >
                    <Eye size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketplaceTab() {
  const { wallet, listings, marketplaceLoading, fetchMarketplace, buyListing, cancelListing, inventory, fetchInventory, createListing } = useEconomyStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [listingItemId, setListingItemId] = useState<string | null>(null);
  const [listingPrice, setListingPrice] = useState("");
  const [showListForm, setShowListForm] = useState(false);

  useEffect(() => { fetchMarketplace({ search: search || undefined, sort }); }, [fetchMarketplace, search, sort]);
  useEffect(() => { if (showListForm) fetchInventory(); }, [showListForm, fetchInventory]);

  async function handleBuy(listing: MarketplaceListing) {
    try {
      await buyListing(listing.id);
    } catch (err: any) {
      alert(err?.message ?? "Purchase failed");
    }
  }

  async function handleCreateListing() {
    if (!listingItemId || !listingPrice) return;
    try {
      await createListing(listingItemId, parseInt(listingPrice));
      setShowListForm(false); setListingItemId(null); setListingPrice("");
    } catch (err: any) {
      alert(err?.message ?? "Failed to list item");
    }
  }

  const unlistedItems = inventory.filter(i => !i.equipped);

  return (
    <div>
      <div className="economy-filter-bar">
        <input
          type="text"
          placeholder="Search items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8,
            padding: "6px 12px", color: "var(--text-primary)", fontSize: 12, width: 180, outline: "none",
          }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          style={{
            background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8,
            padding: "6px 10px", color: "var(--text-primary)", fontSize: 12, outline: "none",
          }}
        >
          <option value="newest">Newest</option>
          <option value="price_asc">Price: Low → High</option>
          <option value="price_desc">Price: High → Low</option>
        </select>
        <div style={{ flex: 1 }} />
        <button
          className="case-open-btn"
          style={{ padding: "6px 16px", fontSize: 12 }}
          onClick={() => setShowListForm(!showListForm)}
        >
          {showListForm ? "Cancel" : "Sell Item"}
        </button>
      </div>

      {showListForm && (
        <div style={{
          background: "var(--bg-tertiary)", borderRadius: 10, padding: 16, marginBottom: 16,
          border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>List an item for sale</div>
          <select
            value={listingItemId ?? ""}
            onChange={(e) => setListingItemId(e.target.value || null)}
            style={{
              background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8,
              padding: "8px 10px", color: "var(--text-primary)", fontSize: 12, outline: "none",
            }}
          >
            <option value="">Select an item...</option>
            {unlistedItems.map(item => (
              <option key={item.id} value={item.id}>{item.name} ({rarityLabel(item.rarity)})</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min={1}
              placeholder="Price in coins"
              value={listingPrice}
              onChange={(e) => setListingPrice(e.target.value)}
              style={{
                background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 8,
                padding: "8px 10px", color: "var(--text-primary)", fontSize: 12, outline: "none", width: 140,
              }}
            />
            <button
              className="case-open-btn"
              style={{ padding: "8px 20px", fontSize: 12 }}
              disabled={!listingItemId || !listingPrice}
              onClick={handleCreateListing}
            >List for Sale</button>
          </div>
        </div>
      )}

      {marketplaceLoading && listings.length === 0 ? (
        <div className="case-loading">Loading marketplace...</div>
      ) : listings.length === 0 ? (
        <div className="case-loading">No items listed yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
          {listings.map(listing => (
            <div key={listing.id} className="marketplace-card">
              <div className="marketplace-card-top">
                <div style={{ display: "flex", alignItems: "center" }}>
                  <ItemPreview type={listing.type} rarity={listing.rarity} previewCss={listing.previewCss} cardSeries={listing.cardSeries} cardNumber={listing.cardNumber} isHolographic={listing.isHolographic ?? false} patternSeed={listing.patternSeed} size="md" />
                </div>
                <div className="marketplace-card-info">
                  <div className="marketplace-card-name">{listing.name}</div>
                  <div className="marketplace-card-meta">
                    <span style={{ color: rarityGlow(listing.rarity) }}>{rarityLabel(listing.rarity)}</span>
                    {" · "}
                    {listing.sellerUsername}
                  </div>
                </div>
              </div>
              <div className="marketplace-card-bottom">
                <div className="marketplace-card-price"><Coins size={12} /><span>{listing.price}</span></div>
                {listing.sellerId === user?.id ? (
                  <button
                    className="trade-decline-btn"
                    onClick={() => cancelListing(listing.id)}
                  >Cancel</button>
                ) : (
                  <button
                    className="marketplace-buy-btn"
                    disabled={(wallet?.balance ?? 0) < listing.price}
                    onClick={() => handleBuy(listing)}
                  >Buy</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CraftingTab() {
  const { inventory, fetchInventory, craftItems } = useEconomyStore();
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<InventoryItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  // Group unequipped items by rarity
  const unequipped = inventory.filter(i => !i.equipped);
  const selectedRarity = selected.length > 0
    ? unequipped.find(i => i.id === selected[0])?.rarity ?? null
    : null;

  const eligible = selectedRarity
    ? unequipped.filter(i => i.rarity === selectedRarity)
    : unequipped;

  function toggleItem(id: string) {
    if (selected.includes(id)) {
      setSelected(selected.filter(s => s !== id));
    } else if (selected.length < 5) {
      const item = unequipped.find(i => i.id === id);
      if (selected.length === 0 || (item && item.rarity === selectedRarity)) {
        setSelected([...selected, id]);
      }
    }
  }

  async function handleCraft() {
    if (selected.length !== 5) return;
    setError(null);
    try {
      const res = await craftItems(selected);
      setResult(res);
      setSelected([]);
    } catch (err: any) {
      setError(err?.message ?? "Crafting failed");
    }
  }

  return (
    <div>
      <div style={{
        background: "var(--bg-tertiary)", borderRadius: 10, padding: 16, marginBottom: 16,
        border: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
          Trade Up Contract
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
          Select 5 items of the same rarity to craft 1 item of the next tier.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => {
            const item = selected[i] ? unequipped.find(it => it.id === selected[i]) : null;
            return (
              <div
                key={i}
                style={{
                  width: 80, height: 80, borderRadius: 8, border: "2px dashed var(--border)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  background: item ? "var(--bg-secondary)" : "transparent",
                  borderColor: item ? rarityGlow(item.rarity) : undefined,
                  fontSize: 10, color: "var(--text-muted)", gap: 4, cursor: item ? "pointer" : "default",
                }}
                onClick={() => item && toggleItem(item.id)}
                title={item ? `Click to remove: ${item.name}` : ""}
              >
                {item ? (
                  <>
                    <ItemPreview type={item.type} rarity={item.rarity} previewCss={item.previewCss} cardSeries={item.cardSeries} cardNumber={item.cardNumber} isHolographic={item.isHolographic ?? false} patternSeed={item.patternSeed} size="sm" />
                    <span style={{ maxWidth: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{item.name}</span>
                  </>
                ) : (
                  <span>Slot {i + 1}</span>
                )}
              </div>
            );
          })}

          <div style={{ display: "flex", alignItems: "center", padding: "0 12px", fontSize: 20, color: "var(--text-muted)" }}>→</div>

          <div style={{
            width: 80, height: 80, borderRadius: 8, border: "2px solid var(--border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: result ? "var(--bg-secondary)" : "transparent",
            borderColor: result ? rarityGlow(result.rarity) : undefined,
          }}>
            {result ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 10 }}>
                <ItemPreview type={result.type} rarity={result.rarity} previewCss={result.previewCss} cardSeries={result.cardSeries} cardNumber={result.cardNumber} isHolographic={result.isHolographic ?? false} patternSeed={result.patternSeed} size="sm" />
                <span style={{ color: rarityGlow(result.rarity), fontWeight: 600 }}>{result.name}</span>
              </div>
            ) : (
              <span style={{ fontSize: 20, color: "var(--text-muted)" }}>?</span>
            )}
          </div>
        </div>

        <button
          className="case-open-btn"
          style={{ padding: "8px 24px", fontSize: 13 }}
          disabled={selected.length !== 5}
          onClick={handleCraft}
        >
          Craft ({selected.length}/5)
        </button>
        {error && <div className="case-error" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="case-contents-label" style={{ marginBottom: 10 }}>
        {selectedRarity ? `Select ${rarityLabel(selectedRarity)} items` : "Select items to craft"}
      </div>
      {eligible.length === 0 ? (
        <div className="case-loading">No eligible items. You need 5 unequipped items of the same rarity.</div>
      ) : (
        <div className="inventory-grid">
          {eligible.map(item => (
            <div
              key={item.id}
              className={`inventory-item-card ${selected.includes(item.id) ? "equipped" : ""}`}
              onClick={() => toggleItem(item.id)}
              style={{
                opacity: selectedRarity && item.rarity !== selectedRarity ? 0.3 : 1,
                pointerEvents: selectedRarity && item.rarity !== selectedRarity ? "none" : "auto",
              }}
            >
              {selected.includes(item.id) && <div className="item-equipped-badge" style={{ background: "#4b69ff" }}>Selected</div>}
              <div className="inventory-item-icon">
                <ItemPreview type={item.type} rarity={item.rarity} previewCss={item.previewCss} cardSeries={item.cardSeries} cardNumber={item.cardNumber} isHolographic={item.isHolographic ?? false} patternSeed={item.patternSeed} size="md" />
              </div>
              <div className="inventory-item-name">{item.name}</div>
              <div className="inventory-item-rarity" style={{ color: rarityGlow(item.rarity) }}>{rarityLabel(item.rarity)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type EconomyTab = "cases" | "inventory" | "marketplace" | "crafting";

const TAB_META: { key: EconomyTab; label: string; icon: typeof Package }[] = [
  { key: "cases", label: "Cases", icon: Package },
  { key: "inventory", label: "Inventory", icon: Backpack },
  { key: "marketplace", label: "Market", icon: Store },
  { key: "crafting", label: "Craft", icon: Hammer },
];

export function EconomyView() {
  const { wallet, fetchWallet, grantCoins, grantTestRings } = useEconomyStore();
  const [tab, setTab] = useState<EconomyTab>("cases");

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  return (
    <div className="economy-view">
      <div className="economy-view-header">
        <h2 className="economy-view-title">FluxFloat</h2>
        <div className="economy-header-right">
          <button className="economy-grant-btn" onClick={() => grantCoins(1000)} title="Dev: Add 1000 coins">
            + 1000
          </button>
          <button className="economy-grant-btn" onClick={() => grantTestRings()} title="Dev: Grant Ruby/Emerald/Sapphire doppler rings">
            + Rings
          </button>
          <div className="case-wallet-badge"><Coins size={14} /><span>{wallet?.balance ?? 0}</span></div>
        </div>
      </div>

      <div className="economy-tabs">
        {TAB_META.map(t => (
          <button
            key={t.key}
            className={`economy-tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            <t.icon size={14} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="economy-view-body">
        {tab === "cases" && <CasesTab />}
        {tab === "inventory" && <InventoryTab />}
        {tab === "marketplace" && <MarketplaceTab />}
        {tab === "crafting" && <CraftingTab />}
      </div>
    </div>
  );
}
