import { create } from "zustand";
import type { DMMessage } from "../../types/shared.js";
import * as api from "../../lib/api/index.js";
import { gateway } from "../../lib/ws.js";
import { useCryptoStore } from "../crypto.js";
import { dbg } from "../../lib/debug.js";
import { dmMessageCache, saveDMCache } from "../chat/types.js";
import {
  getChatStoreRef,
  savePreviousChannelState,
  clearChatStoreForDM,
  decryptDMBatch,
  decryptAndFilterSearchResults,
} from "./helpers.js";

export interface DMChannel {
  id: string;
  otherUser: { id: string; username: string; image: string | null };
  createdAt: string;
}

export interface DMState {
  showingDMs: boolean;
  dmChannels: DMChannel[];
  activeDMChannelId: string | null;
  dmMessages: DMMessage[];
  dmHasMore: boolean;
  dmCursor: string | null;
  dmSearchQuery: string;
  dmSearchResults: DMMessage[] | null;
  dmError: string | null;
  loadingDMMessages: boolean;

  showDMs: () => void;
  loadDMChannels: () => Promise<void>;
  selectDM: (dmChannelId: string) => Promise<void>;
  openDM: (userId: string) => Promise<void>;
  sendDM: (content: string) => Promise<void>;
  clearDmError: () => void;
  retryEncryptionSetup: () => Promise<void>;
  loadMoreDMMessages: () => Promise<void>;
  searchDMMessages: (query: string) => Promise<void>;
  clearDMSearch: () => void;
}

