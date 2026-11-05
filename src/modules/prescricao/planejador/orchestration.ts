import "server-only";
/**
 * Planning orchestration (design V4 §3.10, sub-stage 1.3): the ONE server path that turns a saved prescription draft into a list of
 * suggested strategies, with AI or by rules.
 *
 *   parse -> reach + DRAFT -> idempotent replay -> content version -> real data + coded context
 *     RULES: produce (no network, no ledger) -> persist run + blueprint
 *     AI   : gate (kill switch, key, task, organization, plan, allowance, circuit, minor) -> anonymised payload + scan -> cache
 *            -> single-flight run -> reserve (race-safe) -> decrypt key -> provider (timeout, one retry) -> validate -> settle + persist
 *
 * Explicit states for the screens: not configured, disabled by the organization, limit reached, generating, failed (always with the
 * way out "continue by rules") and ready. Nothing here applies a strategy to a generation (PR 2), approves, delivers or writes a
 * prescription: the only tables written are the AI layer's (runs, payloads, ledger/month, cache, circuit), through
 * `src/db/ai-planning.ts`. The provider adapters are imported ONLY here, and `callGated` takes a reservation as proof: nothing reaches
 * a provider without passing the gate and the reserve.
 *
 * Nothing logs. Prompt, response text and keys never leave this module except as the validated blueprint (codes, real labels, short
 * pt-BR sentences that passed `proseProblems`). The model's output is untrusted data.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { ZodError, z } from "zod";
import { aiPlanningFor, aiSystemFor, type RunRow, type TaskSettings } from "@/db/ai-planning";
import { studentsFor, type AuthenticatedContext } from "@/db/students";
import { loadGenerationContext } from "@/modules/prescricao/automatica/context";
import { carriesBlueprint, CLIENT_BLUEPRINT_REFUSED, parseGenerationAnswers, type GenerationAnswers, type GenerationQuestion } from "@/modules/prescricao/automatica/contracts";
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor/hash";
import { DEFAULT_RULESET } from "@/modules/prescricao/motor/rules";
import { plannerResponseSchema, trainingBlueprintSchema, type TrainingBlueprint } from "./blueprint";
import { validatePlannerResponse } from "./blueprint-validate";
import { resolveAiEnv, type AiEnv } from "./config";
import { buildPlanningContext } from "./context";
import type { PlanningContextBundle } from "./context-types";
import { GATE_MESSAGE, PLAN_MESSAGE, PROVIDER_FAILURE_MESSAGE } from "./copy";
import { loadAiEnv } from "./env";
import { evaluateAiGate, type AiGateState, type GateReason } from "./gate";
import { blueprintHash, plannerCacheKey, responseHash } from "./hashes";
import { buildProviderPayload, PrivacyBlockedError } from "./privacy";
import { PLANNER_SCHEMA_NAME, PLANNER_SYSTEM_PROMPT, plannerUserMessage } from "./prompt";
import { callWithPolicy } from "./provedores/policy";
import type { CallSettings, PlannerProvider, ProviderErrorCode, ProviderKind, ProviderResult, SafeProviderRequest, Usage } from "./provedores/port";
import { providerFor } from "./provedores/registry";
import { toWireSchema } from "./provedores/wire-schema";
import { AI_RETRY_DELAY_MS, costMicros, estimateTokens, monthKey, outputBudget, reservationFor, staleAfterMs, type Reservation } from "./quota";
import { ROLE_FOCUS_INTERIM_TABLE } from "./role-focus";
import { openSecret } from "./secrets";
import { currentTemplates, produceRulesBlueprint } from "./rules-mode/producer";
import { rulesetRefText, roleFocusFromRuleSet } from "./rules-mode/ruleset-templates";
import { toStrategyListView, type StrategyListView } from "./strategy-view";
import { BLUEPRINT_VERSION, PLANNER_PROMPT_VERSION, ROLE_FOCUS_INTERIM } from "./versions";

export type PlanningMode = "AI" | "RULES";
export type PlanFailure =
  | "not_found" | "not_open" | "invalid" | "key_reused" | "revision_changed" | "questions" | "in_progress" | "structure_too_large"
  | "disabled" | "not_configured" | "org_disabled" | "no_plan" | "limit_reached" | "request_too_large" | "circuit_open" | "minor_blocked"
  | "privacy_blocked" | "provider_failed" | "timeout" | "invalid_response" | "stale";

export type PlanningOutcome =
  | { ok: true; runId: string; producer: "AI" | "RULES"; replayed: boolean; cache: "HIT" | "MISS" | null; blueprint: StrategyListView; usage: { inputTokens: number; outputTokens: number } | null }
  | { ok: false; reason: PlanFailure; message: string; canContinueByRules: boolean; runId?: string; questions?: GenerationQuestion[] };

/** The explicit states a screen shows for a revision (nothing external is called to read them). */
export type PlanningState =
  | { state: "NONE" }
  | { state: "GENERATING"; runId: string; mode: PlanningMode }
  | { state: "FAILED"; runId: string; reason: PlanFailure; message: string; canContinueByRules: boolean }
  | { state: "READY"; view: StrategyListView }
  /** A suggestion exists but the draft changed after it (content_version moved): it is not served; plan again. */
  | { state: "STALE"; runId: string; message: string };

export interface Availability {
  state: "READY" | GateReason;
  /** What a professional reads: never the provider, model or key. Empty when READY. */
  message: string;
  usage: Awaited<ReturnType<ReturnType<typeof aiPlanningFor>["usageForProfessional"]>>;
}

