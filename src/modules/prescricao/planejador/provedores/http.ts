/**
 * The one place that talks HTTP for the three adapters (design V4 §3.2): global `fetch` only (injectable for tests), an AbortController
 * with the call's timeout, a body cap, and no logging of any kind. A timeout is `TIMEOUT`; a throwing fetch is `NETWORK`.
 * The URL, headers and body are never put in an error: results carry codes only.
 */
import { classifyHttp, type Classified } from "./errors";
import { MAX_RESPONSE_BYTES, type ProviderErrorCode } from "./port";

export type HttpOutcome =
  | { ok: true; status: number; text: string; headers: Headers; latencyMs: number }
  | { ok: false; code: ProviderErrorCode; httpStatus: number | null; retryable: boolean; retryAfterMs: number | null; latencyMs: number };

export interface HttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

const MAX_TIMEOUT_MS = 120_000;

export async function send(req: HttpRequest, options: { fetchImpl?: typeof fetch; timeoutMs: number; signal?: AbortSignal; now?: () => number }): Promise<HttpOutcome> {
  const clock = options.now ?? Date.now;
  const started = clock();
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(MAX_TIMEOUT_MS, options.timeoutMs));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  // A fetch that ignores the signal must not hang the request: the abort also rejects this promise.
  const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("ABORT")), { once: true }));
  aborted.catch(() => undefined);
  if (options.signal?.aborted) controller.abort();
  const fail = (code: ProviderErrorCode, retryable: boolean, httpStatus: number | null = null, retryAfterMs: number | null = null): HttpOutcome => ({
    ok: false, code, httpStatus, retryable, retryAfterMs, latencyMs: Math.max(0, clock() - started),
  });
  try {
    const f = options.fetchImpl ?? ((u: string, i?: RequestInit) => globalThis.fetch(u, i));
    const init: RequestInit = { method: req.method, headers: req.headers, signal: controller.signal, ...(req.body !== undefined ? { body: req.body } : {}) };
    const res = await Promise.race([f(req.url, init), aborted]);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return fail("INVALID_JSON", false, res.status);
    const text = await Promise.race([res.text(), aborted]);
    if (text.length > MAX_RESPONSE_BYTES) return fail("INVALID_JSON", false, res.status);
    if (!res.ok) {
      const c: Classified = classifyHttp(res.status, text, res.headers.get("retry-after"));
      return fail(c.code, c.retryable, res.status, c.retryAfterMs);
    }
    return { ok: true, status: res.status, text, headers: res.headers, latencyMs: Math.max(0, clock() - started) };
  } catch {
    // Aborted by our timer (TIMEOUT: the usage is unknown, the caller charges the estimate), aborted by the caller (also TIMEOUT-shaped), or fetch threw (NETWORK).
    if (timedOut || controller.signal.aborted) return fail("TIMEOUT", false);
    return fail("NETWORK", true);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
