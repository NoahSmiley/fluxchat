import { create } from "zustand";
import * as crypto from "@/lib/crypto.js";
import * as api from "@/lib/api/index.js";
import { gateway } from "@/lib/ws.js";
import { dbg } from "@/lib/debug.js";

interface CryptoState {
  keyPair: CryptoKeyPair | null;
  publicKeyBase64: string | null;
  serverKeys: Record<string, CryptoKey>;   // serverId → group key
  dmKeys: Record<string, CryptoKey>;       // dmChannelId → derived key
  pendingServers: Set<string>;             // servers waiting for key
  initialized: boolean;

  initialize: () => Promise<void>;
  getServerKey: (serverId: string) => CryptoKey | null;
  setServerKey: (serverId: string, key: CryptoKey) => void;
  getDMKey: (dmChannelId: string, otherUserId: string) => Promise<CryptoKey>;
  encryptMessage: (plaintext: string, key: CryptoKey) => Promise<string>;
  decryptMessage: (ciphertext: string, key: CryptoKey | null) => Promise<string>;
  handleKeyShared: (serverId: string, encryptedKey: string, senderId: string) => Promise<void>;
  handleKeyRequested: (serverId: string, requesterId: string) => Promise<void>;
  createAndStoreServerKey: (serverId: string) => Promise<void>;
  requestServerKey: (serverId: string) => void;
}

export const useCryptoStore = create<CryptoState>((set, get) => ({
  keyPair: null,
  publicKeyBase64: null,
  serverKeys: {},
  dmKeys: {},
  pendingServers: new Set(),
  initialized: false,

  initialize: async () => {
    if (get().initialized) return;

    // Load or generate key pair
    let keyPair = await crypto.loadKeyPair();
    if (!keyPair) {
      keyPair = await crypto.generateKeyPair();
      await crypto.storeKeyPair(keyPair);
    }

    const publicKeyBase64 = await crypto.exportPublicKey(keyPair.publicKey);
    set({ keyPair, publicKeyBase64, initialized: true });

    // Upload public key to server
    try {
      await api.setPublicKey(publicKeyBase64);
    } catch (e) {
      dbg("crypto", "Failed to upload public key:", e);
    }

    // Load server keys for all joined servers
    const { useChatStore } = await import("./chat/store.js");
    const servers = useChatStore.getState().servers;
    for (const server of servers) {
      try {
        const keyData = await api.getMyServerKey(server.id);
        if (keyData) {
          // Fetch sender's public key to unwrap
          const senderPubData = await api.getPublicKey(keyData.senderId);
          if (senderPubData?.publicKey) {
            const senderPub = await crypto.importPublicKey(senderPubData.publicKey);
            const groupKey = await crypto.unwrapGroupKey(
              keyData.encryptedKey,
              senderPub,
              keyPair.privateKey,
            );
            set((s) => ({
              serverKeys: { ...s.serverKeys, [server.id]: groupKey },
            }));
          }
        } else {
          // No key stored — request from online members
          get().requestServerKey(server.id);
        }
      } catch (e) {
        dbg("crypto", `Failed to load key for server ${server.id}:`, e);
        get().requestServerKey(server.id);
      }
    }
  },

  getServerKey: (serverId) => {
    return get().serverKeys[serverId] ?? null;
  },

  setServerKey: (serverId, key) => {
    set((s) => {
      const pending = new Set(s.pendingServers);
      pending.delete(serverId);
      return {
        serverKeys: { ...s.serverKeys, [serverId]: key },
        pendingServers: pending,
      };
    });
  },

  getDMKey: async (dmChannelId, otherUserId) => {
    const cached = get().dmKeys[dmChannelId];
    if (cached) return cached;

    const { keyPair } = get();
    if (!keyPair) throw new Error("Crypto not initialized");

    // Fetch other user's public key
    const pubData = await api.getPublicKey(otherUserId);
    if (!pubData?.publicKey) throw new Error("Other user has no public key");

    const theirPublic = await crypto.importPublicKey(pubData.publicKey);
    const dmKey = await crypto.deriveDMKey(keyPair.privateKey, theirPublic, dmChannelId);

    set((s) => ({
      dmKeys: { ...s.dmKeys, [dmChannelId]: dmKey },
    }));

    return dmKey;
  },

  encryptMessage: async (plaintext, key) => {
    return crypto.encrypt(plaintext, key);
  },

  decryptMessage: async (ciphertext, key) => {
    return crypto.decryptMessage(ciphertext, key);
  },

  handleKeyShared: async (serverId, encryptedKey, senderId) => {
    const { keyPair } = get();
    if (!keyPair) return;

    try {
      const senderPubData = await api.getPublicKey(senderId);
      if (!senderPubData?.publicKey) return;

      const senderPub = await crypto.importPublicKey(senderPubData.publicKey);
      const groupKey = await crypto.unwrapGroupKey(encryptedKey, senderPub, keyPair.privateKey);
      get().setServerKey(serverId, groupKey);
    } catch (e) {
      dbg("crypto", `Failed to unwrap server key for ${serverId}:`, e);
    }
  },

  handleKeyRequested: async (serverId, requesterId) => {
    const { keyPair, serverKeys } = get();
    const groupKey = serverKeys[serverId];
    if (!keyPair || !groupKey) return; // We don't have the key either

    try {
      // Fetch requester's public key
      const requesterPubData = await api.getPublicKey(requesterId);
      if (!requesterPubData?.publicKey) return;

      const requesterPub = await crypto.importPublicKey(requesterPubData.publicKey);
      const wrapped = await crypto.wrapGroupKey(groupKey, requesterPub, keyPair.privateKey);

      // Send via WS
      gateway.send({
        type: "share_server_key",
        serverId,
        userId: requesterId,
        encryptedKey: wrapped,
      });

      // Also persist via REST so they can fetch later
      const publicKeyBase64 = get().publicKeyBase64!;
      await api.shareServerKeyWith(serverId, requesterId, wrapped, publicKeyBase64).catch(() => {});
    } catch (e) {
      dbg("crypto", `Failed to share key for server ${serverId}:`, e);
    }
  },

  createAndStoreServerKey: async (serverId) => {
    const { keyPair, publicKeyBase64 } = get();
    if (!keyPair || !publicKeyBase64) return;

    const groupKey = await crypto.generateGroupKey();
    const wrapped = await crypto.wrapGroupKey(groupKey, keyPair.publicKey, keyPair.privateKey);

    // Store on server
    await api.storeServerKey(serverId, wrapped, publicKeyBase64);
    get().setServerKey(serverId, groupKey);
  },

  requestServerKey: (serverId) => {
    set((s) => {
      const pending = new Set(s.pendingServers);
      pending.add(serverId);
      return { pendingServers: pending };
    });
    gateway.send({ type: "request_server_key", serverId });
  },
}));
