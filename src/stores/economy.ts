import { create } from "zustand";
import * as api from "../lib/api.js";
import { gateway } from "../lib/ws.js";
import { useAuthStore } from "./auth.js";
import { useChatStore } from "./chat.js";
import type {
  Wallet,
  CoinHistoryEntry,
  CaseInfo,
  CaseDetail,
  InventoryItem,
  CaseOpenResult,
  Trade,
  MarketplaceListing,
  CraftResult,
  WSServerEvent,
} from "../types/shared.js";

export interface CaseDropNotification {
  userId: string;
  username: string;
  itemName: string;
  itemRarity: string;
  caseName: string;
  timestamp: number;
}

export interface TradeNotification {
  tradeId: string;
  senderId: string;
  senderUsername: string;
  timestamp: number;
}

interface EconomyState {
  // Wallet
  wallet: Wallet | null;
  coinHistory: CoinHistoryEntry[];
  walletLoading: boolean;

  // Cases
  cases: CaseInfo[];
  caseDetail: CaseDetail | null;
  casesLoading: boolean;

  // Inventory
  inventory: InventoryItem[];
  inventoryLoading: boolean;

  // Trades
  trades: Trade[];
  tradesLoading: boolean;

  // Marketplace
  listings: MarketplaceListing[];
  marketplaceLoading: boolean;

  // Real-time notifications
  recentDrops: CaseDropNotification[];
  tradeNotifications: TradeNotification[];
  suppressOwnDrops: boolean;
  dismissDrop: (timestamp: number) => void;
  dismissTradeNotification: (tradeId: string) => void;

  // Actions - Wallet
  fetchWallet: () => Promise<void>;
  fetchCoinHistory: () => Promise<void>;
  updateBalance: (newBalance: number) => void;
  grantCoins: (amount?: number) => Promise<void>;

  // Actions - Cases
  fetchCases: () => Promise<void>;
  fetchCaseDetail: (caseId: string) => Promise<void>;
  openCase: (caseId: string) => Promise<CaseOpenResult>;

  // Actions - Inventory
  fetchInventory: (filters?: { type?: string; rarity?: string }) => Promise<void>;
  toggleEquip: (itemId: string) => Promise<void>;
  removeFromInventory: (itemId: string) => void;

  // Actions - Trades
  fetchTrades: () => Promise<void>;
  createTrade: (data: {
    receiverId: string;
    senderItemIds: string[];
    receiverItemIds: string[];
    senderCoins?: number;
    receiverCoins?: number;
  }) => Promise<void>;
  acceptTrade: (tradeId: string) => Promise<void>;
  declineTrade: (tradeId: string) => Promise<void>;
  cancelTrade: (tradeId: string) => Promise<void>;
  removeTrade: (tradeId: string) => void;

  // Actions - Marketplace
  fetchMarketplace: (filters?: { search?: string; rarity?: string; type?: string; sort?: string }) => Promise<void>;
  createListing: (inventoryId: string, price: number) => Promise<void>;
  buyListing: (listingId: string) => Promise<{ newBalance: number }>;
  cancelListing: (listingId: string) => Promise<void>;

  // Actions - Crafting
  craftItems: (inventoryIds: string[]) => Promise<CraftResult>;

  // Dev
  grantItem: (itemId: string, patternSeed?: number) => Promise<void>;
  grantTestRings: () => Promise<void>;
}

