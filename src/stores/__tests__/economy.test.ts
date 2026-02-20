import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEconomyStore } from "../economy.js";

// Mock dependencies
vi.mock("../../lib/api.js", () => ({
  getWallet: vi.fn(),
  getCoinHistory: vi.fn(),
  grantCoins: vi.fn(),
  getCases: vi.fn(),
  getCase: vi.fn(),
  openCase: vi.fn(),
  getInventory: vi.fn(),
  toggleEquipItem: vi.fn(),
  getTrades: vi.fn(),
  createTrade: vi.fn(),
  acceptTrade: vi.fn(),
  declineTrade: vi.fn(),
  cancelTrade: vi.fn(),
  getMarketplace: vi.fn(),
  createMarketplaceListing: vi.fn(),
  buyMarketplaceListing: vi.fn(),
  cancelMarketplaceListing: vi.fn(),
  craftItems: vi.fn(),
  grantItem: vi.fn(),
  clearInventory: vi.fn(),
  getStoredToken: vi.fn(() => null),
  setStoredToken: vi.fn(),
}));

vi.mock("../../lib/ws.js", () => ({
  gateway: { on: vi.fn(), send: vi.fn(), onConnect: vi.fn() },
}));

vi.mock("../auth.js", () => ({
  useAuthStore: {
    getState: vi.fn(() => ({ user: { id: "u1" } })),
    setState: vi.fn(),
  },
}));

vi.mock("../chat.js", () => ({
  useChatStore: {
    getState: vi.fn(() => ({ members: [] })),
    setState: vi.fn(),
  },
}));

import * as api from "../../lib/api.js";

const mockedApi = vi.mocked(api);

describe("useEconomyStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEconomyStore.setState({
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
    });
  });

  it("fetchWallet sets wallet state", async () => {
    const mockWallet = { balance: 500, lifetimeEarned: 1000 };
    mockedApi.getWallet.mockResolvedValue(mockWallet);

    await useEconomyStore.getState().fetchWallet();

    expect(useEconomyStore.getState().wallet).toEqual(mockWallet);
    expect(useEconomyStore.getState().walletLoading).toBe(false);
  });

  it("grantCoins updates balance", async () => {
    useEconomyStore.setState({
      wallet: { balance: 100, lifetimeEarned: 100 },
    });
    mockedApi.grantCoins.mockResolvedValue({ newBalance: 1100 });

    await useEconomyStore.getState().grantCoins(1000);

    expect(useEconomyStore.getState().wallet?.balance).toBe(1100);
  });

  it("openCase deducts balance and adds to inventory", async () => {
    useEconomyStore.setState({
      wallet: { balance: 500, lifetimeEarned: 1000 },
      inventory: [],
    });
    const mockResult = {
      id: "inv1",
      itemId: "item1",
      name: "Cool Ring",
      type: "ring_style",
      rarity: "rare",
      previewCss: "cool",
      equipped: false,
      acquiredAt: "2024-01-01",
      newBalance: 200,
      patternSeed: null,
    };
    mockedApi.openCase.mockResolvedValue(mockResult);

    const result = await useEconomyStore.getState().openCase("case1");

    expect(result).toEqual(mockResult);
    expect(useEconomyStore.getState().wallet?.balance).toBe(200);
    expect(useEconomyStore.getState().inventory).toHaveLength(1);
    expect(useEconomyStore.getState().inventory[0].id).toBe("inv1");
  });

  it("fetchCases loads cases list", async () => {
    const mockCases = [
      { id: "c1", name: "Basic Case", price: 100, imageUrl: null },
      { id: "c2", name: "Premium Case", price: 500, imageUrl: null },
    ];
    mockedApi.getCases.mockResolvedValue(mockCases);

    await useEconomyStore.getState().fetchCases();

    expect(useEconomyStore.getState().cases).toEqual(mockCases);
    expect(useEconomyStore.getState().casesLoading).toBe(false);
  });

  it("fetchInventory populates inventory", async () => {
    const mockInventory = [
      { id: "inv1", itemId: "item1", name: "Ring", type: "ring_style", rarity: "rare", previewCss: "cool", equipped: false, acquiredAt: "2024-01-01", patternSeed: null },
    ];
    mockedApi.getInventory.mockResolvedValue(mockInventory);

    await useEconomyStore.getState().fetchInventory();

    expect(useEconomyStore.getState().inventory).toEqual(mockInventory);
    expect(useEconomyStore.getState().inventoryLoading).toBe(false);
  });

  it("buyListing updates balance and removes listing", async () => {
    useEconomyStore.setState({
      wallet: { balance: 1000, lifetimeEarned: 1000 },
      listings: [
        { id: "l1", inventoryId: "inv1", sellerId: "u2", price: 300, itemName: "Banner", itemRarity: "rare", itemType: "profile_banner", itemPreviewCss: "sunset", listedAt: "2024-01-01", sellerUsername: "bob", patternSeed: null },
      ],
    });
    mockedApi.buyMarketplaceListing.mockResolvedValue({ newBalance: 700 });
    mockedApi.getInventory.mockResolvedValue([]);

    const result = await useEconomyStore.getState().buyListing("l1");

    expect(result.newBalance).toBe(700);
    expect(useEconomyStore.getState().wallet?.balance).toBe(700);
    expect(useEconomyStore.getState().listings).toHaveLength(0);
  });

  it("dismissDrop removes a drop notification by timestamp", () => {
    useEconomyStore.setState({
      recentDrops: [
        { userId: "u1", username: "alice", itemName: "Ring", itemRarity: "rare", caseName: "Basic", timestamp: 1000 },
        { userId: "u2", username: "bob", itemName: "Banner", itemRarity: "common", caseName: "Basic", timestamp: 2000 },
      ],
    });

    useEconomyStore.getState().dismissDrop(1000);

    expect(useEconomyStore.getState().recentDrops).toHaveLength(1);
    expect(useEconomyStore.getState().recentDrops[0].timestamp).toBe(2000);
  });
});
