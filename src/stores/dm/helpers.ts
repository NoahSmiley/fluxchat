import type { StoreApi, UseBoundStore } from "zustand";
import type { DMMessage } from "@/types/shared.js";
import type { ChatState } from "@/stores/chat/types.js";
import { saveChannelCache, saveServerCache } from "@/stores/chat/types.js";
import { useCryptoStore } from "@/stores/crypto.js";
import { gateway } from "@/lib/ws.js";

// Lazy ref to chat store to avoid circular imports
let chatStoreRef: UseBoundStore<StoreApi<ChatState>> | null = null;
import("@/stores/chat/store.js").then((m) => { chatStoreRef = m.useChatStore; });

/**
 * Bulk-decrypt DM messages into the shared decrypted cache.
 * DMs remain E2EE — decrypted plaintext is held only in memory.
 */
async function decryptDMMessages(
  messages: DMMessage[],
  key: CryptoKey | null,
) {
  const cryptoState = useCryptoStore.getState();
  const cache: Record<string, string> = {};
  await Promise.all(
    messages.map(async (msg) => {
      cache[msg.id] = await cryptoState.decryptMessage(msg.ciphertext, key);
    }),
  );
  // Update decryptedCache on the chat store (shared cache for both contexts)
  chatStoreRef?.setState((s) => ({
    decryptedCache: { ...s.decryptedCache, ...cache },
  }));
}

/**
 * Resolve the DM encryption key for a given channel/user pair.
 * Returns `null` when no key-pair is available or derivation fails.
 */
async function getDMKey(
  dmChannelId: string,
  otherUserId: string,
): Promise<CryptoKey | null> {
  const cryptoState = useCryptoStore.getState();
  if (!cryptoState.keyPair) return null;
  try {
    return await cryptoState.getDMKey(dmChannelId, otherUserId);
  } catch {
    return null;
  }
}

/**
 * Decrypt DM messages and store results in the shared decrypted cache.
 * Combines key resolution + bulk decryption into a single call.
 */
async function decryptDMBatch(
  dmChannelId: string,
  otherUserId: string,
  messages: DMMessage[],
) {
  const key = await getDMKey(dmChannelId, otherUserId);
  await decryptDMMessages(messages, key);
}

/**
 * Look up the DM channel and decrypt a batch of messages.
 * Convenience wrapper used after fetching / loading more messages.
 */
export async function decryptForChannel(
  dmChannels: { id: string; otherUser: { id: string } }[],
  dmChannelId: string,
  messages: DMMessage[],
) {
  const dm = dmChannels.find((d) => d.id === dmChannelId);
  if (dm) await decryptDMBatch(dmChannelId, dm.otherUser.id, messages);
}

/**
 * Save the current channel / server state in the chat store and leave the
 * active channel via the gateway.  Used before switching into DM views.
 */
export function savePreviousChannelState() {
  const chatState = chatStoreRef?.getState();
  if (!chatState) return;

  const prevChannel = chatState.activeChannelId;
  if (prevChannel) {
    saveChannelCache(prevChannel, chatState);
    gateway.send({ type: "leave_channel", channelId: prevChannel });
  }
  saveServerCache(chatState);
}

/**
 * Clear server/channel-related fields on the chat store so the UI
 * transitions cleanly into the DM view.
 */
export function clearChatStoreForDM() {
  chatStoreRef?.setState({
    activeServerId: null,
    activeChannelId: null,
    channels: [],
    messages: [],
    reactions: {},
    searchQuery: "",
    searchFilters: {},
    searchResults: null,
  });
}

/**
 * Decrypt and filter DM search results client-side.
 * Returns only messages whose plaintext matches the query, capped at 50.
 * Also populates the shared decrypted cache for matched messages.
 */
export async function decryptAndFilterSearchResults(
  dmChannelId: string,
  otherUserId: string,
  messages: DMMessage[],
  query: string,
): Promise<DMMessage[]> {
  const cryptoState = useCryptoStore.getState();
  const key = await getDMKey(dmChannelId, otherUserId);
  const lowerQuery = query.toLowerCase();
  const matched: DMMessage[] = [];
  const decryptedBatch: Record<string, string> = {};

  for (const msg of messages) {
    const text = await cryptoState.decryptMessage(msg.ciphertext, key);
    if (text.toLowerCase().includes(lowerQuery)) {
      matched.push(msg);
      decryptedBatch[msg.id] = text;
    }
    if (matched.length >= 50) break;
  }

  // Single batched update instead of per-message setState
  if (Object.keys(decryptedBatch).length > 0) {
    chatStoreRef?.setState((s) => ({
      decryptedCache: { ...s.decryptedCache, ...decryptedBatch },
    }));
  }

  return matched;
}
