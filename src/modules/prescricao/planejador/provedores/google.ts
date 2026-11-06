/**
 * Google (Gemini) adapter (design V4 §3.2): Generative Language `generateContent` with a JSON-schema response. The key goes in the
 * `x-goog-api-key` header, NEVER in the URL (keys in URLs end up in logs and proxies). Verified ONLY against a mocked `fetch`.
 */
import { num, providerUsage } from "./errors";
import { parseJson, send } from "./http";
import { verifyIssued } from "../privacy";
import { safeModelId, type CallSettings, type ListModelsResult, type PlannerProvider, type ProviderErrorCode, type ProviderFailure, type ProviderResult, type SafeProviderRequest, type Usage } from "./port";

export const GOOGLE_BASE = "https://generativelanguage.googleapis.com";
const failure = (code: ProviderErrorCode, latencyMs = 0, usage: Usage | null = null): ProviderFailure => ({ ok: false, code, httpStatus: null, retryable: false, retryAfterMs: null, usage, latencyMs });
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const REFUSAL_FINISH = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"];

export const googleProvider: PlannerProvider = {
  kind: "google",

  async call(req: SafeProviderRequest, settings: CallSettings): Promise<ProviderResult> {
    if (settings.kind !== "google" || !(await verifyIssued(req, "google"))) return failure("BAD_REQUEST");
    const model = safeModelId(settings.modelId, "google");
    if (!model) return failure("BAD_REQUEST");
    if (!settings.apiKey) return failure("AUTH");
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [{ text: req.user }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: req.schema, maxOutputTokens: settings.maxOutputTokens },
    };
    const res = await send(
      {
        url: `${GOOGLE_BASE}/v1beta/models/${model}:generateContent`, method: "POST",
        headers: { "x-goog-api-key": settings.apiKey, "Content-Type": "application/json" }, body: JSON.stringify(body),
      },
      { fetchImpl: settings.fetchImpl, timeoutMs: settings.timeoutMs },
    );
    if (!res.ok) return { ok: false, code: res.code, httpStatus: res.httpStatus, retryable: res.retryable, retryAfterMs: res.retryAfterMs, usage: null, latencyMs: res.latencyMs };
    const parsed = parseJson(res.text);
    if (!parsed.ok) return { ...failure("INVALID_JSON", res.latencyMs), httpStatus: res.status };
    const root = rec(parsed.value);
    const meta = rec(root.usageMetadata);
    // Hidden reasoning ("thoughts") is billed as output.
    const out = num(meta.candidatesTokenCount) === null && num(meta.thoughtsTokenCount) === null ? null : (num(meta.candidatesTokenCount) ?? 0) + (num(meta.thoughtsTokenCount) ?? 0);
    const usage = providerUsage(meta.promptTokenCount, out, meta.cachedContentTokenCount);
    const withUsage = (code: ProviderErrorCode): ProviderFailure => ({ ...failure(code, res.latencyMs, usage), httpStatus: res.status });
    if (typeof rec(root.promptFeedback).blockReason === "string") return withUsage("REFUSED");
    const candidate = rec(Array.isArray(root.candidates) ? root.candidates[0] : undefined);
    const finishReason = typeof candidate.finishReason === "string" ? candidate.finishReason : null;
    if (finishReason === "MAX_TOKENS") return withUsage("TRUNCATED");
    if (finishReason && REFUSAL_FINISH.includes(finishReason)) return withUsage("REFUSED");
    const parts = rec(candidate.content).parts;
    const joined = (Array.isArray(parts) ? parts : []).map((p) => rec(p).text).filter((t): t is string => typeof t === "string").join("");
    if (joined === "") return withUsage("INVALID_JSON");
    const content = parseJson(joined);
    if (!content.ok) return withUsage("INVALID_JSON");
    return {
      ok: true, json: content.value, usage: usage ?? { inputTokens: null, outputTokens: null, cachedInputTokens: null, source: "ESTIMATE" },
      latencyMs: res.latencyMs, providerRequestId: res.headers.get("x-request-id"), finish: finishReason === "STOP" ? "STOP" : "OTHER",
    };
  },

  async listModels(apiKey: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<ListModelsResult> {
    const res = await send({ url: `${GOOGLE_BASE}/v1beta/models?pageSize=100`, method: "GET", headers: { "x-goog-api-key": apiKey } }, { fetchImpl, timeoutMs: 15_000, signal });
    if (!res.ok) return { ok: false, code: res.code, httpStatus: res.httpStatus };
    const parsed = parseJson(res.text);
    const data = parsed.ok ? rec(parsed.value).models : null;
    if (!Array.isArray(data)) return { ok: false, code: "INVALID_JSON", httpStatus: res.status };
    const models = data.map(rec)
      .filter((m) => typeof m.name === "string" && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => ({ id: (m.name as string).replace(/^models\//, ""), label: typeof m.displayName === "string" ? m.displayName : null }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ok: true, models };
  },
};
