/**
 * Provider API keys at rest (design V4 §3.4, §3.7): AES-256-GCM through WebCrypto with a server secret (`AI_SECRETS_KEY`).
 * Pure: no `server-only`, database or network, so tests run in Node and the Worker runs the very same code.
 *
 * Stored value = base64url(iv12 || ciphertext || tag16). The AAD binds a ciphertext to its provider kind (`ai-key:v1:<kind>`), so a
 * ciphertext copied from one row to another does not decrypt. A key is write-only: nothing here returns it except `openSecret`,
 * which only the single server-side reader of the ciphertext (`aiSystemFor`) calls, right before a provider request.
 * No function logs anything; errors carry a code, never key material.
 */

export type SecretsErrorCode = "KEY_MISSING" | "KEY_INVALID" | "INPUT_INVALID" | "DECRYPT_FAILED";
export class SecretsError extends Error {
  constructor(readonly code: SecretsErrorCode) {
    super(code);
    this.name = "SecretsError";
  }
}

export interface MasterKey {
  id: string;
  /** base64url of 32 random bytes. */
  key: string;
}
export interface SecretsConfig {
  current: MasterKey;
  /** Decrypt-only key kept during a rotation; a re-save re-encrypts with `current`. */
  previous?: MasterKey;
}
export interface SealedSecret {
  ciphertext: string;
  keyId: string;
  /** Last characters of the key, the only fragment ever shown. */
  last4: string;
}

const IV_BYTES = 12;
const KEY_ID = /^[A-Za-z0-9._-]{1,20}$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SecretsError("INPUT_INVALID");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Reads `AI_SECRETS_KEY*` (through the injected reader). Null when the current key is absent or malformed: nothing can be stored then. */
export function secretsConfigFrom(read: (name: string) => string | undefined): SecretsConfig | null {
  const current = masterKey(read("AI_SECRETS_KEY"), read("AI_SECRETS_KEY_ID") ?? "k1");
  if (!current) return null;
  const previous = masterKey(read("AI_SECRETS_KEY_PREVIOUS"), read("AI_SECRETS_KEY_PREVIOUS_ID") ?? "k0");
  return previous && previous.id !== current.id ? { current, previous } : { current };
}
function masterKey(key: string | undefined, id: string): MasterKey | null {
  const k = key?.trim();
  if (!k || !KEY_ID.test(id)) return null;
  try {
    return fromBase64Url(k).length === 32 ? { id, key: k } : null;
  } catch {
    return null;
  }
}

/** A key as typed by the gestor: one token, printable, no spaces, 8..512 characters. */
export function validApiKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length >= 8 && key.length <= 512 && /^[\x21-\x7e]+$/.test(key) ? key : null;
}

const aadOf = (kind: string) => new TextEncoder().encode(`ai-key:v1:${kind}`);
async function importKey(master: MasterKey): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64Url(master.key);
  } catch {
    throw new SecretsError("KEY_INVALID");
  }
  if (raw.length !== 32) throw new SecretsError("KEY_INVALID");
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts a provider key with the CURRENT master key. A fresh random IV per call. */
export async function sealSecret(apiKey: unknown, kind: string, config: SecretsConfig | null): Promise<SealedSecret> {
  if (!config) throw new SecretsError("KEY_MISSING");
  const key = validApiKey(apiKey);
  if (!key) throw new SecretsError("INPUT_INVALID");
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aadOf(kind) as BufferSource }, await importKey(config.current), new TextEncoder().encode(key) as BufferSource),
  );
  const joined = new Uint8Array(IV_BYTES + sealed.length);
  joined.set(iv, 0);
  joined.set(sealed, IV_BYTES);
  return { ciphertext: toBase64Url(joined), keyId: config.current.id, last4: key.slice(-4) };
}

/** Decrypts with the master key whose id was stored; the previous key serves a rotation. Any failure is `DECRYPT_FAILED` (never why). */
export async function openSecret(stored: { ciphertext: string; keyId: string }, kind: string, config: SecretsConfig | null): Promise<string> {
  if (!config) throw new SecretsError("KEY_MISSING");
  const master = stored.keyId === config.current.id ? config.current : config.previous && stored.keyId === config.previous.id ? config.previous : null;
  if (!master) throw new SecretsError("DECRYPT_FAILED");
  try {
    const bytes = fromBase64Url(stored.ciphertext);
    if (bytes.length < IV_BYTES + 16 + 1) throw new SecretsError("DECRYPT_FAILED");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES) as BufferSource, additionalData: aadOf(kind) as BufferSource },
      await importKey(master),
      bytes.slice(IV_BYTES) as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new SecretsError("DECRYPT_FAILED");
  }
}

/** "••••abcd": the masked tail shown in the panel. */
export const maskTail = (last4: string): string => `••••${last4.slice(-4)}`;
