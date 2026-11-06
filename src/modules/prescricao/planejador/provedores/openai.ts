/**
 * OpenAI adapter (design V4 §3.2): Chat Completions with a strict JSON-schema response. Global fetch only, base URL a constant (no env
 * override: a configurable host would let a mistaken variable send the key elsewhere), key in `Authorization: Bearer`.
 * No temperature/top_p/user/metadata is sent. Verified ONLY against a mocked `fetch`; the first real call is a pending item (docs/PENDENCIAS.md).
 */
import { providerUsage } from "./errors";
import { parseJson, send } from "./http";
import { verifyIssued } from "../privacy";
import { safeModelId, type CallSettings, type ListModelsResult, type PlannerProvider, type ProviderErrorCode, type ProviderFailure, type ProviderResult, type SafeProviderRequest, type Usage } from "./port";

export const OPENAI_BASE = "https://api.openai.com";
const failure = (code: ProviderErrorCode, latencyMs = 0, usage: Usage | null = null): ProviderFailure => ({ ok: false, code, httpStatus: null, retryable: false, retryAfterMs: null, usage, latencyMs });
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const openaiProvider: PlannerProvider = {
  kind: "openai",

  async call(req: SafeProviderRequest, settings: CallSettings): Promise<ProviderResult> {
    if (settings.kind !== "openai" || !(await verifyIssued(req, "openai"))) return failure("BAD_REQUEST");
    const model = safeModelId(settings.modelId, "openai");
    if (!model) return failure("BAD_REQUEST");
    if (!settings.apiKey) return failure("AUTH");
    const body = {
      model,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      max_completion_tokens: settings.maxOutputTokens,
      response_format: { type: "json_schema", json_schema: { name: req.schemaName, strict: true, schema: req.schema } },
    };
    const res = await send(
      { url: `${OPENAI_BASE}/v1/chat/completions`, method: "POST", headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
      { fetchImpl: settings.fetchImpl, timeoutMs: settings.timeoutMs },
    );
    if (!res.ok) return { ok: false, code: res.code, httpStatus: res.httpStatus, retryable: res.retryable, retryAfterMs: res.retryAfterMs, usage: null, latencyMs: res.latencyMs };
    const parsed = parseJson(res.text);
    if (!parsed.ok) return { ...failure("INVALID_JSON", res.latencyMs), httpStatus: res.status };
    const root = rec(parsed.value);
    const usageRaw = rec(root.usage);
    const usage = providerUsage(usageRaw.prompt_tokens, usageRaw.completion_tokens, rec(usageRaw.prompt_tokens_details).cached_tokens);
    const choice = rec(Array.isArray(root.choices) ? root.choices[0] : undefined);
    const message = rec(choice.message);
    const withUsage = (code: ProviderErrorCode): ProviderFailure => ({ ...failure(code, res.latencyMs, usage), httpStatus: res.status });
    if (typeof message.refusal === "string" && message.refusal !== "") return withUsage("REFUSED");
    if (choice.finish_reason === "length") return withUsage("TRUNCATED");
    if (choice.finish_reason === "content_filter") return withUsage("REFUSED");
    if (typeof message.content !== "string") return withUsage("INVALID_JSON");
    const content = parseJson(message.content);
    if (!content.ok) return withUsage("INVALID_JSON");
    return {
      ok: true, json: content.value, usage: usage ?? { inputTokens: null, outputTokens: null, cachedInputTokens: null, source: "ESTIMATE" },
      latencyMs: res.latencyMs, providerRequestId: res.headers.get("x-request-id"), finish: choice.finish_reason === "stop" ? "STOP" : "OTHER",
    };
  },

  async listModels(apiKey: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<ListModelsResult> {
    const res = await send({ url: `${OPENAI_BASE}/v1/models`, method: "GET", headers: { Authorization: `Bearer ${apiKey}` } }, { fetchImpl, timeoutMs: 15_000, signal });
    if (!res.ok) return { ok: false, code: res.code, httpStatus: res.httpStatus };
    const parsed = parseJson(res.text);
    const data = parsed.ok ? rec(parsed.value).data : null;
    if (!Array.isArray(data)) return { ok: false, code: "INVALID_JSON", httpStatus: res.status };
    const models = data.map((m) => rec(m).id).filter((id): id is string => typeof id === "string" && id !== "").sort().map((id) => ({ id, label: null }));
    return { ok: true, models };
  },
};
