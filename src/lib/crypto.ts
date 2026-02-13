// End-to-end encryption module using Web Crypto API
// ECDH P-256 for key exchange, AES-256-GCM for message encryption
import { base64ToUtf8 } from "../stores/chat.js";

const DB_NAME = "flux-crypto";
const STORE_NAME = "keys";
const IDENTITY_KEY = "identity";

// ── IndexedDB helpers ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Key pair generation & storage ──

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, // extractable (needed for JWK export/import)
    ["deriveKey", "deriveBits"],
  );
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return btoa(JSON.stringify(jwk));
}

export async function importPublicKey(base64: string): Promise<CryptoKey> {
  const jwk = JSON.parse(atob(base64));
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

export async function storeKeyPair(pair: CryptoKeyPair): Promise<void> {
  const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const db = await openDB();
  await idbPut(db, IDENTITY_KEY, { publicKey: pubJwk, privateKey: privJwk });
  db.close();
}

export async function loadKeyPair(): Promise<CryptoKeyPair | null> {
  const db = await openDB();
  const stored = await idbGet<{ publicKey: JsonWebKey; privateKey: JsonWebKey }>(db, IDENTITY_KEY);
  db.close();
  if (!stored) return null;

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    stored.publicKey,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    stored.privateKey,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
  return { publicKey, privateKey };
}

// ── DM key derivation ──

export async function deriveDMKey(
  myPrivate: CryptoKey,
  theirPublic: CryptoKey,
  dmChannelId: string,
): Promise<CryptoKey> {
  // Step 1: ECDH → raw shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublic },
    myPrivate,
    256,
  );

  // Step 2: Import as HKDF key material
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveKey"],
  );

  // Step 3: HKDF → AES-256-GCM key
  const encoder = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(dmChannelId),
      info: encoder.encode("flux-dm"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

// ── Server group key ──

export async function generateGroupKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function exportGroupKey(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", key);
}

export async function importGroupKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

// ── Group key wrapping (ECDH + AES-GCM wrap) ──

async function deriveWrappingKey(
  myPrivate: CryptoKey,
  theirPublic: CryptoKey,
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: theirPublic },
    myPrivate,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("flux-server-key-wrap"),
      info: new TextEncoder().encode("flux-wrap"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function wrapGroupKey(
  groupKey: CryptoKey,
  recipientPublic: CryptoKey,
  myPrivate: CryptoKey,
): Promise<string> {
  const wrappingKey = await deriveWrappingKey(myPrivate, recipientPublic);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey("raw", groupKey, wrappingKey, {
    name: "AES-GCM",
    iv,
  });
  // Format: base64(iv + wrappedKey)
  const combined = new Uint8Array(iv.length + wrapped.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(wrapped), iv.length);
  return bufToBase64(combined);
}

export async function unwrapGroupKey(
  wrapped: string,
  senderPublic: CryptoKey,
  myPrivate: CryptoKey,
): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey(myPrivate, senderPublic);
  const data = base64ToBuf(wrapped);
  const iv = data.slice(0, 12);
  const wrappedKey = data.slice(12);
  return crypto.subtle.unwrapKey(
    "raw",
    wrappedKey,
    wrappingKey,
    { name: "AES-GCM", iv },
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

// ── Message encrypt/decrypt ──

export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  // Format: base64(iv + ciphertext_with_tag)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bufToBase64(combined);
}

export async function decrypt(ciphertext: string, key: CryptoKey): Promise<string> {
  const data = base64ToBuf(ciphertext);
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted,
  );
  return new TextDecoder().decode(decrypted);
}

/** Decrypt a message, handling legacy base64 (mlsEpoch 0) and encrypted (mlsEpoch >= 1) */
export async function decryptMessage(
  ciphertext: string,
  key: CryptoKey | null,
  mlsEpoch: number,
): Promise<string> {
  if (mlsEpoch === 0) {
    try {
      return base64ToUtf8(ciphertext);
    } catch {
      return "[unreadable message]";
    }
  }
  if (!key) return "[encrypted message - key unavailable]";
  try {
    return await decrypt(ciphertext, key);
  } catch {
    return "[encrypted message - decryption failed]";
  }
}

// ── Voice key export ──

export async function exportKeyAsBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufToBase64(new Uint8Array(raw));
}

// ── Base64 <-> ArrayBuffer helpers ──

function bufToBase64(buf: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf;
}
