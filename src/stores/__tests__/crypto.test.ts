import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/crypto.js", () => ({
  loadKeyPair: vi.fn(),
  generateKeyPair: vi.fn(),
  storeKeyPair: vi.fn(),
  exportPublicKey: vi.fn(),
  importPublicKey: vi.fn(),
  encrypt: vi.fn(),
  decryptMessage: vi.fn(),
  generateGroupKey: vi.fn(),
  wrapGroupKey: vi.fn(),
  unwrapGroupKey: vi.fn(),
  deriveDMKey: vi.fn(),
}));

vi.mock("../../lib/api.js", () => ({
  setPublicKey: vi.fn(),
  getPublicKey: vi.fn(),
  getMyServerKey: vi.fn(),
  storeServerKey: vi.fn(),
  shareServerKeyWith: vi.fn(),
  getStoredToken: vi.fn(() => null),
  setStoredToken: vi.fn(),
}));

vi.mock("../../lib/ws.js", () => ({
  gateway: { send: vi.fn(), on: vi.fn(() => () => {}), connect: vi.fn() },
}));

vi.mock("../chat.js", () => ({
  useChatStore: { getState: () => ({ servers: [] }) },
}));

import { useCryptoStore } from "../crypto.js";
import * as cryptoLib from "../../lib/crypto.js";
import * as api from "../../lib/api.js";
import { gateway } from "../../lib/ws.js";

const mockedCrypto = vi.mocked(cryptoLib);
const mockedApi = vi.mocked(api);
const mockedGateway = vi.mocked(gateway);

