import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveDMKey,
  encrypt,
  decrypt,
  decryptMessage,
  generateGroupKey,
  wrapGroupKey,
  unwrapGroupKey,
} from "../crypto.js";

describe("crypto", () => {
  it("generateKeyPair returns a valid ECDH P-256 key pair", async () => {
    const pair = await generateKeyPair();
    expect(pair.publicKey).toBeDefined();
    expect(pair.privateKey).toBeDefined();
    expect(pair.publicKey.algorithm).toMatchObject({ name: "ECDH" });
    expect(pair.privateKey.algorithm).toMatchObject({ name: "ECDH" });
  });

  it("exportPublicKey + importPublicKey roundtrip", async () => {
    const pair = await generateKeyPair();
    const exported = await exportPublicKey(pair.publicKey);
    expect(typeof exported).toBe("string");
    expect(exported.length).toBeGreaterThan(0);

    const imported = await importPublicKey(exported);
    expect(imported.algorithm).toMatchObject({ name: "ECDH" });

    // Re-export and compare
    const reExported = await exportPublicKey(imported);
    expect(reExported).toBe(exported);
  });

  it("encrypt then decrypt returns original plaintext", async () => {
    const key = await generateGroupKey();
    const plaintext = "Hello, E2EE world!";
    const ciphertext = await encrypt(plaintext, key);

    expect(ciphertext).not.toBe(plaintext);

    const decrypted = await decrypt(ciphertext, key);
    expect(decrypted).toBe(plaintext);
  });

  it("deriveDMKey produces same key for both parties", async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const channelId = "test-dm-channel-123";

    const aliceKey = await deriveDMKey(alice.privateKey, bob.publicKey, channelId);
    const bobKey = await deriveDMKey(bob.privateKey, alice.publicKey, channelId);

    // Both keys should encrypt/decrypt interchangeably
    const message = "secret message";
    const encrypted = await encrypt(message, aliceKey);
    const decrypted = await decrypt(encrypted, bobKey);
    expect(decrypted).toBe(message);
  });

  it("wrapGroupKey + unwrapGroupKey roundtrip", async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const groupKey = await generateGroupKey();

    // Alice wraps for Bob
    const wrapped = await wrapGroupKey(groupKey, bob.publicKey, alice.privateKey);
    expect(typeof wrapped).toBe("string");

    // Bob unwraps using Alice's public key
    const unwrapped = await unwrapGroupKey(wrapped, alice.publicKey, bob.privateKey);

    // Verify the unwrapped key works the same
    const plaintext = "group message";
    const ciphertext = await encrypt(plaintext, groupKey);
    const decrypted = await decrypt(ciphertext, unwrapped);
    expect(decrypted).toBe(plaintext);
  });

  it("decryptMessage returns error placeholder with null key", async () => {
    const result = await decryptMessage("some-ciphertext", null);
    expect(result).toBe("[encrypted message - key unavailable]");
  });

  it("decryptMessage returns error placeholder with wrong key", async () => {
    const key1 = await generateGroupKey();
    const key2 = await generateGroupKey();
    const ciphertext = await encrypt("secret", key1);

    const result = await decryptMessage(ciphertext, key2);
    expect(result).toBe("[encrypted message - decryption failed]");
  });
});