export const useEconomyStore = create<EconomyState>((set, get) => ({
  wallet: null,
  coinHistory: [],
  walletLoading: false,
  cases: [],
  caseDetail: null,
  casesLoading: false,
  inventory: [],
  inventoryLoading: false,
  trades: [],
  tradesLoading: false,
  listings: [],
  marketplaceLoading: false,
  recentDrops: [],
  tradeNotifications: [],
  suppressOwnDrops: false,

  dismissDrop: (timestamp: number) => {
    set((state) => ({
      recentDrops: state.recentDrops.filter((d) => d.timestamp !== timestamp),
    }));
  },

  dismissTradeNotification: (tradeId: string) => {
    set((state) => ({
      tradeNotifications: state.tradeNotifications.filter((n) => n.tradeId !== tradeId),
    }));
  },

  // ── Wallet ──

  fetchWallet: async () => {
    set({ walletLoading: true });
    try {
      const wallet = await api.getWallet();
      set({ wallet, walletLoading: false });
    } catch {
      set({ walletLoading: false });
    }
  },

  fetchCoinHistory: async () => {
    try {
      const coinHistory = await api.getCoinHistory();
      set({ coinHistory });
    } catch { /* ignore */ }
  },

  updateBalance: (newBalance: number) => {
    const wallet = get().wallet;
    if (wallet) {
      set({ wallet: { ...wallet, balance: newBalance } });
    }
  },

  grantCoins: async (amount = 1000) => {
    try {
      const result = await api.grantCoins(amount);
      const wallet = get().wallet;
      if (wallet) {
        set({ wallet: { ...wallet, balance: result.newBalance } });
      }
    } catch { /* ignore */ }
  },

  // ── Cases ──

  fetchCases: async () => {
    set({ casesLoading: true });
    try {
      const cases = await api.getCases();
      set({ cases, casesLoading: false });
    } catch {
      set({ casesLoading: false });
    }
  },

  fetchCaseDetail: async (caseId: string) => {
    set({ casesLoading: true, caseDetail: null });
    try {
      const caseDetail = await api.getCase(caseId);
      set({ caseDetail, casesLoading: false });
    } catch (err) {
      console.error("Failed to fetch case detail:", err);
      set({ casesLoading: false });
    }
  },

  openCase: async (caseId: string) => {
    set({ suppressOwnDrops: true });
    const result = await api.openCase(caseId);
    // Update wallet balance
    set((state) => ({
      wallet: state.wallet ? { ...state.wallet, balance: result.newBalance } : state.wallet,
      inventory: [result, ...state.inventory],
    }));
    return result;
  },

  // ── Inventory ──

  fetchInventory: async (filters) => {
    set({ inventoryLoading: true });
    try {
      const inventory = await api.getInventory(filters);
      set({ inventory, inventoryLoading: false });
    } catch {
      set({ inventoryLoading: false });
    }
  },

  toggleEquip: async (itemId: string) => {
    const result = await api.toggleEquipItem(itemId);
    const targetItem = get().inventory.find((i) => i.id === itemId);
    set((state) => ({
      inventory: state.inventory.map((item) => {
        if (item.id === result.id) return { ...item, equipped: result.equipped };
        // If we just equipped a ring, unequip other rings locally
        if (result.equipped && targetItem?.type === "ring_style" && item.type === "ring_style" && item.equipped) {
          return { ...item, equipped: false };
        }
        // If we just equipped a banner, unequip other banners locally
        if (result.equipped && targetItem?.type === "profile_banner" && item.type === "profile_banner" && item.equipped) {
          return { ...item, equipped: false };
        }
        return item;
      }),
    }));

    // Immediately sync ring/banner changes to members array + auth store
    // so the UserCard popup and other UI updates without waiting for WS roundtrip
    if (targetItem) {
      const userId = useAuthStore.getState().user?.id;
      if (!userId) return;

      if (targetItem.type === "ring_style") {
        const newRingStyle = result.equipped ? (targetItem.previewCss ?? "default") : "default";
        const newPatternSeed = result.equipped ? (targetItem.patternSeed ?? null) : null;
        useChatStore.setState((s) => ({
          members: s.members.map((m) =>
            m.userId === userId ? { ...m, ringStyle: newRingStyle as import("../types/shared.js").RingStyle, ringPatternSeed: newPatternSeed } : m
          ),
        }));
        const current = useAuthStore.getState().user;
        if (current) {
          useAuthStore.setState({ user: { ...current, ringStyle: newRingStyle as import("../types/shared.js").RingStyle, ringPatternSeed: newPatternSeed } });
        }
      } else if (targetItem.type === "profile_banner") {
        const newBannerCss = result.equipped ? (targetItem.previewCss ?? null) : null;
        const newBannerSeed = result.equipped ? (targetItem.patternSeed ?? null) : null;
        useChatStore.setState((s) => ({
          members: s.members.map((m) =>
            m.userId === userId ? { ...m, bannerCss: newBannerCss, bannerPatternSeed: newBannerSeed } : m
          ),
        }));
        const current = useAuthStore.getState().user;
        if (current) {
          useAuthStore.setState({ user: { ...current, bannerCss: newBannerCss, bannerPatternSeed: newBannerSeed } });
        }
      }
    }
  },

  removeFromInventory: (itemId: string) => {
    set((state) => ({
      inventory: state.inventory.filter((item) => item.id !== itemId),
    }));
  },

  // ── Trades ──

  fetchTrades: async () => {
    set({ tradesLoading: true });
    try {
      const trades = await api.getTrades();
      set({ trades, tradesLoading: false });
    } catch {
      set({ tradesLoading: false });
    }
  },

  createTrade: async (data) => {
    await api.createTrade(data);
    // Refresh trades list
    get().fetchTrades();
  },

  acceptTrade: async (tradeId: string) => {
    await api.acceptTrade(tradeId);
    set((state) => ({
      trades: state.trades.filter((t) => t.id !== tradeId),
    }));
    // Refresh inventory since items moved
    get().fetchInventory();
    get().fetchWallet();
  },

  declineTrade: async (tradeId: string) => {
    await api.declineTrade(tradeId);
    set((state) => ({
      trades: state.trades.filter((t) => t.id !== tradeId),
    }));
  },

  cancelTrade: async (tradeId: string) => {
    await api.cancelTrade(tradeId);
    set((state) => ({
      trades: state.trades.filter((t) => t.id !== tradeId),
    }));
  },

  removeTrade: (tradeId: string) => {
    set((state) => ({
      trades: state.trades.filter((t) => t.id !== tradeId),
    }));
  },

  // ── Marketplace ──

  fetchMarketplace: async (filters) => {
    set({ marketplaceLoading: true });
    try {
      const listings = await api.getMarketplace(filters);
      set({ listings, marketplaceLoading: false });
    } catch {
      set({ marketplaceLoading: false });
    }
  },

  createListing: async (inventoryId: string, price: number) => {
    await api.createMarketplaceListing(inventoryId, price);
    // Remove from inventory view (it's now listed)
    get().fetchInventory();
    get().fetchMarketplace();
  },

  buyListing: async (listingId: string) => {
    const result = await api.buyMarketplaceListing(listingId);
    set((state) => ({
      listings: state.listings.filter((l) => l.id !== listingId),
      wallet: state.wallet ? { ...state.wallet, balance: result.newBalance } : state.wallet,
    }));
    // Refresh inventory since we got a new item
    get().fetchInventory();
    return { newBalance: result.newBalance };
  },

  cancelListing: async (listingId: string) => {
    await api.cancelMarketplaceListing(listingId);
    set((state) => ({
      listings: state.listings.filter((l) => l.id !== listingId),
    }));
  },

  // ── Crafting ──

  craftItems: async (inventoryIds: string[]) => {
    const result = await api.craftItems(inventoryIds);
    // Remove consumed items, add new item
    set((state) => ({
      inventory: [
        result,
        ...state.inventory.filter((item) => !inventoryIds.includes(item.id)),
      ],
    }));
    return result;
  },

  // ── Dev ──

  grantItem: async (itemId: string, patternSeed?: number) => {
    await api.grantItem(itemId, patternSeed);
    get().fetchInventory();
  },

  grantTestRings: async () => {
    await api.clearInventory();
    // Doppler ring variants
    await api.grantItem("item_ring_doppler", 0);    // Regular Doppler
    await api.grantItem("item_ring_doppler", 26);   // Ruby
    await api.grantItem("item_ring_doppler", 16);   // Sapphire
    // Gamma Doppler ring variants
    await api.grantItem("item_ring_gamma_doppler", 0);   // Regular Gamma
    await api.grantItem("item_ring_gamma_doppler", 4);   // Emerald
    await api.grantItem("item_ring_gamma_doppler", 16);  // Diamond
    // Doppler banner variants
    await api.grantItem("item_banner_doppler", 0);       // Regular Doppler Banner
    await api.grantItem("item_banner_doppler", 26);      // Ruby Banner
    await api.grantItem("item_banner_doppler", 16);      // Sapphire Banner
    await api.grantItem("item_banner_gamma_doppler", 0); // Regular Gamma Banner
    await api.grantItem("item_banner_gamma_doppler", 4); // Emerald Banner
    await api.grantItem("item_banner_gamma_doppler", 16);// Diamond Banner
    // Static / image banners
    await api.grantItem("item_banner_sunset");
    await api.grantItem("item_banner_aurora");
    await api.grantItem("item_banner_cityscape");
    await api.grantItem("item_banner_space");
    await api.grantItem("item_banner_wyrm_manuscript");
    get().fetchInventory();
  },
}));