describe("useCryptoStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCryptoStore.setState({
      keyPair: null,
      publicKeyBase64: null,
      serverKeys: {},
      dmKeys: {},
      pendingServers: new Set(),
      initialized: false,
    });
  });

  it("initial state has null keyPair, null publicKeyBase64, empty serverKeys", () => {
    const state = useCryptoStore.getState();
    expect(state.keyPair).toBeNull();
    expect(state.publicKeyBase64).toBeNull();
    expect(state.serverKeys).toEqual({});
    expect(state.dmKeys).toEqual({});
    expect(state.pendingServers.size).toBe(0);
    expect(state.initialized).toBe(false);
  });

  it("getServerKey returns null for unknown server", () => {
    const key = useCryptoStore.getState().getServerKey("unknown-server");
    expect(key).toBeNull();
  });

  it("setServerKey stores key and removes from pending", () => {
    const mockKey = {} as CryptoKey;
    useCryptoStore.setState({ pendingServers: new Set(["server-1"]) });

    useCryptoStore.getState().setServerKey("server-1", mockKey);

    const state = useCryptoStore.getState();
    expect(state.serverKeys["server-1"]).toBe(mockKey);
    expect(state.pendingServers.has("server-1")).toBe(false);
  });

  it("requestServerKey adds to pending and sends WS message", () => {
    useCryptoStore.getState().requestServerKey("server-1");

    expect(useCryptoStore.getState().pendingServers.has("server-1")).toBe(true);
    expect(mockedGateway.send).toHaveBeenCalledWith({
      type: "request_server_key",
      serverId: "server-1",
    });
  });

  it("initialize loads existing keypair", async () => {
    const mockKeyPair = {
      publicKey: {} as CryptoKey,
      privateKey: {} as CryptoKey,
    };
    mockedCrypto.loadKeyPair.mockResolvedValue(mockKeyPair);
    mockedCrypto.exportPublicKey.mockResolvedValue("base64pubkey");
    mockedApi.setPublicKey.mockResolvedValue(undefined);

    await useCryptoStore.getState().initialize();

    expect(mockedCrypto.loadKeyPair).toHaveBeenCalled();
    expect(mockedCrypto.generateKeyPair).not.toHaveBeenCalled();
    expect(useCryptoStore.getState().keyPair).toBe(mockKeyPair);
    expect(useCryptoStore.getState().publicKeyBase64).toBe("base64pubkey");
    expect(useCryptoStore.getState().initialized).toBe(true);
  });

  it("initialize generates new keypair when none exists", async () => {
    const mockKeyPair = {
      publicKey: {} as CryptoKey,
      privateKey: {} as CryptoKey,
    };
    mockedCrypto.loadKeyPair.mockResolvedValue(null);
    mockedCrypto.generateKeyPair.mockResolvedValue(mockKeyPair);
    mockedCrypto.storeKeyPair.mockResolvedValue(undefined);
    mockedCrypto.exportPublicKey.mockResolvedValue("base64pubkey");
    mockedApi.setPublicKey.mockResolvedValue(undefined);

    await useCryptoStore.getState().initialize();

    expect(mockedCrypto.generateKeyPair).toHaveBeenCalled();
    expect(mockedCrypto.storeKeyPair).toHaveBeenCalledWith(mockKeyPair);
    expect(useCryptoStore.getState().keyPair).toBe(mockKeyPair);
  });

  it("initialize uploads public key", async () => {
    const mockKeyPair = {
      publicKey: {} as CryptoKey,
      privateKey: {} as CryptoKey,
    };
    mockedCrypto.loadKeyPair.mockResolvedValue(mockKeyPair);
    mockedCrypto.exportPublicKey.mockResolvedValue("base64pubkey");
    mockedApi.setPublicKey.mockResolvedValue(undefined);

    await useCryptoStore.getState().initialize();

    expect(mockedApi.setPublicKey).toHaveBeenCalledWith("base64pubkey");
  });

  it("encryptMessage calls crypto.encrypt", async () => {
    const mockKey = {} as CryptoKey;
    mockedCrypto.encrypt.mockResolvedValue("encrypted-text");

    const result = await useCryptoStore
      .getState()
      .encryptMessage("hello", mockKey);

    expect(mockedCrypto.encrypt).toHaveBeenCalledWith("hello", mockKey);
    expect(result).toBe("encrypted-text");
  });

  it("decryptMessage calls crypto.decryptMessage", async () => {
    const mockKey = {} as CryptoKey;
    mockedCrypto.decryptMessage.mockResolvedValue("decrypted-text");

    const result = await useCryptoStore
      .getState()
      .decryptMessage("ciphertext", mockKey);

    expect(mockedCrypto.decryptMessage).toHaveBeenCalledWith(
      "ciphertext",
      mockKey,
    );
    expect(result).toBe("decrypted-text");
  });

  it("handleKeyShared unwraps key and stores it", async () => {
    const mockKeyPair = {
      publicKey: {} as CryptoKey,
      privateKey: {} as CryptoKey,
    };
    useCryptoStore.setState({
      keyPair: mockKeyPair,
      pendingServers: new Set(["server-1"]),
    });

    const senderPub = {} as CryptoKey;
    const groupKey = {} as CryptoKey;
    mockedApi.getPublicKey.mockResolvedValue({ publicKey: "sender-pub-b64" });
    mockedCrypto.importPublicKey.mockResolvedValue(senderPub);
    mockedCrypto.unwrapGroupKey.mockResolvedValue(groupKey);

    await useCryptoStore
      .getState()
      .handleKeyShared("server-1", "encrypted-key-data", "sender-id");

    expect(mockedApi.getPublicKey).toHaveBeenCalledWith("sender-id");
    expect(mockedCrypto.importPublicKey).toHaveBeenCalledWith("sender-pub-b64");
    expect(mockedCrypto.unwrapGroupKey).toHaveBeenCalledWith(
      "encrypted-key-data",
      senderPub,
      mockKeyPair.privateKey,
    );
    expect(useCryptoStore.getState().serverKeys["server-1"]).toBe(groupKey);
    expect(useCryptoStore.getState().pendingServers.has("server-1")).toBe(false);
  });
});
