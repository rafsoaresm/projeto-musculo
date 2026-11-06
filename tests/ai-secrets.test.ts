import { describe, expect, it } from "vitest";
import { fromBase64Url, maskTail, openSecret, sealSecret, SecretsError, secretsConfigFrom, toBase64Url, validApiKey, type SecretsConfig } from "@/modules/prescricao/planejador/secrets";
import { resolveAiEnv } from "@/modules/prescricao/planejador/config";

// Provider keys at rest (design V4 §3.4): AES-256-GCM, server secret, AAD per provider, rotation, masked tail. Pure (WebCrypto in Node).
const K1 = toBase64Url(new Uint8Array(32).fill(7));
const K2 = toBase64Url(new Uint8Array(32).fill(9));
const config = (over: Partial<SecretsConfig> = {}): SecretsConfig => ({ current: { id: "k1", key: K1 }, ...over });
const KEY = "sk-test-CANARY-0123456789abcdef";

describe("sealing a provider key", () => {
  it("round trips and shows only the last four characters", async () => {
    const sealed = await sealSecret(KEY, "openai", config());
    expect(sealed.last4).toBe("cdef");
    expect(maskTail(sealed.last4)).toBe("••••cdef");
    expect(sealed.keyId).toBe("k1");
    expect(await openSecret(sealed, "openai", config())).toBe(KEY);
  });

  it("never contains the plaintext, nor its base64 or base64url, and differs on every call (random IV)", async () => {
    const a = await sealSecret(KEY, "openai", config());
    const b = await sealSecret(KEY, "openai", config());
    expect(a.ciphertext).not.toBe(b.ciphertext);
    for (const text of [a.ciphertext, b.ciphertext]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(btoa(KEY));
      expect(text).not.toContain(toBase64Url(new TextEncoder().encode(KEY)));
      expect(text).not.toContain("CANARY");
      expect(text.length).toBeGreaterThanOrEqual(40);
      expect(text.length).toBeLessThanOrEqual(4096);
    }
  });

  it("is bound to its provider: a ciphertext moved to another kind does not open (AAD)", async () => {
    const sealed = await sealSecret(KEY, "openai", config());
    await expect(openSecret(sealed, "anthropic", config())).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("fails on one flipped byte, a truncated value and a foreign master key, always with the same code", async () => {
    const sealed = await sealSecret(KEY, "google", config());
    const bytes = fromBase64Url(sealed.ciphertext);
    bytes[bytes.length - 1] ^= 1;
    await expect(openSecret({ ...sealed, ciphertext: toBase64Url(bytes) }, "google", config())).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    await expect(openSecret({ ...sealed, ciphertext: sealed.ciphertext.slice(0, 20) }, "google", config())).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    await expect(openSecret(sealed, "google", { current: { id: "k1", key: K2 } })).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    await expect(openSecret({ ...sealed, ciphertext: "not base64 !!" }, "google", config())).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
  });

  it("rotates: the previous key still opens, a re-save uses the current id", async () => {
    const old = await sealSecret(KEY, "openai", config());
    const rotated: SecretsConfig = { current: { id: "k2", key: K2 }, previous: { id: "k1", key: K1 } };
    expect(await openSecret(old, "openai", rotated)).toBe(KEY);
    const again = await sealSecret(KEY, "openai", rotated);
    expect(again.keyId).toBe("k2");
    await expect(openSecret(again, "openai", config())).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    expect(await openSecret(again, "openai", rotated)).toBe(KEY);
  });

  it("without a master key nothing is stored and nothing is read", async () => {
    await expect(sealSecret(KEY, "openai", null)).rejects.toMatchObject({ code: "KEY_MISSING" });
    await expect(openSecret({ ciphertext: "x".repeat(60), keyId: "k1" }, "openai", null)).rejects.toMatchObject({ code: "KEY_MISSING" });
  });

  it("refuses keys that are not one printable token", async () => {
    for (const bad of ["", "short", "has space inside-key", "tab\tkey-12345678", "x".repeat(513), 42, null, undefined]) {
      await expect(sealSecret(bad, "openai", config())).rejects.toBeInstanceOf(SecretsError);
    }
    expect(validApiKey("  sk-abcdefgh  ")).toBe("sk-abcdefgh");
  });

  it("errors carry a code and never the key", async () => {
    try {
      await sealSecret("bad key with spaces CANARY", "openai", config());
    } catch (error) {
      expect(String(error)).not.toContain("CANARY");
      expect((error as SecretsError).message).toBe("INPUT_INVALID");
    }
  });
});

describe("the master key from the environment", () => {
  it("needs 32 bytes of base64url; anything else means 'cannot save keys yet'", () => {
    const read = (map: Record<string, string>) => (name: string) => map[name];
    expect(secretsConfigFrom(read({}))).toBeNull();
    expect(secretsConfigFrom(read({ AI_SECRETS_KEY: "short" }))).toBeNull();
    expect(secretsConfigFrom(read({ AI_SECRETS_KEY: toBase64Url(new Uint8Array(31)) }))).toBeNull();
    expect(secretsConfigFrom(read({ AI_SECRETS_KEY: "!!!" }))).toBeNull();
    expect(secretsConfigFrom(read({ AI_SECRETS_KEY: K1 }))).toEqual({ current: { id: "k1", key: K1 } });
    expect(secretsConfigFrom(read({ AI_SECRETS_KEY: K1, AI_SECRETS_KEY_ID: "prod-2", AI_SECRETS_KEY_PREVIOUS: K2 }))).toEqual({
      current: { id: "prod-2", key: K1 },
      previous: { id: "k0", key: K2 },
    });
    expect(secretsConfigFrom(read({ AI_SECRETS_KEY: K1, AI_SECRETS_KEY_ID: "bad id!" }))).toBeNull();
  });

  it("resolves the other variables with ceilings and defaults; the kill switch fails closed", () => {
    const read = (map: Record<string, string>) => (name: string) => map[name];
    const base = resolveAiEnv(read({}));
    expect(base).toMatchObject({ killSwitch: false, mockEnabled: false, hardTimeoutMs: 25_000, hardMaxOutputTokens: 8192, cacheTtlDays: 14, secrets: null });
    expect(resolveAiEnv(read({ AI_PLANNER_DISABLED: "true" })).killSwitch).toBe(true);
    for (const on of ["1", "TRUE", "yes", " true ", "anything"]) expect(resolveAiEnv(read({ AI_PLANNER_DISABLED: on })).killSwitch, on).toBe(true);
    for (const off of ["", "  ", "false", "0", "no", "OFF"]) expect(resolveAiEnv(read({ AI_PLANNER_DISABLED: off })).killSwitch, off).toBe(false);
    expect(resolveAiEnv(read({ AI_MOCK_ENABLED: "true" })).mockEnabled).toBe(true);
    expect(resolveAiEnv(read({ AI_CACHE_TTL_DAYS: "999" })).cacheTtlDays).toBe(14);
    expect(resolveAiEnv(read({ AI_CACHE_TTL_DAYS: "30" })).cacheTtlDays).toBe(30);
    expect(resolveAiEnv(read({ AI_HARD_TIMEOUT_MS: "100" })).hardTimeoutMs).toBe(25_000);
    expect(resolveAiEnv(read({ AI_HARD_MAX_OUTPUT_TOKENS: "4096" })).hardMaxOutputTokens).toBe(4096);
  });
});