export interface PlannerDeps {
  now?: () => Date;
  /** Test seam: replaces a provider adapter (e.g. an adapter wired to a mocked `fetch` goes through `fetchImpl` instead). */
  providers?: Partial<Record<ProviderKind, PlannerProvider>>;
  /** Sync reader of environment variables; default: the Worker env, then `process.env` (`env.ts`). */
  readEnv?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
  /** Extra values that identify a person or a record (organization name...). They only feed the deny list. */
  extraIdentifiers?: ReadonlyArray<string | null | undefined>;
}

const intentId = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);
const planSchema = z.object({ idempotencyKey: intentId, baseContentVersion: z.number().int().min(0), mode: z.enum(["AI", "RULES"]), answers: z.unknown() }).strict();
export type PlanPayload = z.input<typeof planSchema>;

const GATE_TO_FAILURE: Record<GateReason, PlanFailure> = {
  KILL_SWITCH_ENV: "disabled", KILL_SWITCH_PANEL: "disabled", SECRETS_KEY_MISSING: "not_configured", TASK_NOT_MAPPED: "not_configured",
  PROVIDER_NOT_CONNECTED: "not_configured", ORG_DISABLED: "org_disabled", NO_QUOTA_PLAN: "no_plan", ALLOWANCE_ZERO: "no_plan", ALLOWANCE_EXHAUSTED: "limit_reached",
  COST_CURRENCY_MISMATCH: "no_plan", CIRCUIT_OPEN: "circuit_open", MINOR_BLOCKED: "minor_blocked", REQUEST_TOO_LARGE: "request_too_large",
};
const FAILURE_TO_GATE: Partial<Record<PlanFailure, GateReason>> = {
  disabled: "KILL_SWITCH_ENV", not_configured: "TASK_NOT_MAPPED", org_disabled: "ORG_DISABLED", no_plan: "NO_QUOTA_PLAN", limit_reached: "ALLOWANCE_EXHAUSTED",
  circuit_open: "CIRCUIT_OPEN", minor_blocked: "MINOR_BLOCKED", request_too_large: "REQUEST_TOO_LARGE",
};
/** The coarse, professional-facing name of a gate reason (never the cause: provider, model, key, switch). */
export const planFailureOfGate = (reason: GateReason): PlanFailure => GATE_TO_FAILURE[reason];

/** Failures after which "continue by rules" is the way out. The others are about the request itself. */
const RULES_IS_THE_WAY_OUT: ReadonlySet<PlanFailure> = new Set<PlanFailure>([
  "disabled", "not_configured", "org_disabled", "no_plan", "limit_reached", "request_too_large", "circuit_open", "minor_blocked", "privacy_blocked",
  "provider_failed", "timeout", "invalid_response", "stale",
]);

/** `failure_code` of a run (<= 40 characters): `reason` or `reason:detail`, never text. */
const encodeFailure = (reason: PlanFailure, detail?: string): string => (detail ? `${reason}:${detail}` : reason).slice(0, 40);
function decodeFailure(code: string | null): { reason: PlanFailure; detail: string | null } {
  const [reason, detail] = (code ?? "invalid_response").split(":");
  return { reason: (reason in PLAN_MESSAGE || reason in GATE_FALLBACK ? reason : "provider_failed") as PlanFailure, detail: detail ?? null };
}
const GATE_FALLBACK: Record<string, true> = {
  disabled: true, not_configured: true, org_disabled: true, no_plan: true, limit_reached: true, circuit_open: true, minor_blocked: true, request_too_large: true,
  provider_failed: true, timeout: true,
};

function messageFor(reason: PlanFailure, detail: string | null = null): string {
  const gate = FAILURE_TO_GATE[reason];
  if (gate) return GATE_MESSAGE[gate];
  if ((reason === "provider_failed" || reason === "timeout" || reason === "invalid_response") && detail && detail in PROVIDER_FAILURE_MESSAGE) {
    return PROVIDER_FAILURE_MESSAGE[detail as ProviderErrorCode];
  }
  if (reason === "provider_failed") return PROVIDER_FAILURE_MESSAGE.UNKNOWN;
  if (reason === "timeout") return PROVIDER_FAILURE_MESSAGE.TIMEOUT;
  return (PLAN_MESSAGE as Record<string, string>)[reason] ?? PLAN_MESSAGE.invalid_response;
}

const fail = (reason: PlanFailure, extra: { detail?: string | null; runId?: string; questions?: GenerationQuestion[]; message?: string; rulesOk?: boolean } = {}): PlanningOutcome => ({
  ok: false,
  reason,
  message: extra.message ?? messageFor(reason, extra.detail ?? null),
  canContinueByRules: RULES_IS_THE_WAY_OUT.has(reason) || extra.rulesOk === true,
  ...(extra.runId ? { runId: extra.runId } : {}),
  ...(extra.questions ? { questions: extra.questions } : {}),
});

const DAY_MS = 86_400_000;

function usageOf(json: string | null): { inputTokens: number; outputTokens: number } | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { inputTokens?: unknown; outputTokens?: unknown };
    return typeof v.inputTokens === "number" && typeof v.outputTokens === "number" ? { inputTokens: v.inputTokens, outputTokens: v.outputTokens } : null;
  } catch {
    return null;
  }
}

