import { describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@/modules/prescricao/motor/hash";
import { plannerResponseSchema } from "@/modules/prescricao/planejador/blueprint";
import { validatePlannerResponse } from "@/modules/prescricao/planejador/blueprint-validate";
import type { PlanningContextBundle } from "@/modules/prescricao/planejador/context-types";
import { buildProviderPayload, fixedTokens, scanPatterns, scanPayload } from "@/modules/prescricao/planejador/privacy";
import { MODEL_TEST_SCHEMA, MODEL_TEST_SCHEMA_NAME, MODEL_TEST_SYSTEM_PROMPT, MODEL_TEST_USER, PLANNER_SCHEMA_NAME, PLANNER_SYSTEM_PROMPT, plannerUserMessage } from "@/modules/prescricao/planejador/prompt";
import { anthropicProvider, ANTHROPIC_BASE } from "@/modules/prescricao/planejador/provedores/anthropic";
import { googleProvider, GOOGLE_BASE } from "@/modules/prescricao/planejador/provedores/google";
import { MOCK_MODELS, mockPlan, mockProvider } from "@/modules/prescricao/planejador/provedores/mock";
import { openaiProvider, OPENAI_BASE } from "@/modules/prescricao/planejador/provedores/openai";
import { callWithPolicy } from "@/modules/prescricao/planejador/provedores/policy";
import { safeModelId, type CallSettings, type PlannerProvider, type ProviderKind, type ProviderResult, type SafeProviderRequest, type Usage } from "@/modules/prescricao/planejador/provedores/port";
import { providerFor } from "@/modules/prescricao/planejador/provedores/registry";
import { STRIPPED, keywordInventory, toWireSchema } from "@/modules/prescricao/planejador/provedores/wire-schema";
import { ROLE_FOCUS_INTERIM_TABLE } from "@/modules/prescricao/planejador/role-focus";
import { PLANNER_PROMPT_VERSION, ROLE_FOCUS_INTERIM } from "@/modules/prescricao/planejador/versions";
import { CANARY, canaryBundle, xintusBundle } from "./helpers/planning-fixtures";

// The three real adapters (OpenAI, Anthropic, Google) and the mock, against a MOCKED fetch only. Nothing here reaches a network: the request
// shapes below are written from the documented APIs and are NOT verified against the live services (first real call = pending item).
const KEY = "sk-test-CANARY-0123456789abcdef";
const REAL = ["openai", "anthropic", "google"] as const;
const PROVIDERS: Record<(typeof REAL)[number], PlannerProvider> = { openai: openaiProvider, anthropic: anthropicProvider, google: googleProvider };
const wire = (kind: ProviderKind) => toWireSchema(plannerResponseSchema, kind);

const memo = new Map<string, Promise<SafeProviderRequest>>();
let xintus: Promise<PlanningContextBundle> | null = null;
function requestFor(kind: ProviderKind, bundle?: PlanningContextBundle): Promise<SafeProviderRequest> {
  if (bundle) return buildRequest(kind, bundle);
  xintus ??= xintusBundle();
  if (!memo.has(kind)) memo.set(kind, xintus.then((b) => buildRequest(kind, b)));
  return memo.get(kind)!;
}
async function buildRequest(kind: ProviderKind, b: PlanningContextBundle): Promise<SafeProviderRequest> {
  return buildProviderPayload("PLANNER", { kind, system: PLANNER_SYSTEM_PROMPT, user: plannerUserMessage(b.context), schema: wire(kind), schemaName: PLANNER_SCHEMA_NAME, vocabularySchemas: [wire(kind)] }, b.denyList);
}
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit; body: string | null; headers: Record<string, string> }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const i = init ?? {};
    calls.push({ url: String(url), init: i, body: typeof i.body === "string" ? i.body : null, headers: { ...(i.headers as Record<string, string>) } });
    return handler(String(url), i);
  });
  return { impl: impl as unknown as typeof fetch, calls, spy: impl };
}
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const settings = (kind: ProviderKind, f: ReturnType<typeof fakeFetch>, over: Partial<CallSettings> = {}): CallSettings => ({
  kind, modelId: "any-model-1", maxOutputTokens: 2048, timeoutMs: 2000, apiKey: KEY, fetchImpl: f.impl, ...over,
});
const PLAN = { ok: true, strategies: ["S1"] };