export const useDMStore = create<DMState>((set, get) => ({
  showingDMs: false,
  dmChannels: [],
  activeDMChannelId: null,
  dmMessages: [],
  dmHasMore: false,
  dmCursor: null,
  dmSearchQuery: "",
  dmSearchResults: null,
  dmError: null,
  loadingDMMessages: false,

  showDMs: () => {
    // Save current channel/server state in chat store before switching
    savePreviousChannelState();
    const chatStoreRef = getChatStoreRef();
    chatStoreRef?.setState({
      activeServerId: null,
      activeChannelId: null,
      searchQuery: "",
      searchFilters: {},
      searchResults: null,
    });
    set({
      showingDMs: true,
    });
    get().loadDMChannels();
  },

  loadDMChannels: async () => {
    try {
      const dmChannels = await api.getDMChannels();
      set({ dmChannels });
    } catch (e) {
      dbg("chat", "Failed to load DM channels", e);
    }
  },

  selectDM: async (dmChannelId) => {
    // Skip if already viewing this DM
    if (get().activeDMChannelId === dmChannelId && get().showingDMs) return;

    // Save current channel/server state in chat store before switching
    savePreviousChannelState();

    const prevDM = get().activeDMChannelId;
    if (prevDM && prevDM !== dmChannelId) {
      saveDMCache(prevDM, get());
      gateway.send({ type: "leave_dm", dmChannelId: prevDM });
    }

    // Restore cached DM messages for instant display
    const cachedDM = dmMessageCache.get(dmChannelId);

    // Clear chat store's server/channel state
    clearChatStoreForDM();

    set({
      showingDMs: true,
      activeDMChannelId: dmChannelId,
      dmMessages: cachedDM?.messages ?? [],
      dmHasMore: cachedDM?.hasMore ?? false,
      dmCursor: cachedDM?.cursor ?? null,
      loadingDMMessages: !cachedDM,
    });

    gateway.send({ type: "join_dm", dmChannelId });

    // Fetch fresh data in background (non-blocking if cache exists)
    try {
      const result = await api.getDMMessages(dmChannelId);
      // Only apply if still viewing this DM
      if (get().activeDMChannelId !== dmChannelId) return;
      set({
        dmMessages: result.items,
        dmHasMore: result.hasMore,
        dmCursor: result.cursor,
        loadingDMMessages: false,
      });
      // Update cache with fresh data
      saveDMCache(dmChannelId, get() as any);
      // Decrypt DM messages
      const dm = get().dmChannels.find((d) => d.id === dmChannelId);
      if (dm) {
        await decryptDMBatch(dmChannelId, dm.otherUser.id, result.items);
      }
    } catch {
      if (get().activeDMChannelId === dmChannelId) {
        set({ loadingDMMessages: false });
      }
    }
  },

  openDM: async (userId) => {
    try {
      // Check if we already have a DM channel with this user (skip API call)
      const existing = get().dmChannels.find((d) => d.otherUser.id === userId);
      if (existing) {
        get().selectDM(existing.id);
        return;
      }
      const dm = await api.createDM(userId);
      set((state) => {
        const exists = state.dmChannels.some((d) => d.id === dm.id);
        return { dmChannels: exists ? state.dmChannels : [...state.dmChannels, dm] };
      });
      get().selectDM(dm.id);
    } catch (e) {
      dbg("chat", "Failed to open DM", e);
    }
  },

  sendDM: async (content) => {
    const { activeDMChannelId, dmChannels } = get();
    if (!activeDMChannelId || !content.trim()) return;

    const dm = dmChannels.find((d) => d.id === activeDMChannelId);
    const cryptoState = useCryptoStore.getState();
    if (!dm || !cryptoState.keyPair) {
      set({ dmError: "Encryption keys not available. Try reinitializing encryption." });
      return;
    }
    let ciphertext: string;
    try {
      const key = await cryptoState.getDMKey(activeDMChannelId, dm.otherUser.id);
      ciphertext = await cryptoState.encryptMessage(content, key);
    } catch (e) {
      dbg("chat", "DM encryption failed:", e);
      set({ dmError: "Failed to encrypt message. Try reinitializing encryption." });
      return;
    }
    set({ dmError: null });

    gateway.send({
      type: "send_dm",
      dmChannelId: activeDMChannelId,
      ciphertext,
      mlsEpoch: 1,
    });
  },

  clearDmError: () => set({ dmError: null }),

  retryEncryptionSetup: async () => {
    set({ dmError: null });
    const cryptoState = useCryptoStore.getState();
    // Reset initialized flag so initialize() runs again
    useCryptoStore.setState({ initialized: false });
    await cryptoState.initialize();
    if (!useCryptoStore.getState().keyPair) {
      set({ dmError: "Encryption setup failed. Please restart the app." });
    }
  },

  loadMoreDMMessages: async () => {
    const { activeDMChannelId, dmCursor, dmHasMore, loadingDMMessages } = get();
    if (!activeDMChannelId || !dmHasMore || loadingDMMessages) return;

    set({ loadingDMMessages: true });
    try {
      const result = await api.getDMMessages(activeDMChannelId, dmCursor ?? undefined);
      set((state) => ({
        dmMessages: [...result.items, ...state.dmMessages],
        dmHasMore: result.hasMore,
        dmCursor: result.cursor,
        loadingDMMessages: false,
      }));
      // Decrypt loaded DM messages
      const dm = get().dmChannels.find((d) => d.id === activeDMChannelId);
      if (dm) {
        await decryptDMBatch(activeDMChannelId, dm.otherUser.id, result.items);
      }
    } catch {
      set({ loadingDMMessages: false });
    }
  },

  searchDMMessages: async (query) => {
    const { activeDMChannelId, dmChannels } = get();
    if (!activeDMChannelId || !query.trim()) return;
    set({ dmSearchQuery: query });
    try {
      const result = await api.searchDMMessages(activeDMChannelId, query);
      const dm = dmChannels.find((d) => d.id === activeDMChannelId);
      const matched = dm
        ? await decryptAndFilterSearchResults(
            activeDMChannelId,
            dm.otherUser.id,
            result.items,
            query,
          )
        : [];
      set({ dmSearchResults: matched });
    } catch {
      set({ dmSearchResults: [] });
    }
  },

  clearDMSearch: () => {
    set({ dmSearchQuery: "", dmSearchResults: null });
  },
}));