function readBlueprint(json: string | null): TrainingBlueprint | null {
  if (!json) return null;
  try {
    const parsed = trainingBlueprintSchema.safeParse(JSON.parse(json));
    return parsed.success ? (parsed.data as TrainingBlueprint) : null;
  } catch {
    return null;
  }
}

/** Proof that the gate passed and a reservation was made for this run and attempt. Only `callGated` accepts it. */
interface Reserved {
  readonly ledgerId: string;
  readonly runId: string;
  readonly attempt: number;
}

export function plannerService(db: D1Database, context: AuthenticatedContext, deps: PlannerDeps = {}) {
  const clock = deps.now ?? (() => new Date());
  const repo = aiPlanningFor(db, context);
  const system = aiSystemFor(db, context);
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const getEnv = async (): Promise<AiEnv> => (deps.readEnv ? resolveAiEnv(deps.readEnv) : loadAiEnv());

  const gateStateFor = (snapshot: Awaited<ReturnType<typeof repo.gateState>>, env: AiEnv, extra: Partial<AiGateState> = {}): AiGateState => ({
    ...snapshot.state,
    envKill: env.killSwitch,
    secretsKeyOk: env.secrets !== null,
    mockEnabled: env.mockEnabled,
    circuitOpen: false,
    ...extra,
  });

  /**
   * The gate snapshot AFTER the housekeeping of stale reservations: a Worker that died between `reserve` and `finishRun` leaves a RESERVED row that counts
   * against the allowance until swept, and the gate runs before `reserve` (which sweeps). The cutoff is the longest any live attempt can last
   * (hard timeout, one retry), so a live reservation is never swept. The sweep writes nothing when nothing is stale.
   */
  async function freshGate(planId: string, revisionId: string, now: Date, env: AiEnv) {
    await repo.sweepStale(monthKey(now), now, staleAfterMs(env.hardTimeoutMs, 1));
    return repo.gateState(planId, revisionId, "PLANNER", now);
  }

  function viewOf(run: Pick<RunRow, "id" | "baseContentVersion">, blueprint: TrainingBlueprint): StrategyListView {
    return toStrategyListView(blueprint, run.id, run.baseContentVersion);
  }

  /** The stored outcome of a finished run, replayed. */
  async function replayOf(planId: string, revisionId: string, run: RunRow): Promise<PlanningOutcome> {
    if (run.status === "FAILED") {
      const { reason, detail } = decodeFailure(run.failureCode);
      return fail(reason, { detail, runId: run.id });
    }
    // A stored suggestion is only replayed while the draft is still the one it was made for.
    const current = await repo.currentContentVersion(planId, revisionId);
    if (current === null) return fail("not_found");
    if (current !== run.baseContentVersion) return fail("revision_changed", { runId: run.id });
    const blueprint = readBlueprint(await repo.payloadOf(planId, revisionId, run.id));
    // The payload is deleted with the student's data: an erased run cannot be replayed.
    if (!blueprint) return fail("not_found");
    return {
      ok: true,
      runId: run.id,
      producer: blueprint.producer.kind,
      replayed: true,
      cache: run.mode === "AI" ? (run.cacheHit ? "HIT" : "MISS") : null,
      blueprint: viewOf(run, blueprint),
      usage: usageOf(run.usageJson),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // The single gated provider call.
  // ---------------------------------------------------------------------------------------------------------------------------

  async function callGated(
    proof: Reserved,
    provider: PlannerProvider,
    request: SafeProviderRequest,
    settings: CallSettings,
    maxRetries: 0 | 1,
  ): Promise<{ result: ProviderResult; attempts: number; usage: Usage | null; sentAt: Date; finishedAt: Date }> {
    void proof;
    const sentAt = clock();
    // The whole execution (every attempt and the pause) stays inside the window `staleAfterMs` counts on: a deadline guards an adapter
    // that would not honour its own timeout.
    const windowMs = (maxRetries + 1) * settings.timeoutMs + maxRetries * AI_RETRY_DELAY_MS + 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"DEADLINE">((resolve) => {
      timer = setTimeout(() => resolve("DEADLINE"), windowMs);
    });
    try {
      const done = callWithPolicy(provider, request, settings, { maxRetries, ...(deps.sleep ? { sleep: deps.sleep } : {}) });
      const winner = await Promise.race([done, deadline]);
      if (winner === "DEADLINE") {
        done.catch(() => undefined);
        const result: ProviderResult = { ok: false, code: "TIMEOUT", httpStatus: null, retryable: false, retryAfterMs: null, usage: null, latencyMs: windowMs };
        return { result, attempts: maxRetries + 1, usage: null, sentAt, finishedAt: clock() };
      }
      return { ...winner, sentAt, finishedAt: clock() };
    } catch {
      // An adapter never throws; if one does, the request may have left: treat it as a network failure of unknown cost.
      const result: ProviderResult = { ok: false, code: "NETWORK", httpStatus: null, retryable: false, retryAfterMs: null, usage: null, latencyMs: 0 };
      return { result, attempts: 1, usage: null, sentAt, finishedAt: clock() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // RULES
  // ---------------------------------------------------------------------------------------------------------------------------

  interface Prepared {
    planId: string;
    revisionId: string;
    idempotencyKey: string;
    requestHash: string;
    baseContentVersion: number;
    bundle: PlanningContextBundle;
  }

  const omittedJsonOf = (bundle: PlanningContextBundle): string => {
    const json = JSON.stringify(bundle.omitted.map((o) => `${o.field}:${o.reason}`));
    return json.length <= 4000 ? json : "[]";
  };

  async function runRules(p: Prepared, now: Date): Promise<PlanningOutcome> {
    const templates = currentTemplates();
    const runId = newId();
    const started = await repo.runStart({
      runId, planId: p.planId, revisionId: p.revisionId, idempotencyKey: p.idempotencyKey, requestHash: p.requestHash, mode: "RULES",
      baseContentVersion: p.baseContentVersion, structureFingerprint: p.bundle.refs.structureFingerprint, contextHash: p.bundle.contextHash,
      aliasesHash: p.bundle.aliases.aliasMapHash, cacheKey: null, providerKind: null, modelId: null, promptVersion: null, schemaVersion: BLUEPRINT_VERSION,
      templatesVersion: templates.version, omittedJson: omittedJsonOf(p.bundle), now,
    });
    if (!started.ok) return startFailure(p, started.reason);
    const blueprint = produceRulesBlueprint(p.bundle, templates);
    const checked = trainingBlueprintSchema.safeParse(blueprint);
    const base = { runId, planId: p.planId, revisionId: p.revisionId, attempt: 1, cacheHit: false, responseHash: null, usageJson: null, ledgerId: null, now };
    if (!checked.success) {
      await repo.finishRun({ ledger: null, run: { ...base, status: "FAILED", failureCode: "invalid_response:RULES", blueprintHash: null } });
      return fail("invalid_response", { runId, message: PLAN_MESSAGE.rules_failed });
    }
    const finished = await repo.finishRun({
      ledger: null,
      payloadJson: JSON.stringify(blueprint),
      run: { ...base, status: "SUCCEEDED", failureCode: null, blueprintHash: await blueprintHash(blueprint) },
    });
    if (!finished) return fail("in_progress", { runId });
    return { ok: true, runId, producer: "RULES", replayed: false, cache: null, blueprint: toStrategyListView(blueprint, runId, p.baseContentVersion), usage: null };
  }

  /** `runStart` refused: the same key (a parallel twin), the same context in flight, too many runs, or no reach any more. */
  async function startFailure(p: Prepared, reason: "duplicate_key" | "in_flight" | "busy" | "not_found", cacheKey: string | null = null): Promise<PlanningOutcome> {
    if (reason === "duplicate_key") {
      const twin = await repo.runByKey(p.planId, p.revisionId, p.idempotencyKey);
      if (!twin) return fail("not_found");
      if (twin.requestHash !== p.requestHash) return fail("key_reused");
      if (twin.status === "RUNNING") return fail("in_progress", { runId: twin.id });
      return replayOf(p.planId, p.revisionId, twin);
    }
    if (reason === "in_flight" && cacheKey) {
      const blocker = await repo.runningByCacheKey(p.planId, p.revisionId, cacheKey);
      return fail("in_progress", { ...(blocker ? { runId: blocker.id } : {}) });
    }
    if (reason === "busy") return fail("in_progress", { rulesOk: true });
    return fail("not_found");
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // AI
  // ---------------------------------------------------------------------------------------------------------------------------

  async function runAi(p: Prepared, now: Date, env: AiEnv, takeover: RunRow | null): Promise<PlanningOutcome> {
    const { bundle } = p;
    // 1. gate (database state + environment), before anything is built for a provider
    const snapshot = await freshGate(p.planId, p.revisionId, now, env);
    if (!snapshot.reach) return fail("not_found");
    const gateBase = gateStateFor(snapshot, env, { minor: bundle.minor });
    const early = evaluateAiGate(gateBase, "PLANNER");
    if (early !== "READY") return fail(GATE_TO_FAILURE[early]);
    const task = snapshot.taskSettings as TaskSettings;
    const kind = task.providerKind as ProviderKind;
    const modelId = task.modelId as string;
    const timeoutMs = Math.min(task.timeoutMs, env.hardTimeoutMs);
    const staleMs = staleAfterMs(timeoutMs, task.maxRetries);

    // 2. output budget and anonymised payload (the single choke point; fails closed)
    const shape = { phases: bundle.context.periodization.phases.map((ph) => ({ workouts: ph.workouts.length })) };
    const budget = outputBudget(shape, kind, task.maxOutputTokens, env.hardMaxOutputTokens);
    if (budget.tooLarge) return fail("request_too_large");
    const schema = toWireSchema(plannerResponseSchema, kind);
    let request: SafeProviderRequest;
    try {
      request = await buildProviderPayload(
        "PLANNER",
        { kind, system: PLANNER_SYSTEM_PROMPT, user: plannerUserMessage(bundle.context), schema, schemaName: PLANNER_SCHEMA_NAME, vocabularySchemas: [schema] },
        bundle.denyList,
      );
    } catch (error) {
      if (error instanceof PrivacyBlockedError) return fail("privacy_blocked");
      throw error;
    }
    if (request.estimatedInputTokens > task.maxInputTokens) return fail("request_too_large");
    const reservation: Reservation = reservationFor({
      estimatedInput: request.estimatedInputTokens, effectiveMaxOutput: budget.effectiveMaxOutput, maxRetries: task.maxRetries, prices: task.prices,
    });

    // The role table the model's deltas are relative to is the default ruleset's (its reference is stored with the blueprint).
    const rulesetFocus = roleFocusFromRuleSet();
    const roleFocus = rulesetFocus ?? ROLE_FOCUS_INTERIM_TABLE;
    const roleFocusRef = rulesetFocus ? rulesetRefText(DEFAULT_RULESET) : ROLE_FOCUS_INTERIM;

    // 3. cache lookup (a hit costs nothing) -- the cache is keyed by hashes only
    const cacheKey = await plannerCacheKey({
      task: "PLANNER", contextHash: bundle.contextHash, aliasMapHash: bundle.aliases.aliasMapHash, promptVersion: PLANNER_PROMPT_VERSION, schemaVersion: BLUEPRINT_VERSION,
      provider: kind, modelId, maxOutputTokens: budget.effectiveMaxOutput, roleFocusRef, strategiesMax: 3,
    });
    const producer = { kind: "AI" as const, provider: kind, modelId, promptVersion: PLANNER_PROMPT_VERSION };
    const validate = (raw: unknown) => validatePlannerResponse(raw, bundle, roleFocus, { producer, roleFocusRef });
    const runStartInput = (runId: string) => ({
      runId, planId: p.planId, revisionId: p.revisionId, idempotencyKey: p.idempotencyKey, requestHash: p.requestHash, mode: "AI" as const,
      baseContentVersion: p.baseContentVersion, structureFingerprint: bundle.refs.structureFingerprint, contextHash: bundle.contextHash,
      aliasesHash: bundle.aliases.aliasMapHash, cacheKey, providerKind: kind, modelId, promptVersion: PLANNER_PROMPT_VERSION, schemaVersion: BLUEPRINT_VERSION,
      templatesVersion: null, omittedJson: omittedJsonOf(bundle), now, staleBefore: new Date(now.getTime() - staleMs),
    });
    const cached = takeover ? null : await repo.cacheGet(p.planId, p.revisionId, cacheKey, now);
    if (cached) {
      let raw: unknown = null;
      try {
        raw = JSON.parse(cached.responseJson);
      } catch {
        raw = null;
      }
      const checked = raw === null ? null : validate(raw);
      if (checked?.ok) {
        const hit = await finishCacheHit(p, now, runStartInput(newId()), checked.blueprint, cached.responseHash, kind, modelId);
        if (hit) return hit;
      }
      // a cached answer that no longer validates against the CURRENT bundle is ignored (and replaced by the next successful call)
    }

    // 4. the full gate for THIS request (allowance for every attempt, cost cap, per-request cap), then the circuit breaker; nothing is created yet
    const need = { input: reservation.input, output: reservation.output, costMicros: reservation.costMicros };
    const full = evaluateAiGate(gateStateFor(snapshot, env, { minor: bundle.minor, need, perAttemptTokens: reservation.perAttemptTokens }), "PLANNER");
    if (full !== "READY") return fail(GATE_TO_FAILURE[full]);
    // The reservation sweep uses the SAME cutoff as the gate read (the widest window of the environment): shortening this task's timeout in the panel
    // must not make a call that is still alive look dead and turn its reservation into an unknown charge.
    const sweepMs = Math.max(staleMs, staleAfterMs(env.hardTimeoutMs, 1));
    const circuit = await repo.circuitCheck(kind, modelId, now, staleMs);
    if (!circuit.allowed) return fail("circuit_open");
    /** Nothing was sent: a probe won above goes back, or the circuit stays blocked until the probe goes stale. */
    const giveBackProbe = async () => {
      if (circuit.probe) await repo.circuitReleaseProbe(kind, modelId, now);
    };

    let runId: string;
    let attempt: number;
    const ledgerId = newId();
    if (takeover) {
      const claimed = await repo.takeoverRun({
        runId: takeover.id, expectedStartedAt: takeover.startedAt, expectedAttempt: takeover.attempt, oldLedgerId: takeover.ledgerId,
        oldInputEstimate: request.estimatedInputTokens,
        reserve: { planId: p.planId, revisionId: p.revisionId, task: "PLANNER", providerKind: kind, modelId, reservation, prices: task.prices, now, staleMs: sweepMs, runId: takeover.id, newLedgerId: ledgerId },
      });
      if (!claimed.ok) {
        if (claimed.claimed && claimed.attempt !== undefined) {
          // this caller won the run but the quota refused: end THIS attempt
          await repo.finishRun({
            ledger: null,
            run: { runId: takeover.id, planId: p.planId, revisionId: p.revisionId, attempt: claimed.attempt, status: "FAILED", failureCode: encodeFailure("limit_reached"), cacheHit: false, responseHash: null, blueprintHash: null, usageJson: null, ledgerId: null, now },
          });
          await giveBackProbe();
          return fail("limit_reached", { runId: takeover.id });
        }
        await giveBackProbe();
        return fail("in_progress", { runId: takeover.id });
      }
      runId = takeover.id;
      attempt = claimed.attempt as number;
    } else {
      runId = newId();
      attempt = 1;
      let started = await repo.runStart(runStartInput(runId));
      if (!started.ok && started.reason === "in_flight") {
        // a RUNNING run of another key holds the same cache key: if it is stale, close it (charging its reservation as unknown) and retry once
        const blocker = await repo.runningByCacheKey(p.planId, p.revisionId, cacheKey);
        if (blocker && now.getTime() - Date.parse(blocker.startedAt) >= staleMs) {
          await repo.expireStaleRun({ planId: p.planId, revisionId: p.revisionId, runId: blocker.id, expectedStartedAt: blocker.startedAt, oldLedgerId: blocker.ledgerId, oldInputEstimate: request.estimatedInputTokens, now });
          started = await repo.runStart(runStartInput(runId));
        }
      }
      if (!started.ok) {
        await giveBackProbe();
        return startFailure(p, started.reason, cacheKey);
      }
      const reserved = await repo.reserve({
        planId: p.planId, revisionId: p.revisionId, task: "PLANNER", ledgerId, requestKey: `${runId}:${attempt}`, runId, providerKind: kind, modelId, reservation,
        prices: task.prices, now, staleMs: sweepMs,
      });
      if (!reserved.ok) {
        // a predicate of the reserve refused: re-read the gate to say which (a switch flipped, the allowance, or the per-minute limit)
        const again = await freshGate(p.planId, p.revisionId, now, env);
        const why = evaluateAiGate(gateStateFor(again, env, { minor: bundle.minor, need, perAttemptTokens: reservation.perAttemptTokens }), "PLANNER");
        const reason: PlanFailure = why === "READY" ? "limit_reached" : GATE_TO_FAILURE[why];
        await giveBackProbe();
        await repo.finishRun({
          ledger: null,
          run: { runId, planId: p.planId, revisionId: p.revisionId, attempt, status: "FAILED", failureCode: encodeFailure(reason, why === "READY" ? "RATE" : undefined), cacheHit: false, responseHash: null, blueprintHash: null, usageJson: null, ledgerId: null, now },
        });
        return fail(reason, why === "READY" ? { runId, message: PLAN_MESSAGE.limit_rate } : { runId });
      }
    }
    const proof: Reserved = { ledgerId, runId, attempt };

    // 5. key, call, classification -- from here on the reservation MUST be closed (settle, release or charge as unknown)
    const finishFailed = async (ledger: Parameters<typeof repo.finishRun>[0]["ledger"], reason: PlanFailure, detail: string | undefined, usageJson: string | null, at: Date) => {
      await repo.finishRun({
        ledger,
        run: { runId, planId: p.planId, revisionId: p.revisionId, attempt, status: "FAILED", failureCode: encodeFailure(reason, detail), cacheHit: false, responseHash: null, blueprintHash: null, usageJson, ledgerId, now: at },
      });
      return fail(reason, { detail, runId });
    };
    let apiKey: string | null = null;
    if (kind !== "mock") {
      try {
        const sealed = await system.readKeyForCall(kind);
        if (!sealed) throw new Error("NO_KEY");
        apiKey = await openSecret(sealed, kind, env.secrets);
      } catch {
        // nothing was sent: the reservation is released (and a probe that was won goes back)
        await giveBackProbe();
        return finishFailed({ kind: "RELEASE", ledgerId, errorCode: "KEY_UNREADABLE", countAsFailure: true, now }, "not_configured", undefined, null, now);
      }
    }
    const provider = deps.providers?.[kind] ?? providerFor(kind);
    const settings: CallSettings = { kind, modelId, maxOutputTokens: budget.effectiveMaxOutput, timeoutMs, apiKey, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) };
    const called = await callGated(proof, provider, request, settings, task.maxRetries);
    const done = called.finishedAt;
    const result = called.result;
    const estimatedIn = request.estimatedInputTokens;

    if (!result.ok) {
      await repo.circuitFailure(kind, modelId, result.code, done);
      const spent = called.usage ?? result.usage;
      const tokensKnown = spent !== null && (spent.inputTokens !== null || spent.outputTokens !== null);
      const unknownCost = result.code === "TIMEOUT" || result.code === "NETWORK";
      const modelQuality = result.code === "INVALID_JSON" || result.code === "TRUNCATED" || result.code === "REFUSED";
      if (modelQuality) await repo.circuitSuccess(kind, modelId, done, called.sentAt);
      const ledger = tokensKnown
        ? settleAction(ledgerId, spent, estimatedIn, 0, task.prices, called.attempts, result.latencyMs, result.httpStatus, done)
        : unknownCost
          ? ({ kind: "CHARGE_UNKNOWN", ledgerId, inputTokens: estimatedIn, errorCode: result.code, attempts: called.attempts, latencyMs: result.latencyMs, now: done } as const)
          : ({ kind: "RELEASE", ledgerId, errorCode: result.code, countAsFailure: true, now: done } as const);
      const reason: PlanFailure = result.code === "TIMEOUT" ? "timeout" : modelQuality ? "invalid_response" : "provider_failed";
      return finishFailed(ledger, reason, result.code, tokensKnown ? usageJsonOf(spent, estimatedIn, 0, called.attempts) : null, done);
    }

    // the provider answered: any answer proves it is up
    await repo.circuitSuccess(kind, modelId, done, called.sentAt);
    const responseChars = (() => {
      try {
        return JSON.stringify(result.json)?.length ?? 0;
      } catch {
        return 0;
      }
    })();
    const estimatedOut = estimateTokens(responseChars);
    const usage = called.usage ?? result.usage;
    const settle = settleAction(ledgerId, usage, estimatedIn, estimatedOut, task.prices, called.attempts, result.latencyMs, 200, done);
    const usageJson = usageJsonOf(usage, estimatedIn, estimatedOut, called.attempts);
    const checked = validate(result.json);
    if (!checked.ok) {
      // tokens were spent: settle them; nothing is cached
      return finishFailed(settle, "invalid_response", "VALIDATION", usageJson, done);
    }
    const blueprint = checked.blueprint;
    const wireHash = await responseHash(result.json);
    const finished = await repo.finishRun({
      ledger: settle,
      cache: {
        planId: p.planId, revisionId: p.revisionId, cacheKey, task: "PLANNER", providerKind: kind, modelId, promptVersion: PLANNER_PROMPT_VERSION,
        responseJson: JSON.stringify(result.json), responseHash: wireHash, inputTokens: settle.inputTokens, outputTokens: settle.outputTokens, now: done,
        expiresAt: new Date(done.getTime() + env.cacheTtlDays * DAY_MS),
      },
      payloadJson: JSON.stringify(blueprint),
      run: {
        runId, planId: p.planId, revisionId: p.revisionId, attempt, status: "SUCCEEDED", failureCode: null, cacheHit: false, responseHash: wireHash,
        blueprintHash: await blueprintHash(blueprint), usageJson, ledgerId, now: done,
      },
    });
    // another caller took the run over while this one was waiting: its attempt is the live one
    if (!finished) return fail("in_progress", { runId });
    return {
      ok: true, runId, producer: "AI", replayed: false, cache: "MISS",
      blueprint: toStrategyListView(blueprint, runId, p.baseContentVersion), usage: { inputTokens: settle.inputTokens, outputTokens: settle.outputTokens },
    };
  }

  function settleAction(
    ledgerId: string, usage: Usage | null, estimatedIn: number, estimatedOut: number, prices: TaskSettings["prices"], attempts: number, latencyMs: number,
    httpStatus: number | null, at: Date,
  ) {
    const inputTokens = usage?.inputTokens ?? estimatedIn;
    const outputTokens = usage?.outputTokens ?? estimatedOut;
    const fromProvider = usage?.source === "PROVIDER" && usage.inputTokens !== null && usage.outputTokens !== null;
    return {
      kind: "SETTLE" as const, ledgerId, inputTokens, outputTokens, cachedInputTokens: usage?.cachedInputTokens ?? null,
      usageSource: fromProvider ? ("PROVIDER" as const) : ("ESTIMATE" as const), costMicros: costMicros(inputTokens, outputTokens, prices), prices, attempts, latencyMs, httpStatus, now: at,
    };
  }
  function usageJsonOf(usage: Usage | null, estimatedIn: number, estimatedOut: number, attempts: number): string {
    return JSON.stringify({
      inputTokens: usage?.inputTokens ?? estimatedIn, outputTokens: usage?.outputTokens ?? estimatedOut,
      source: usage?.source === "PROVIDER" && usage.inputTokens !== null && usage.outputTokens !== null ? "PROVIDER" : "ESTIMATE", attempts,
    });
  }

  /** A cache hit: a run, a 0-token SETTLED ledger row and the blueprint, with no provider call. Null = could not be recorded (fall through to a real call). */
  async function finishCacheHit(
    p: Prepared, now: Date, input: Parameters<typeof repo.runStart>[0], blueprint: TrainingBlueprint, cachedResponseHash: string, kind: ProviderKind, modelId: string,
  ): Promise<PlanningOutcome | null> {
    // A hit lasts milliseconds and calls nothing: it must not take the single-flight slot of its cache key (the hit is linked to the cached answer by its response hash).
    const started = await repo.runStart({ ...input, cacheKey: null });
    if (!started.ok) return startFailure(p, started.reason, null);
    const ledgerId = newId();
    const recorded = await repo.recordCacheHit({ planId: p.planId, revisionId: p.revisionId, task: "PLANNER", ledgerId, requestKey: `${input.runId}:1`, providerKind: kind, modelId, now });
    const base = { runId: input.runId, planId: p.planId, revisionId: p.revisionId, attempt: 1, cacheHit: true, now };
    if (!recorded) {
      await repo.finishRun({
        ledger: null,
        run: { ...base, status: "FAILED", failureCode: encodeFailure("not_found"), responseHash: null, blueprintHash: null, usageJson: null, ledgerId: null },
      });
      return fail("not_found", { runId: input.runId });
    }
    const usageJson = JSON.stringify({ inputTokens: 0, outputTokens: 0, source: "CACHE", attempts: 0 });
    const finished = await repo.finishRun({
      ledger: null,
      payloadJson: JSON.stringify(blueprint),
      run: { ...base, status: "SUCCEEDED", failureCode: null, responseHash: cachedResponseHash, blueprintHash: await blueprintHash(blueprint), usageJson, ledgerId },
    });
    if (!finished) return fail("in_progress", { runId: input.runId });
    return { ok: true, runId: input.runId, producer: "AI", replayed: false, cache: "HIT", blueprint: toStrategyListView(blueprint, input.runId, p.baseContentVersion), usage: { inputTokens: 0, outputTokens: 0 } };
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // public surface
  // ---------------------------------------------------------------------------------------------------------------------------

  return {
    /** GEN-01: can the AI be offered for this revision? Reads only; calls nothing external. `null` = the revision is not reachable. */
    async availability(planId: string, revisionId: string): Promise<Availability | null> {
      const now = clock();
      const env = await getEnv();
      const snapshot = await freshGate(planId, revisionId, now, env);
      if (!snapshot.reach) return null;
      const state = evaluateAiGate(gateStateFor(snapshot, env), "PLANNER");
      return { state, message: state === "READY" ? "" : GATE_MESSAGE[state], usage: await repo.usageForProfessional(now) };
    },

    async plan(planId: string, revisionId: string, payload: PlanPayload): Promise<PlanningOutcome> {
      const parsed = planSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      if (carriesBlueprint(parsed.data.answers)) return fail("invalid", { message: CLIENT_BLUEPRINT_REFUSED });
      let answers: GenerationAnswers;
      try {
        answers = parseGenerationAnswers(parsed.data.answers);
      } catch (error) {
        if (error instanceof ZodError) return fail("invalid", { message: "Confira as respostas: algum valor não é aceito (código, número ou lista)." });
        throw error;
      }
      const now = clock();
      const { idempotencyKey, baseContentVersion, mode } = parsed.data;
      const requestHash = await sha256Hex(canonicalJson({ kind: "PLAN", planId, revisionId, baseContentVersion, mode, answers }));

      // idempotent replay (reach is proven by the repository's revision gate: another organization or a revoked assignment sees nothing)
      let takeover: RunRow | null = null;
      const existing = await repo.runByKey(planId, revisionId, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) return fail("key_reused");
        if (existing.status !== "RUNNING") return replayOf(planId, revisionId, existing);
        const env = await getEnv();
        const staleMs = staleAfterMs(env.hardTimeoutMs, 1);
        if (now.getTime() - Date.parse(existing.startedAt) < staleMs) return fail("in_progress", { runId: existing.id });
        if (existing.mode === "RULES") {
          await repo.expireStaleRun({ planId, revisionId, runId: existing.id, expectedStartedAt: existing.startedAt, oldLedgerId: null, oldInputEstimate: 0, now });
          return fail("stale", { runId: existing.id });
        }
        takeover = existing;
      }

      const loaded = await loadGenerationContext(db, context, planId, revisionId, { now });
      if (loaded.status === "not_found") return fail("not_found");
      if (loaded.status === "not_open") return fail("not_open");
      const gen = loaded.context;
      if (gen.revision.contentVersion !== baseContentVersion) return fail("revision_changed");

      const env = await getEnv();
      // Fail fast and cheap for AI: when the gate is closed there is nothing to build for a provider.
      if (mode === "AI" && !takeover) {
        const snapshot = await freshGate(planId, revisionId, now, env);
        if (!snapshot.reach) return fail("not_found");
        const closed = evaluateAiGate(gateStateFor(snapshot, env), "PLANNER");
        if (closed !== "READY") return fail(GATE_TO_FAILURE[closed]);
      }

      const student = await studentsFor(db, context).findById(gen.plan.studentId);
      const built = await buildPlanningContext(gen, {
        organizationId: context.organizationId,
        answers,
        rules: DEFAULT_RULESET,
        identifiers: [student?.displayName, ...(deps.extraIdentifiers ?? [])],
      });
      if (!built.ok) {
        if (built.code === "STRUCTURE_TOO_LARGE") return fail("structure_too_large");
        return fail("invalid", {
          message: built.build.code === "UNKNOWN_EXERCISE"
            ? "Alguma resposta cita um exercício que não existe na biblioteca."
            : "Alguma resposta cita uma fase ou um treino que não existe na periodização salva.",
        });
      }
      if (!built.build.ready) return fail("questions", { questions: built.build.questions });

      const prepared: Prepared = { planId, revisionId, idempotencyKey, requestHash, baseContentVersion, bundle: built.bundle };
      return mode === "RULES" ? runRules(prepared, now) : runAi(prepared, now, env, takeover);
    },

    /** The explicit state of the revision's planning, for polling screens. Reads only. */
    async state(planId: string, revisionId: string): Promise<PlanningState> {
      const now = clock();
      const run = await repo.latestRun(planId, revisionId);
      if (!run) return { state: "NONE" };
      if (run.status === "RUNNING") {
        const env = await getEnv();
        if (now.getTime() - Date.parse(run.startedAt) < staleAfterMs(env.hardTimeoutMs, 1)) return { state: "GENERATING", runId: run.id, mode: run.mode };
        return { state: "FAILED", runId: run.id, reason: "stale", message: messageFor("stale"), canContinueByRules: true };
      }
      if (run.status === "FAILED") {
        const { reason, detail } = decodeFailure(run.failureCode);
        return { state: "FAILED", runId: run.id, reason, message: messageFor(reason, detail), canContinueByRules: RULES_IS_THE_WAY_OUT.has(reason) };
      }
      const current = await repo.currentContentVersion(planId, revisionId);
      if (current === null) return { state: "NONE" };
      if (current !== run.baseContentVersion) return { state: "STALE", runId: run.id, message: PLAN_MESSAGE.revision_changed };
      const blueprint = readBlueprint(await repo.payloadOf(planId, revisionId, run.id));
      return blueprint ? { state: "READY", view: viewOf(run, blueprint) } : { state: "NONE" };
    },

    /** The newest successfully suggested strategies (AI or rules) of the revision, or null (none yet, or erased with the student's data). */
    async latest(planId: string, revisionId: string): Promise<StrategyListView | null> {
      const run = await repo.latestRun(planId, revisionId, "SUCCEEDED");
      if (!run) return null;
      // suggestions made for another version of the draft are not served
      if ((await repo.currentContentVersion(planId, revisionId)) !== run.baseContentVersion) return null;
      const blueprint = readBlueprint(await repo.payloadOf(planId, revisionId, run.id));
      return blueprint ? viewOf(run, blueprint) : null;
    },
  };
}
