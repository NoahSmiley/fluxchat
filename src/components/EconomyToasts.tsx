import { useEconomyStore, type CaseDropNotification, type TradeNotification } from "../stores/economy.js";
import { useUIStore } from "../stores/ui.js";
import { X, Coins, ArrowRightLeft } from "lucide-react";
import { RARITY_COLORS } from "../types/shared.js";
import type { ItemRarity } from "../types/shared.js";

function rarityGlow(r: string): string {
  return RARITY_COLORS[r as ItemRarity] ?? "#888";
}

export function EconomyToasts() {
  const recentDrops = useEconomyStore((s) => s.recentDrops);
  const tradeNotifications = useEconomyStore((s) => s.tradeNotifications);
  const dismissDrop = useEconomyStore((s) => s.dismissDrop);
  const dismissTradeNotification = useEconomyStore((s) => s.dismissTradeNotification);
  const showEconomy = useUIStore((s) => s.showEconomy);

  if (recentDrops.length === 0 && tradeNotifications.length === 0) return null;

  return (
    <div className="economy-toasts">
      {recentDrops.map((drop) => (
        <div
          key={drop.timestamp}
          className="economy-toast drop-toast"
          style={{ borderLeftColor: rarityGlow(drop.itemRarity) }}
        >
          <div className="economy-toast-content">
            <div className="economy-toast-title">
              <span className="drop-username">{drop.username}</span> unboxed
            </div>
            <div className="economy-toast-item" style={{ color: rarityGlow(drop.itemRarity) }}>
              {drop.itemName}
            </div>
            <div className="economy-toast-meta">from {drop.caseName}</div>
          </div>
          <button className="economy-toast-close" onClick={() => dismissDrop(drop.timestamp)}>
            <X size={12} />
          </button>
        </div>
      ))}

      {tradeNotifications.map((notif) => (
        <div
          key={notif.tradeId}
          className="economy-toast trade-toast"
          onClick={() => { showEconomy(); dismissTradeNotification(notif.tradeId); }}
          style={{ cursor: "pointer" }}
        >
          <div className="economy-toast-icon">
            <ArrowRightLeft size={16} />
          </div>
          <div className="economy-toast-content">
            <div className="economy-toast-title">Trade Offer</div>
            <div className="economy-toast-meta">
              <span className="drop-username">{notif.senderUsername}</span> wants to trade
            </div>
          </div>
          <button
            className="economy-toast-close"
            onClick={(e) => { e.stopPropagation(); dismissTradeNotification(notif.tradeId); }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