// how each provider wraps a successful answer
const SUCCESS: Record<(typeof REAL)[number], (content: unknown, over?: Record<string, unknown>) => Response> = {
  openai: (content, over = {}) => json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 340, prompt_tokens_details: { cached_tokens: 100 } }, ...over }, { headers: { "x-request-id": "req_o1" } }),
  anthropic: (content, over = {}) => json({ content: [{ type: "text", text: "..." }, { type: "tool_use", name: "training_blueprint", input: content }], stop_reason: "tool_use", usage: { input_tokens: 1300, output_tokens: 350, cache_read_input_tokens: 50 }, ...over }, { headers: { "request-id": "req_a1" } }),
  google: (content, over = {}) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(content).slice(0, 5) }, { text: JSON.stringify(content).slice(5) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1400, candidatesTokenCount: 300, thoughtsTokenCount: 60, cachedContentTokenCount: 10 }, ...over }, { headers: { "x-request-id": "req_g1" } }),
};

describe.each(REAL)("%s adapter", (kind) => {
  const provider = PROVIDERS[kind];

  it("sends the documented request: URL, method, auth header placement, body fields", async () => {
    const f = fakeFetch(() => SUCCESS[kind](PLAN));
    const req = await requestFor(kind);
    const res = await provider.call(req, settings(kind, f, { modelId: "model-x.1", maxOutputTokens: 1234 }));
    expect(res.ok).toBe(true);
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0];
    const body = JSON.parse(call.body!);
    expect(call.init.method).toBe("POST");
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
    const lowerHeaders = Object.fromEntries(Object.entries(call.headers).map(([k, v]) => [k.toLowerCase(), v]));
    expect(lowerHeaders["content-type"]).toBe("application/json");
    // none of the sampling knobs, no user id, no metadata
    for (const absent of ["temperature", "top_p", "user", "metadata", "top_k"]) {
      expect(body).not.toHaveProperty(absent);
      expect(body.generationConfig ?? {}).not.toHaveProperty(absent);
    }
    if (kind === "openai") {
      expect(call.url).toBe(`${OPENAI_BASE}/v1/chat/completions`);
      expect(lowerHeaders.authorization).toBe(`Bearer ${KEY}`);
      expect(Object.keys(body).sort()).toEqual(["max_completion_tokens", "messages", "model", "response_format"]);
      expect(body).toMatchObject({ model: "model-x.1", max_completion_tokens: 1234 });
      expect(body.messages).toEqual([{ role: "system", content: req.system }, { role: "user", content: req.user }]);
      expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: PLANNER_SCHEMA_NAME, strict: true, schema: req.schema } });
    } else if (kind === "anthropic") {
      expect(call.url).toBe(`${ANTHROPIC_BASE}/v1/messages`);
      expect(lowerHeaders["x-api-key"]).toBe(KEY);
      expect(lowerHeaders["anthropic-version"]).toBe("2023-06-01");
      expect(lowerHeaders.authorization).toBeUndefined();
      expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "system", "tool_choice", "tools"]);
      expect(body).toMatchObject({ model: "model-x.1", max_tokens: 1234, system: req.system, messages: [{ role: "user", content: req.user }] });
      expect(body.tools).toEqual([{ name: PLANNER_SCHEMA_NAME, description: "Return the plan.", input_schema: req.schema }]);
      expect(body.tool_choice).toEqual({ type: "tool", name: PLANNER_SCHEMA_NAME });
    } else {
      expect(call.url).toBe(`${GOOGLE_BASE}/v1beta/models/model-x.1:generateContent`);
      expect(call.url).not.toMatch(/[?&]key=/);
      expect(call.url).not.toContain(KEY);
      expect(lowerHeaders["x-goog-api-key"]).toBe(KEY);
      expect(Object.keys(body).sort()).toEqual(["contents", "generationConfig", "systemInstruction"]);
      expect(body.systemInstruction).toEqual({ parts: [{ text: req.system }] });
      expect(body.contents).toEqual([{ role: "user", parts: [{ text: req.user }] }]);
      expect(body.generationConfig).toEqual({ responseMimeType: "application/json", responseJsonSchema: req.schema, maxOutputTokens: 1234 });
    }
    // the key is in the header only, never in the body or the URL
    expect(call.body).not.toContain(KEY);
    expect(call.url).not.toContain(KEY);
  });

  it("parses the structured answer and extracts the provider's token usage", async () => {
    const f = fakeFetch(() => SUCCESS[kind](PLAN));
    const res = await provider.call(await requestFor(kind), settings(kind, f));
    expect(res).toMatchObject({ ok: true, json: PLAN, finish: "STOP", providerRequestId: `req_${kind[0]}1` });
    if (!res.ok) return;
    const expected = { openai: [1200, 340, 100], anthropic: [1300, 350, 50], google: [1400, 360, 10] }[kind];
    expect(res.usage).toEqual({ inputTokens: expected[0], outputTokens: expected[1], cachedInputTokens: expected[2], source: "PROVIDER" });
  });

  it("the bytes handed to fetch carry none of the canary student's values and only whitelisted keys", async () => {
    const bundle = await canaryBundle();
    const f = fakeFetch(() => SUCCESS[kind](PLAN));
    await provider.call(await requestFor(kind, bundle), settings(kind, f));
    const sent = `${f.calls[0].url}\n${canonicalJson(f.calls[0].headers)}\n${f.calls[0].body}`.replace(KEY, "KEY");
    expect(scanPatterns(f.calls[0].body!)).toEqual([]);
    expect(scanPayload(f.calls[0].body!, bundle.denyList, fixedTokens([wire(kind)]))).toEqual([]);
    const lower = sent.toLowerCase();
    for (const needle of [CANARY.name, CANARY.email, "98888", "7766", "123.456", "12345678909", "1991", CANARY.planTitle, ...CANARY.labels.filter((l) => l.length > 1), CANARY.exerciseName, "acácias", "ombro"]) {
      expect(lower).not.toContain(needle.toLowerCase());
    }
  });

  it("refuses a request that did not come from the choke point, or one for another dialect, before any fetch", async () => {
    const f = fakeFetch(() => SUCCESS[kind](PLAN));
    const req = await requestFor(kind);
    for (const bad of [{ ...req } as SafeProviderRequest, { ...req, user: `${req.user} ` } as SafeProviderRequest, await requestFor(kind === "openai" ? "anthropic" : "openai")]) {
      const res = await provider.call(bad, settings(kind, f));
      expect(res).toMatchObject({ ok: false, code: "BAD_REQUEST" });
    }
    expect(f.spy).not.toHaveBeenCalled();
  });

  it.each(["../x", "a b", "x?key=1", "", "-x", "a/b", "m".repeat(81), "x\u0000y"])("rejects the model id %j before it touches a URL", async (modelId) => {
    const f = fakeFetch(() => SUCCESS[kind](PLAN));
    const res = await provider.call(await requestFor(kind), settings(kind, f, { modelId }));
    expect(res).toMatchObject({ ok: false, code: "BAD_REQUEST" });
    expect(f.spy).not.toHaveBeenCalled();
  });

  it("without a key it answers AUTH and sends nothing", async () => {
    const f = fakeFetch(() => SUCCESS[kind](PLAN));
    expect(await provider.call(await requestFor(kind), settings(kind, f, { apiKey: null }))).toMatchObject({ ok: false, code: "AUTH" });
    expect(f.spy).not.toHaveBeenCalled();
  });

  describe("errors, timeouts and quota map to codes", () => {
    const table: Array<[string, number, string, boolean, Record<string, string>?, string?]> = [
      ["400", 400, "BAD_REQUEST", false], ["401", 401, "AUTH", false], ["403", 403, "AUTH", false], ["404", 404, "MODEL_NOT_FOUND", false], ["408", 408, "RATE_LIMIT", true],
      ["422", 422, "BAD_REQUEST", false], ["402", 402, "PROVIDER_QUOTA", false], ["500", 500, "SERVER_ERROR", true], ["503", 503, "SERVER_ERROR", true], ["529", 529, "SERVER_ERROR", true],
      ["429", 429, "RATE_LIMIT", true], ["429 with a short Retry-After", 429, "RATE_LIMIT", true, { "retry-after": "2" }],
      ["429 with a long Retry-After", 429, "RATE_LIMIT", false, { "retry-after": "30" }],
      ["429 insufficient_quota", 429, "PROVIDER_QUOTA", false, undefined, '{"error":{"type":"insufficient_quota"}}'],
      ["400 billing", 400, "PROVIDER_QUOTA", false, undefined, '{"error":{"message":"billing hard limit reached"}}'],
    ];
    it.each(table)("HTTP %s", async (_name, status, code, retryable, headers, body) => {
      const f = fakeFetch(() => new Response(body ?? JSON.stringify({ error: { message: "provider text that must not travel" } }), { status, headers }));
      const res = await provider.call(await requestFor(kind), settings(kind, f));
      expect(res).toMatchObject({ ok: false, code, retryable, httpStatus: status });
      expect(JSON.stringify(res)).not.toContain("must not travel");
      if (headers?.["retry-after"]) expect((res as { retryAfterMs: number }).retryAfterMs).toBe(Number(headers["retry-after"]) * 1000);
    });

    it("a fetch that rejects on abort is TIMEOUT (not retryable, usage unknown)", async () => {
      const f = fakeFetch((_url, init) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
      const res = await provider.call(await requestFor(kind), settings(kind, f, { timeoutMs: 40 }));
      expect(res).toMatchObject({ ok: false, code: "TIMEOUT", retryable: false, usage: null });
    });

    it("a fetch that ignores the abort signal still times out", async () => {
      const f = fakeFetch(() => new Promise<Response>(() => undefined));
      const started = Date.now();
      const res = await provider.call(await requestFor(kind), settings(kind, f, { timeoutMs: 40 }));
      expect(res).toMatchObject({ ok: false, code: "TIMEOUT" });
      expect(Date.now() - started).toBeLessThan(1500);
    });

    it("a body that stalls after the headers also times out", async () => {
      const f = fakeFetch(() => ({ ok: true, status: 200, headers: new Headers(), text: () => new Promise<string>(() => undefined) }) as unknown as Response);
      expect(await provider.call(await requestFor(kind), settings(kind, f, { timeoutMs: 40 }))).toMatchObject({ ok: false, code: "TIMEOUT" });
    });

    it("a fetch that throws is NETWORK (retryable) and the error text is not carried", async () => {
      const f = fakeFetch(() => { throw new TypeError(`getaddrinfo ENOTFOUND secret-host ${KEY}`); });
      const res = await provider.call(await requestFor(kind), settings(kind, f));
      expect(res).toMatchObject({ ok: false, code: "NETWORK", retryable: true });
      expect(JSON.stringify(res)).not.toContain("secret-host");
      expect(JSON.stringify(res)).not.toContain(KEY);
    });

    it("invalid JSON in the envelope or in the content is INVALID_JSON, and usage is kept when the provider reported it", async () => {
      const f1 = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 200 }));
      expect(await provider.call(await requestFor(kind), settings(kind, f1))).toMatchObject({ ok: false, code: "INVALID_JSON", usage: null });
      const broken: Record<(typeof REAL)[number], Response> = {
        openai: json({ choices: [{ message: { content: "{not json" }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 12 } }),
        anthropic: json({ content: [{ type: "text", text: "no tool call here" }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 12 } }),
        google: json({ candidates: [{ content: { parts: [{ text: "{not json" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 12 } }),
      };
      const f2 = fakeFetch(() => broken[kind]);
      const res = await provider.call(await requestFor(kind), settings(kind, f2));
      expect(res).toMatchObject({ ok: false, code: "INVALID_JSON", usage: { inputTokens: 900, outputTokens: 12, source: "PROVIDER" } });
    });

    it("truncated output is TRUNCATED (tokens kept), a refusal is REFUSED", async () => {
      const truncated: Record<(typeof REAL)[number], Response> = {
        openai: json({ choices: [{ message: { content: '{"a"' }, finish_reason: "length" }], usage: { prompt_tokens: 1000, completion_tokens: 2048 } }),
        anthropic: json({ content: [], stop_reason: "max_tokens", usage: { input_tokens: 1000, output_tokens: 2048 } }),
        google: json({ candidates: [{ content: { parts: [{ text: '{"a"' }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 2048 } }),
      };
      const refused: Record<(typeof REAL)[number], Response[]> = {
        openai: [json({ choices: [{ message: { content: null, refusal: "no" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 3 } }), json({ choices: [{ message: { content: "" }, finish_reason: "content_filter" }] })],
        anthropic: [json({ content: [], stop_reason: "refusal", usage: { input_tokens: 1000, output_tokens: 3 } })],
        google: [json({ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: { promptTokenCount: 1000 } }), json({ candidates: [{ finishReason: "PROHIBITED_CONTENT" }] }), json({ candidates: [{ finishReason: "SAFETY" }] })],
      };
      const f1 = fakeFetch(() => truncated[kind]);
      expect(await provider.call(await requestFor(kind), settings(kind, f1))).toMatchObject({ ok: false, code: "TRUNCATED", usage: { inputTokens: 1000, outputTokens: 2048 }, retryable: false });
      for (const response of refused[kind]) {
        const f2 = fakeFetch(() => response.clone());
        expect(await provider.call(await requestFor(kind), settings(kind, f2))).toMatchObject({ ok: false, code: "REFUSED", retryable: false });
      }
    });

    it("refuses a body above 256 KB (declared or actual) before parsing it", async () => {
      const huge = JSON.stringify({ pad: "x".repeat(262_200) });
      const f1 = fakeFetch(() => new Response(huge, { status: 200 }));
      expect(await provider.call(await requestFor(kind), settings(kind, f1))).toMatchObject({ ok: false, code: "INVALID_JSON" });
      const f2 = fakeFetch(() => new Response("{}", { status: 200, headers: { "content-length": "999999" } }));
      expect(await provider.call(await requestFor(kind), settings(kind, f2))).toMatchObject({ ok: false, code: "INVALID_JSON" });
    });
  });

  it("falls back to an ESTIMATE-flagged usage when the provider reports none", async () => {
    const bare: Record<(typeof REAL)[number], Response> = {
      openai: json({ choices: [{ message: { content: JSON.stringify(PLAN) }, finish_reason: "stop" }] }),
      anthropic: json({ content: [{ type: "tool_use", input: PLAN }], stop_reason: "tool_use" }),
      google: json({ candidates: [{ content: { parts: [{ text: JSON.stringify(PLAN) }] }, finishReason: "STOP" }] }),
    };
    const res = await provider.call(await requestFor(kind), settings(kind, fakeFetch(() => bare[kind])));
    expect(res).toMatchObject({ ok: true, usage: { inputTokens: null, outputTokens: null, source: "ESTIMATE" } });
  });
});

describe("Google specifics", () => {
  it("strips a leading models/ from the id and counts thinking tokens as output", async () => {
    const f = fakeFetch(() => SUCCESS.google(PLAN));
    await googleProvider.call(await requestFor("google"), settings("google", f, { modelId: "models/gemini-x" }));
    expect(f.calls[0].url).toBe(`${GOOGLE_BASE}/v1beta/models/gemini-x:generateContent`);
    expect(safeModelId("models/a.b", "google")).toBe("a.b");
    expect(safeModelId("models/a.b", "openai")).toBeNull();
  });
});

describe("listing models", () => {
  it("OpenAI: GET /v1/models, ids sorted, bearer header, no body", async () => {
    const f = fakeFetch(() => json({ data: [{ id: "z-model" }, { id: "a-model" }, { nope: 1 }] }));
    const res = await openaiProvider.listModels(KEY, f.impl);
    expect(res).toEqual({ ok: true, models: [{ id: "a-model", label: null }, { id: "z-model", label: null }] });
    expect(f.calls[0]).toMatchObject({ url: `${OPENAI_BASE}/v1/models`, body: null });
    expect(f.calls[0].init.method).toBe("GET");
    expect(f.calls[0].headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("Anthropic: GET /v1/models?limit=100 with the key and version headers", async () => {
    const f = fakeFetch(() => json({ data: [{ id: "m-b", display_name: "Model B" }, { id: "m-a" }] }));
    const res = await anthropicProvider.listModels(KEY, f.impl);
    expect(res).toEqual({ ok: true, models: [{ id: "m-a", label: null }, { id: "m-b", label: "Model B" }] });
    expect(f.calls[0].url).toBe(`${ANTHROPIC_BASE}/v1/models?limit=100`);
    expect(f.calls[0].headers).toMatchObject({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
    expect(f.calls[0].body).toBeNull();
  });

  it("Google: GET /v1beta/models?pageSize=100, key in the header, only models that support generateContent, models/ prefix removed", async () => {
    const f = fakeFetch(() => json({ models: [
      { name: "models/gem-1", displayName: "Gem 1", supportedGenerationMethods: ["generateContent", "countTokens"] },
      { name: "models/embed-1", displayName: "Embed", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gem-0", supportedGenerationMethods: ["generateContent"] },
    ] }));
    const res = await googleProvider.listModels(KEY, f.impl);
    expect(res).toEqual({ ok: true, models: [{ id: "gem-0", label: null }, { id: "gem-1", label: "Gem 1" }] });
    expect(f.calls[0].url).toBe(`${GOOGLE_BASE}/v1beta/models?pageSize=100`);
    expect(f.calls[0].url).not.toContain("key=");
    expect(f.calls[0].headers["x-goog-api-key"]).toBe(KEY);
    expect(f.calls[0].body).toBeNull();
  });

  it.each(REAL)("%s: errors map to codes without a body, malformed answers are INVALID_JSON", async (kind) => {
    for (const [status, code] of [[401, "AUTH"], [429, "RATE_LIMIT"], [500, "SERVER_ERROR"]] as const) {
      const res = await PROVIDERS[kind].listModels(KEY, fakeFetch(() => new Response("provider text", { status })).impl);
      expect(res).toEqual({ ok: false, code, httpStatus: status });
    }
    expect(await PROVIDERS[kind].listModels(KEY, fakeFetch(() => json({ unexpected: true })).impl)).toMatchObject({ ok: false, code: "INVALID_JSON" });
    expect(await PROVIDERS[kind].listModels(KEY, fakeFetch(() => { throw new Error("down"); }).impl)).toMatchObject({ ok: false, code: "NETWORK" });
    const aborted = new AbortController();
    aborted.abort();
    const f = fakeFetch((_u, init) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("a")))));
    expect(await PROVIDERS[kind].listModels(KEY, f.impl, aborted.signal)).toMatchObject({ ok: false, code: "TIMEOUT" });
  });

  it("a list-models call carries no body at all, so no student data can be in it", async () => {
    for (const kind of REAL) {
      const f = fakeFetch(() => json({ data: [], models: [] }));
      await PROVIDERS[kind].listModels(KEY, f.impl);
      expect(f.calls[0].body).toBeNull();
      expect(f.calls[0].init.body).toBeUndefined();
    }
  });
});

describe("the connectivity check (Testar modelo)", () => {
  it.each(REAL)("%s: a constant prompt, a tiny schema, no student data, builds with an empty deny-list", async (kind) => {
    const req = await buildProviderPayload("PLANNER", { kind, system: MODEL_TEST_SYSTEM_PROMPT, user: MODEL_TEST_USER, schema: { ...MODEL_TEST_SCHEMA }, schemaName: MODEL_TEST_SCHEMA_NAME }, { values: [], tokens: [], prose: [] });
    const f = fakeFetch(() => SUCCESS[kind]({ ok: true }));
    const res = await PROVIDERS[kind].call(req, settings(kind, f));
    expect(res).toMatchObject({ ok: true, json: { ok: true } });
    expect(f.calls[0].body).not.toContain("context");
    expect(req.user).toBe('{"task":"CONNECTIVITY_CHECK"}');
  });
});

describe("bounded retry (policy)", () => {
  const ok: ProviderResult = { ok: true, json: PLAN, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: null, source: "PROVIDER" }, latencyMs: 1, providerRequestId: null, finish: "STOP" };
  const err = (code: "SERVER_ERROR" | "AUTH", retryable: boolean, usage: Usage | null = null): ProviderResult =>
    ({ ok: false, code, httpStatus: 500, retryable, retryAfterMs: null, usage, latencyMs: 1 });
  const providerOf = (results: ProviderResult[]): PlannerProvider & { calls: number } => {
    const p = { kind: "mock" as const, calls: 0, async call() { return results[Math.min(p.calls++, results.length - 1)]; }, async listModels() { return { ok: true as const, models: [] }; } };
    return p;
  };
  const req = {} as SafeProviderRequest;
  const cfg: CallSettings = { kind: "mock", modelId: "m", maxOutputTokens: 10, timeoutMs: 10, apiKey: null };

  it("retries a retryable failure exactly once with a fixed pause, then stops", async () => {
    const sleep = vi.fn(async () => undefined);
    const p = providerOf([err("SERVER_ERROR", true), err("SERVER_ERROR", true), ok]);
    const out = await callWithPolicy(p, req, cfg, { maxRetries: 1, sleep });
    expect(p.calls).toBe(2);
    expect(out.attempts).toBe(2);
    expect(out.result).toMatchObject({ ok: false, code: "SERVER_ERROR" });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it("recovers when the retry succeeds, and sums the usage of both attempts", async () => {
    const failed = err("SERVER_ERROR", true, { inputTokens: 100, outputTokens: 0, cachedInputTokens: null, source: "PROVIDER" });
    const p = providerOf([failed, ok]);
    const out = await callWithPolicy(p, req, cfg, { maxRetries: 1, sleep: async () => undefined });
    expect(out).toMatchObject({ attempts: 2, result: { ok: true }, usage: { inputTokens: 110, outputTokens: 5, source: "PROVIDER" } });
  });

  it("never retries a non-retryable code, nor when retries are 0", async () => {
    const a = providerOf([err("AUTH", false), ok]);
    expect((await callWithPolicy(a, req, cfg, { maxRetries: 1, sleep: async () => undefined })).attempts).toBe(1);
    const b = providerOf([err("SERVER_ERROR", true), ok]);
    expect((await callWithPolicy(b, req, cfg, { maxRetries: 0, sleep: async () => undefined })).attempts).toBe(1);
    expect(b.calls).toBe(1);
  });
});

describe("the mock provider", () => {
  it("lists its models and registers", async () => {
    expect(providerFor("mock")).toBe(mockProvider);
    expect(providerFor("openai")).toBe(openaiProvider);
    expect(await mockProvider.listModels("")).toMatchObject({ ok: true });
    expect(MOCK_MODELS).toContain("mock-hostile");
  });

  it("is deterministic and its answer passes the binding validator for the Xintus structure (upper/lower, repeated phases)", async () => {
    const bundle = await (xintus ??= xintusBundle());
    const req = await requestFor("mock");
    const run = () => mockProvider.call(req, { kind: "mock", modelId: "mock-ul", maxOutputTokens: 4000, timeoutMs: 1000, apiKey: null });
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, usage: { source: "ESTIMATE" } });
    if (!a.ok) return;
    const verdict = validatePlannerResponse(a.json, bundle, ROLE_FOCUS_INTERIM_TABLE, { producer: { kind: "AI", provider: "mock", modelId: "mock-ul", promptVersion: PLANNER_PROMPT_VERSION }, roleFocusRef: ROLE_FOCUS_INTERIM });
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
    if (verdict.ok) {
      const s1 = verdict.blueprint.strategies[0];
      expect(s1.splitFamily).toBe("UPPER_LOWER");
      expect(verdict.blueprint.recommendedStrategyId).toBe("S1");
    }
  });

  it.each(["mock-ok", "mock-fb", "mock-schedule"])("%s answers a plan the validator accepts", async (model) => {
    const bundle = await xintusBundle();
    const plan = mockPlan(bundle.context, model);
    expect(plannerResponseSchema.safeParse(plan).success).toBe(true);
    const verdict = validatePlannerResponse(plan, bundle, ROLE_FOCUS_INTERIM_TABLE, { producer: { kind: "AI", provider: "mock", modelId: model, promptVersion: PLANNER_PROMPT_VERSION }, roleFocusRef: ROLE_FOCUS_INTERIM });
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
  });

  it("mock-hostile is refused whole by the validator", async () => {
    const bundle = await xintusBundle();
    const res = await mockProvider.call(await requestFor("mock", bundle), { kind: "mock", modelId: "mock-hostile", maxOutputTokens: 4000, timeoutMs: 1000, apiKey: null });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const verdict = validatePlannerResponse(res.json, bundle, ROLE_FOCUS_INTERIM_TABLE, { producer: { kind: "AI", provider: "mock", modelId: "mock-hostile", promptVersion: PLANNER_PROMPT_VERSION }, roleFocusRef: ROLE_FOCUS_INTERIM });
    expect(verdict.ok).toBe(false);
  });

  it("failure models map to the codes the service handles", async () => {
    const req = await requestFor("mock");
    const call = (modelId: string, timeoutMs = 1000) => mockProvider.call(req, { kind: "mock", modelId, maxOutputTokens: 4000, timeoutMs, apiKey: null });
    expect(await call("mock-500")).toMatchObject({ ok: false, code: "SERVER_ERROR", retryable: true });
    expect(await call("mock-quota")).toMatchObject({ ok: false, code: "PROVIDER_QUOTA" });
    expect(await call("mock-invalid-json")).toMatchObject({ ok: false, code: "INVALID_JSON", usage: { source: "ESTIMATE" } });
    expect(await call("mock-truncated")).toMatchObject({ ok: false, code: "TRUNCATED" });
    expect(await call("mock-timeout", 30)).toMatchObject({ ok: false, code: "TIMEOUT", usage: null });
  });

  it("refuses an unissued request or a wrong kind", async () => {
    const req = await requestFor("mock");
    expect(await mockProvider.call({ ...req } as SafeProviderRequest, { kind: "mock", modelId: "mock-ok", maxOutputTokens: 1, timeoutMs: 10, apiKey: null })).toMatchObject({ code: "BAD_REQUEST" });
    expect(await mockProvider.call(req, { kind: "openai", modelId: "mock-ok", maxOutputTokens: 1, timeoutMs: 10, apiKey: null })).toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("the wire schema per provider", () => {
  const planner = (kind: ProviderKind) => wire(kind);
  const walk = (node: unknown, visit: (n: Record<string, unknown>) => void) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
    if (typeof node !== "object" || node === null) return;
    visit(node as Record<string, unknown>);
    for (const [k, v] of Object.entries(node)) walk(k === "properties" ? Object.values(v as object) : v, visit);
  };

  it("keeps EXACTLY this inventory of keywords (a new keyword fails the test on purpose)", () => {
    expect(keywordInventory(planner("openai"))).toEqual(["additionalProperties", "anyOf", "enum", "items", "required", "type"]);
    expect(keywordInventory(planner("anthropic"))).toEqual([
      "additionalProperties", "anyOf", "enum", "items", "maxItems", "maxLength", "maximum", "minItems", "minLength", "minimum", "pattern", "required", "type",
    ]);
    expect(keywordInventory(planner("google"))).toEqual(["enum", "items", "maxItems", "maximum", "minItems", "minimum", "required", "type"]);
  });

  it.each(["openai", "anthropic", "google"] as const)("%s: no oneOf, $schema, const or safe-integer bound survives; no discriminated union exists", (kind) => {
    const text = JSON.stringify(planner(kind));
    expect(text).not.toContain("oneOf");
    expect(text).not.toContain("$schema");
    expect(text).not.toContain('"const"');
    expect(text).not.toContain("9007199254740991");
    for (const word of STRIPPED[kind]) {
      walk(planner(kind), (n) => expect(Object.keys(n), `${kind} keeps ${word}`).not.toContain(word));
    }
  });

  it("OpenAI strict mode: every object is closed and requires ALL its properties", () => {
    let objects = 0;
    walk(planner("openai"), (n) => {
      if (n.properties) {
        objects += 1;
        expect(n.additionalProperties).toBe(false);
        expect(n.required).toEqual(Object.keys(n.properties as object));
      }
    });
    expect(objects).toBeGreaterThan(5);
  });

  it("Google: nullable fields become a type list with null, and nothing is left as anyOf with a null branch", () => {
    const text = JSON.stringify(planner("google"));
    expect(text).toContain('"null"');
    expect(text).not.toContain('{"type":"null"}');
  });

  it("every provider's schema is the same shape underneath (same property names)", () => {
    const names = (kind: ProviderKind) => {
      const set = new Set<string>();
      walk(planner(kind), (n) => Object.keys((n.properties as object) ?? {}).forEach((k) => set.add(k)));
      return [...set].sort();
    };
    expect(names("openai")).toEqual(names("anthropic"));
    expect(names("google")).toEqual(names("anthropic"));
    expect(names("anthropic")).toContain("candidateAliases");
  });
});
