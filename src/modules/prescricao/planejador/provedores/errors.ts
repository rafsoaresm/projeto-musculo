/** HTTP status / condition -> provider error code (design V4 §3.2 table). Pure; never reads or returns a body, key or message. */
import type { ProviderErrorCode, Usage } from "./port";

export interface Classified {
  code: ProviderErrorCode;
  retryable: boolean;
  retryAfterMs: number | null;
}
/** Retry-After above this is not worth waiting for inside one request. */
export const MAX_RETRY_AFTER_MS = 3000;

const QUOTA_WORDS = /quota|billing|insufficient|credit|exceeded your current/i;

export function retryAfterMsOf(header: string | null | undefined): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

/** `bodyText` is only searched for quota/billing wording; it is never returned. */
export function classifyHttp(status: number, bodyText: string, retryAfterHeader: string | null): Classified {
  const retryAfterMs = retryAfterMsOf(retryAfterHeader);
  if (status === 401 || status === 403) return { code: "AUTH", retryable: false, retryAfterMs: null };
  if (status === 404) return { code: "MODEL_NOT_FOUND", retryable: false, retryAfterMs: null };
  if (status === 402) return { code: "PROVIDER_QUOTA", retryable: false, retryAfterMs: null };
  const head = bodyText.slice(0, 2000);
  if (status === 408 || status === 429) {
    // OpenAI answers 429 both for a rate limit and for an exhausted account; the wording tells them apart.
    if (status === 429 && /insufficient_quota|billing|exceeded your current quota/i.test(head)) return { code: "PROVIDER_QUOTA", retryable: false, retryAfterMs: null };
    return { code: "RATE_LIMIT", retryable: retryAfterMs === null || retryAfterMs <= MAX_RETRY_AFTER_MS, retryAfterMs };
  }
  if (status === 400 || status === 422) {
    return QUOTA_WORDS.test(head) && /billing|insufficient/i.test(head)
      ? { code: "PROVIDER_QUOTA", retryable: false, retryAfterMs: null }
      : { code: "BAD_REQUEST", retryable: false, retryAfterMs: null };
  }
  if (status >= 500) return { code: "SERVER_ERROR", retryable: true, retryAfterMs };
  return { code: "UNKNOWN", retryable: false, retryAfterMs: null };
}

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export const providerUsage = (input: unknown, output: unknown, cached: unknown): Usage | null => {
  const i = num(input);
  const o = num(output);
  return i === null && o === null ? null : { inputTokens: i, outputTokens: o, cachedInputTokens: num(cached), source: "PROVIDER" };
};
