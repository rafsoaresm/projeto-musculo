/**
 * The provider port of the AI planner (design V4 §3.2). Pure types: no `server-only`, so adapters and tests run in Node and in the Worker.
 * A request can only be built by `privacy.ts:buildProviderPayload` (the brand below), and an adapter refuses anything else.
 */
export const PROVIDER_KINDS = ["mock", "openai", "anthropic", "google"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
/** Kinds that have a key and a real endpoint (everything but `mock`). */
export type RealProviderKind = Exclude<ProviderKind, "mock">;
export const REAL_PROVIDER_KINDS = ["openai", "anthropic", "google"] as const satisfies readonly RealProviderKind[];
export const isRealProvider = (kind: string): kind is RealProviderKind => (REAL_PROVIDER_KINDS as readonly string[]).includes(kind);

export type AiTask = "PLANNER" | "ADJUSTMENTS";
export type WireSchema = Record<string, unknown>;

declare const SAFE: unique symbol;
/** The exact request that may leave the server: system prompt, ONE user message (canonical JSON of the coded context) and the schema. */
export interface SafeProviderRequest {
  readonly [SAFE]: true;
  readonly task: AiTask;
  /** Which provider's schema dialect `schema` is in (the bytes scanned are the bytes sent). */
  readonly schemaKind: ProviderKind;
  readonly system: string;
  readonly user: string;
  /** sha256 of `user`; the only trace of the content kept in logs, ledger and cache keys. */
  readonly payloadHash: string;
  readonly estimatedInputTokens: number;
  readonly schemaName: string;
  readonly schema: WireSchema;
}

export interface CallSettings {
  kind: ProviderKind;
  modelId: string;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Null only for `mock`. Never logged. */
  apiKey: string | null;
  fetchImpl?: typeof fetch;
}

export type ProviderErrorCode =
  | "AUTH" | "RATE_LIMIT" | "PROVIDER_QUOTA" | "TIMEOUT" | "NETWORK" | "BAD_REQUEST" | "MODEL_NOT_FOUND"
  | "INVALID_JSON" | "TRUNCATED" | "REFUSED" | "SERVER_ERROR" | "UNKNOWN";

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  source: "PROVIDER" | "ESTIMATE";
}
export type ProviderResult =
  | { ok: true; json: unknown; usage: Usage; latencyMs: number; providerRequestId: string | null; finish: "STOP" | "OTHER" }
  | { ok: false; code: ProviderErrorCode; httpStatus: number | null; retryable: boolean; retryAfterMs: number | null; usage: Usage | null; latencyMs: number };

export type ProviderFailure = Extract<ProviderResult, { ok: false }>;

export type ListModelsResult =
  | { ok: true; models: Array<{ id: string; label: string | null }> }
  | { ok: false; code: ProviderErrorCode; httpStatus: number | null };

export interface PlannerProvider {
  kind: ProviderKind;
  call(req: SafeProviderRequest, settings: CallSettings): Promise<ProviderResult>;
  listModels(apiKey: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<ListModelsResult>;
}

/** Ceiling on a response body (design §3.2). */
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
/** A model id as it may touch a URL. Google ids may arrive as `models/<id>`: the prefix is stripped. Null when invalid. */
export function safeModelId(raw: string, kind: ProviderKind): string | null {
  const id = kind === "google" ? raw.replace(/^models\//, "") : raw;
  return MODEL_ID.test(id) ? id : null;
}