// ── WebSocket event listener ──

gateway.on((event: WSServerEvent) => {
  switch (event.type) {
    case "case_opened": {
      // Suppress own drops while the reel is spinning (prevents spoiling the result)
      const currentUserId = useAuthStore.getState().user?.id;
      if (event.userId === currentUserId && useEconomyStore.getState().suppressOwnDrops) break;

      // Someone opened a case — show a notification drop
      useEconomyStore.setState((state) => ({
        recentDrops: [
          ...state.recentDrops,
          {
            userId: event.userId,
            username: event.username,
            itemName: event.itemName,
            itemRarity: event.itemRarity,
            caseName: event.caseName,
            timestamp: Date.now(),
          },
        ].slice(-10), // Keep only last 10
      }));

      // Auto-dismiss after 8 seconds
      const ts = Date.now();
      setTimeout(() => {
        useEconomyStore.getState().dismissDrop(ts);
      }, 8000);
      break;
    }

    case "trade_offer_received": {
      // Someone sent us a trade offer
      useEconomyStore.setState((state) => ({
        tradeNotifications: [
          ...state.tradeNotifications,
          {
            tradeId: event.tradeId,
            senderId: event.senderId,
            senderUsername: event.senderUsername,
            timestamp: Date.now(),
          },
        ],
      }));
      // Refresh trades list if already loaded
      useEconomyStore.getState().fetchTrades();
      break;
    }

    case "trade_resolved": {
      // A trade was accepted/declined/cancelled
      useEconomyStore.setState((state) => ({
        trades: state.trades.filter((t) => t.id !== event.tradeId),
        tradeNotifications: state.tradeNotifications.filter((n) => n.tradeId !== event.tradeId),
      }));
      // Refresh inventory and wallet since items/coins may have moved
      if (event.status === "accepted") {
        useEconomyStore.getState().fetchInventory();
        useEconomyStore.getState().fetchWallet();
      }
      break;
    }

    case "coins_earned": {
      // Our coin balance changed (from marketplace sale, reward, etc.)
      useEconomyStore.setState((state) => ({
        wallet: state.wallet ? { ...state.wallet, balance: event.newBalance } : state.wallet,
      }));
      break;
    }
  }
});
