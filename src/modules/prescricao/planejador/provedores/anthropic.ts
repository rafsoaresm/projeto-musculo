/**
 * Anthropic adapter (design V4 §3.2): Messages API with a forced tool call whose `input_schema` is the response schema.
 * Key in `x-api-key`, `anthropic-version: 2023-06-01`. Verified ONLY against a mocked `fetch`.
 */
import { providerUsage } from "./errors";
import { parseJson, send } from "./http";
import { verifyIssued } from "../privacy";
import { safeModelId, type CallSettings, type ListModelsResult, type PlannerProvider, type ProviderErrorCode, type ProviderFailure, type ProviderResult, type SafeProviderRequest, type Usage } from "./port";

export const ANTHROPIC_BASE = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
const failure = (code: ProviderErrorCode, latencyMs = 0, usage: Usage | null = null): ProviderFailure => ({ ok: false, code, httpStatus: null, retryable: false, retryAfterMs: null, usage, latencyMs });
const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const anthropicProvider: PlannerProvider = {
  kind: "anthropic",

  async call(req: SafeProviderRequest, settings: CallSettings): Promise<ProviderResult> {
    if (settings.kind !== "anthropic" || !(await verifyIssued(req, "anthropic"))) return failure("BAD_REQUEST");
    const model = safeModelId(settings.modelId, "anthropic");
    if (!model) return failure("BAD_REQUEST");
    if (!settings.apiKey) return failure("AUTH");
    const body = {
      model,
      max_tokens: settings.maxOutputTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      tools: [{ name: req.schemaName, description: "Return the plan.", input_schema: req.schema }],
      tool_choice: { type: "tool", name: req.schemaName },
    };
    const res = await send(
      {
        url: `${ANTHROPIC_BASE}/v1/messages`, method: "POST",
        headers: { "x-api-key": settings.apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { fetchImpl: settings.fetchImpl, timeoutMs: settings.timeoutMs },
    );
    if (!res.ok) return { ok: false, code: res.code, httpStatus: res.httpStatus, retryable: res.retryable, retryAfterMs: res.retryAfterMs, usage: null, latencyMs: res.latencyMs };
    const parsed = parseJson(res.text);
    if (!parsed.ok) return { ...failure("INVALID_JSON", res.latencyMs), httpStatus: res.status };
    const root = rec(parsed.value);
    const u = rec(root.usage);
    const usage = providerUsage(u.input_tokens, u.output_tokens, u.cache_read_input_tokens);
    const withUsage = (code: ProviderErrorCode): ProviderFailure => ({ ...failure(code, res.latencyMs, usage), httpStatus: res.status });
    if (root.stop_reason === "max_tokens") return withUsage("TRUNCATED");
    if (root.stop_reason === "refusal") return withUsage("REFUSED");
    const block = (Array.isArray(root.content) ? root.content : []).map(rec).find((b) => b.type === "tool_use");
    if (!block || typeof block.input !== "object" || block.input === null) return withUsage("INVALID_JSON");
    return {
      ok: true, json: block.input, usage: usage ?? { inputTokens: null, outputTokens: null, cachedInputTokens: null, source: "ESTIMATE" },
      latencyMs: res.latencyMs, providerRequestId: res.headers.get("request-id"), finish: root.stop_reason === "tool_use" || root.stop_reason === "end_turn" ? "STOP" : "OTHER",
    };
  },

  async listModels(apiKey: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<ListModelsResult> {
    const res = await send(
      { url: `${ANTHROPIC_BASE}/v1/models?limit=100`, method: "GET", headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION } },
      { fetchImpl, timeoutMs: 15_000, signal },
    );
    if (!res.ok) return { ok: false, code: res.code, httpStatus: res.httpStatus };
    const parsed = parseJson(res.text);
    const data = parsed.ok ? rec(parsed.value).data : null;
    if (!Array.isArray(data)) return { ok: false, code: "INVALID_JSON", httpStatus: res.status };
    const models = data.map(rec).filter((m) => typeof m.id === "string" && m.id !== "")
      .map((m) => ({ id: m.id as string, label: typeof m.display_name === "string" ? m.display_name : null }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ok: true, models };
  },
};
