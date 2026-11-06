import "server-only";
/**
 * Assisted adjustments of a proposal (design V4 §6, sub-stage 4.3b): ONE server path that turns a structured request ("trocar este item por
 * uma alternativa em máquina, sem aumentar o volume de costas", or "séries 4") into a suggestion with a before/after comparison, and applies
 * ONLY that point change to the proposal when the professional says so.
 *
 *   parse -> idempotent replay -> proposal (OPEN, version) + engine input -> resolve the target
 *     STRUCTURED: the professional's own pick (engine alternative) or typed dose values -> simulate -> constraints -> diff -> persist
 *     AI        : gate -> compact anonymised context + scan -> cache -> single-flight request -> reserve -> provider (one call)
 *                 -> bind the answer to the offered aliases -> simulate -> constraints -> diff -> settle + persist
 *
 * The model's only job is to CHOOSE among the engine-ranked eligible alternatives; the engine validates, recomputes volume, duration and
 * audit, and checks the professional's constraints on the numbers. Nothing here approves, applies to the draft or delivers: the proposal
 * changes only in `apply`, through the proposal service's compare-and-set path (a new version, nothing else regenerated).
 *
 * Same gate, budget, ledger, cache, circuit and privacy choke point as the planner (task ADJUSTMENTS). Nothing logs: the prompt, the answer
 * and the keys never leave this module; the suggestion stored is codes, real ids and the diff (deletable with the student's data).
 */
import type { D1Database } from "@cloudflare/workers-types";
import { aiAdjustmentsFor, type AdjustmentRow } from "@/db/ai-adjustments";
import { aiPlanningFor, aiSystemFor, type TaskSettings } from "@/db/ai-planning";
import { proposalsFor } from "@/db/prescription-proposals";
import { studentsFor, type AuthenticatedContext } from "@/db/students";
import { loadGenerationContext } from "@/modules/prescricao/automatica/context";
import { lockedOf, parseAnswers, prepare, proposalService, rulesOf, type Built } from "@/modules/prescricao/automatica/service";
import { evaluateConstraints, simulateAdjustments, type ConstraintCheck, type ResolvedConstraint, type ResolvedOp } from "@/modules/prescricao/motor/adjust";
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor/hash";
import { alternativesFor } from "@/modules/prescricao/motor/regenerate";
import { parseSlotKey } from "@/modules/prescricao/motor/select";
import type { Alternative, CatalogExercise, EngineResult, ItemOut } from "@/modules/prescricao/motor/types";
import { MUSCLES } from "@/modules/biblioteca/metadata/vocabulary";
import {
  ADJUST_MAX_ALTERNATIVES, ADJUST_MAX_RESPONSE_CHARS, ADJUST_SUGGESTION_TTL_MS, adjustmentApplySchema, adjustmentDecisionSchema, adjustmentRequestSchema, CLARIFICATION_TEXT,
  constraintText, dosePatchOf, intentSchema, modelAdjustmentSchema, REASON_TEXT, requestSentence, substitutionTargetOf, type AdjustIntent, type AdjustOp, type AdjustReasonCode,
  type Clarification, type ConstraintKind,
} from "./adjust";
import { buildAdjustContext, validateModelAdjustment, type AdjustContextBundle } from "./adjust-context";
import { diffResults, type AdjustmentDiff } from "./adjust-diff";
import { resolveAiEnv, type AiEnv } from "./config";
import { buildPlanningContext } from "./context";
import { GATE_MESSAGE } from "./copy";
import { loadAiEnv } from "./env";
import { evaluateAiGate, type AiGateState, type GateReason } from "./gate";
import { plannerCacheKey, responseHash } from "./hashes";
import { buildProviderPayload, PrivacyBlockedError } from "./privacy";
import { ADJUST_SCHEMA_NAME, ADJUST_SYSTEM_PROMPT, adjustUserMessage } from "./prompt";
import { callWithPolicy } from "./provedores/policy";
import type { CallSettings, PlannerProvider, ProviderKind, ProviderResult, SafeProviderRequest, Usage } from "./provedores/port";
import { providerFor } from "./provedores/registry";
import { toWireSchema } from "./provedores/wire-schema";
import { AI_RETRY_DELAY_MS, costMicros, estimateTokens, monthKey, reservationFor, staleAfterMs, THINKING_ALLOWANCE_TOKENS, type Reservation } from "./quota";
import { openSecret } from "./secrets";
import { ADJUST_PROMPT_VERSION } from "./versions";

export type AdjustFailure =
  | "invalid" | "not_found" | "not_open" | "conflict" | "key_reused" | "in_progress" | "revision_changed" | "invalid_target" | "engine_refused" | "stale" | "expired"
  | "changed" | "blocked" | "already_decided" | "structure_too_large"
  | "disabled" | "not_configured" | "org_disabled" | "no_plan" | "limit_reached" | "request_too_large" | "circuit_open" | "minor_blocked" | "privacy_blocked"
  | "provider_failed" | "timeout" | "invalid_response";

const GATE_TO_FAILURE: Record<GateReason, AdjustFailure> = {
  KILL_SWITCH_ENV: "disabled", KILL_SWITCH_PANEL: "disabled", SECRETS_KEY_MISSING: "not_configured", TASK_NOT_MAPPED: "not_configured",
  PROVIDER_NOT_CONNECTED: "not_configured", ORG_DISABLED: "org_disabled", NO_QUOTA_PLAN: "no_plan", ALLOWANCE_ZERO: "no_plan", ALLOWANCE_EXHAUSTED: "limit_reached",
  COST_CURRENCY_MISMATCH: "no_plan", CIRCUIT_OPEN: "circuit_open", MINOR_BLOCKED: "minor_blocked", REQUEST_TOO_LARGE: "request_too_large",
};
const GATE_FAILURES: ReadonlySet<AdjustFailure> = new Set<AdjustFailure>(Object.values(GATE_TO_FAILURE));
/** pt-BR, shown as is: no plan data, no health text. Failures of the AI always point to the engine's alternatives. */
export const ADJUST_MESSAGE: Record<AdjustFailure, string> = {
  invalid: "Pedido inválido. Recarregue a página e tente de novo.",
  not_found: "Plano, proposta ou ajuste não encontrados para você.",
  not_open: "A revisão não está mais em rascunho: a proposta não pode ser alterada. Revisões aprovadas e entregues não mudam.",
  conflict: "A proposta mudou desde o pedido. Peça de novo.",
  key_reused: "Esta ação já foi enviada com outros dados. Recarregue a página.",
  in_progress: "Este pedido ainda está sendo processado. Aguarde um instante.",
  revision_changed: "O rascunho mudou desde a geração. Atualize a proposta com o rascunho atual antes de ajustar.",
  invalid_target: "O item escolhido não está nesta proposta.",
  engine_refused: "O motor não conseguiu simular este ajuste.",
  stale: "A proposta mudou desde o pedido. Peça de novo.",
  expired: "Esta sugestão expirou (mais de 24 horas). Peça de novo.",
  changed: "O efeito do ajuste mudou desde o pedido. Peça de novo para ver o efeito atual.",
  blocked: "O ajuste não pode ser aplicado como foi simulado.",
  already_decided: "Esta sugestão já foi aplicada ou descartada.",
  structure_too_large: "A periodização é grande demais para a IA: use as alternativas do motor.",
  disabled: GATE_MESSAGE.KILL_SWITCH_ENV, not_configured: GATE_MESSAGE.TASK_NOT_MAPPED, org_disabled: GATE_MESSAGE.ORG_DISABLED, no_plan: GATE_MESSAGE.NO_QUOTA_PLAN,
  limit_reached: GATE_MESSAGE.ALLOWANCE_EXHAUSTED, request_too_large: GATE_MESSAGE.REQUEST_TOO_LARGE, circuit_open: GATE_MESSAGE.CIRCUIT_OPEN, minor_blocked: GATE_MESSAGE.MINOR_BLOCKED,
  privacy_blocked: "Não foi possível enviar com segurança: o resumo continha um dado de identificação. Nada foi enviado. Use as alternativas do motor.",
  provider_failed: "Falha da IA. Nada foi alterado. Use as alternativas do motor.",
  timeout: "A IA demorou demais para responder. Nada foi alterado. Tente de novo ou use as alternativas do motor.",
  invalid_response: "A IA devolveu uma resposta que o motor não aceitou. Nada foi alterado. Tente de novo ou use as alternativas do motor.",
};
/** The way out of every AI failure is the engine's own list; the others are about the request itself. */
const ENGINE_IS_THE_WAY_OUT: ReadonlySet<AdjustFailure> = new Set<AdjustFailure>([...GATE_FAILURES, "privacy_blocked", "provider_failed", "timeout", "invalid_response", "structure_too_large"]);

const fail = (reason: AdjustFailure, extra: { message?: string; version?: number } = {}): AdjustFailureOutcome => ({
  ok: false, reason, message: extra.message ?? ADJUST_MESSAGE[reason], canUseEngine: ENGINE_IS_THE_WAY_OUT.has(reason), ...(extra.version !== undefined ? { version: extra.version } : {}),
});
export interface AdjustFailureOutcome {
  ok: false;
  reason: AdjustFailure;
  message: string;
  /** Show "use as alternativas do motor": the structured list works without the AI. */
  canUseEngine: boolean;
  version?: number;
}

// ---------- what the screens read ----------

export interface SuggestionView {
  adjustmentId: string;
  proposalId: string;
  baseVersion: number;
  createdAt: string;
  expiresAt: string;
  mode: "AI" | "STRUCTURED";
  /** "Profissional" card: built by the server from the chips and the names it resolved. */
  request: { op: AdjustOp; text: string };
  /** "IA · Sugestão" card (or "Alternativa escolhida" in the structured mode). */
  suggestion: {
    text: string;
    replacementName: string | null;
    reasons: Array<{ code: AdjustReasonCode; text: string }>;
    clarification: { code: Clarification; text: string } | null;
    /** Constraint kinds the model did not say it considered (the engine's check is what counts). */
    echoMissing: ConstraintKind[];
  };
  diff: AdjustmentDiff | null;
  /** Dose operations a weekly progression overwrites in every week. */
  noEffect: string | null;
  canApply: boolean;
  blockedReason: string | null;
  needsAcknowledgement: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
  cache: "HIT" | "MISS" | null;
}
interface Stored {
  v: 1;
  intent: AdjustIntent;
  ops: ResolvedOp[];
  diffHash: string | null;
  view: Omit<SuggestionView, "adjustmentId" | "proposalId" | "baseVersion" | "createdAt" | "expiresAt" | "mode" | "usage" | "cache">;
}

export type AdjustOutcome = { ok: true; replayed: boolean; suggestion: SuggestionView } | AdjustFailureOutcome;

export interface AlternativeView {
  exerciseId: string;
  name: string;
  metadata: string;
  reasons: string[];
  /** The professional's constraints evaluated on THIS alternative (no provider involved). */
  checks: Array<{ text: string; status: ConstraintCheck["status"]; detail: string | null }>;
  verdict: "OK" | "VIOLATED" | "UNCHECKABLE";
  impact: { sessions: number; minutesDelta: number | null };
}
export type AlternativesOutcome = { ok: true; alternatives: AlternativeView[] } | AdjustFailureOutcome;

export type AdjustApplyOutcome = { ok: true; version: number; replayed: boolean } | AdjustFailureOutcome;

export interface AdjustAvailability {
  state: "READY" | GateReason;
  message: string;
  usage: Awaited<ReturnType<ReturnType<typeof aiPlanningFor>["usageForProfessional"]>>;
}

export interface AdjustDeps {
  now?: () => Date;
  providers?: Partial<Record<ProviderKind, PlannerProvider>>;
  readEnv?: (name: string) => string | undefined;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
  extraIdentifiers?: ReadonlyArray<string | null | undefined>;
}

const muscleName = (code: string) => MUSCLES[code] ?? code;
const catalogOf = (items: readonly CatalogExercise[]) => new Map(items.map((e) => [e.id, e] as const));
const DAY_MS = 86_400_000;

/** Proof that the gate passed and a reservation was made for this request. Only `callGated` accepts it. */
interface Reserved {
  readonly ledgerId: string;
  readonly requestId: string;
}

interface Workbench {
  header: NonNullable<Awaited<ReturnType<ReturnType<typeof proposalsFor>["asEngineResult"]>>>["header"];
  previous: EngineResult;
  ctx: Awaited<ReturnType<typeof loadGenerationContext>> extends infer L ? (L extends { status: "ok"; context: infer C } ? C : never) : never;
  built: Built;
  answers: NonNullable<ReturnType<typeof parseAnswers>>;
}

export function adjustService(db: D1Database, context: AuthenticatedContext, deps: AdjustDeps = {}) {
  const clock = deps.now ?? (() => new Date());
  const repo = aiAdjustmentsFor(db, context);
  const planning = aiPlanningFor(db, context);
  const system = aiSystemFor(db, context);
  const proposals = proposalsFor(db, context);
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const getEnv = async (): Promise<AiEnv> => (deps.readEnv ? resolveAiEnv(deps.readEnv) : loadAiEnv());

  const gateStateFor = (snapshot: Awaited<ReturnType<typeof planning.gateState>>, env: AiEnv, extra: Partial<AiGateState> = {}): AiGateState => ({
    ...snapshot.state, envKill: env.killSwitch, secretsKeyOk: env.secrets !== null, mockEnabled: env.mockEnabled, circuitOpen: false, ...extra,
  });
  async function freshGate(planId: string, revisionId: string, now: Date, env: AiEnv) {
    await planning.sweepStale(monthKey(now), now, staleAfterMs(env.hardTimeoutMs, 1));
    return planning.gateState(planId, revisionId, "ADJUSTMENTS", now);
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // the proposal, as it is NOW
  // ---------------------------------------------------------------------------------------------------------------------------

  async function workbench(planId: string, revisionId: string, proposalId: string, expectedVersion: number | null, now: Date): Promise<{ ok: true; work: Workbench } | AdjustFailureOutcome> {
    const snap = await proposals.asEngineResult(planId, revisionId, proposalId);
    if (!snap) return fail("not_found");
    const { header, result } = snap;
    if (header.state !== "OPEN") return fail("not_open", { message: "Esta proposta já foi fechada (aplicada, descartada ou substituída). Os ajustes valem para a proposta aberta." });
    if (expectedVersion !== null && header.version !== expectedVersion) return fail("conflict", { version: header.version });
    const answers = parseAnswers(header.parameters);
    if (!answers) return fail("invalid", { message: "As respostas desta proposta não são mais aceitas pelas regras atuais. Descarte e gere de novo." });
    const prepared = await prepare(db, context, planId, revisionId, answers, lockedOf(result), now, rulesOf(header));
    if (!prepared.ok) return fail(prepared.outcome.ok ? "not_found" : prepared.outcome.reason === "not_open" ? "not_open" : prepared.outcome.reason === "not_found" ? "not_found" : "invalid", {
      message: prepared.outcome.ok ? undefined : prepared.outcome.message,
    });
    if (prepared.ctx.revision.contentVersion !== header.baseContentVersion) return fail("revision_changed");
    return { ok: true, work: { header, previous: result, ctx: prepared.ctx as Workbench["ctx"], built: prepared.built, answers } };
  }

  /** The item the request points at, as the proposal has it (the first session of the scope that carries it). */
  function targetItem(work: Workbench, intent: AdjustIntent): { item: ItemOut; label: string } | null {
    const parsed = parseSlotKey(intent.target.slotKey);
    if (!parsed || parsed.phaseIndex !== intent.target.phaseIndex || parsed.label !== intent.target.label) return null;
    const occ = work.previous.occurrences.find(
      (o) => o.phaseIndex === parsed.phaseIndex && o.label === parsed.label && (intent.target.week === undefined || o.week === intent.target.week) && o.items.some((i) => i.slotKey === intent.target.slotKey),
    );
    const item = occ?.items.find((i) => i.slotKey === intent.target.slotKey);
    return item && item.exerciseId ? { item, label: parsed.label } : null;
  }

  /** Rank wide, filter by the catalog-level constraints, and only then cap: the 9th ranked machine must not be lost to eight free weights. */
  const ADJUST_RANK_POOL = 200;

  function alternativesOf(work: Workbench, intent: AdjustIntent): Alternative[] {
    const t = intent.target;
    return alternativesFor(work.built.input, work.previous, {
      phaseIndex: t.phaseIndex, slotKey: t.slotKey, ...(intent.scope === "OCCURRENCE" && t.week !== undefined && t.slot !== undefined ? { week: t.week, slot: t.slot } : {}),
    }, ADJUST_RANK_POOL, ADJUST_RANK_POOL);
  }

  /** Catalog-level constraints (same pattern, equipment) prune the options offered to the model; the engine still checks everything afterwards. */
  function prune(alternatives: Alternative[], from: CatalogExercise | undefined, constraints: readonly ResolvedConstraint[], catalog: ReadonlyMap<string, CatalogExercise>): Alternative[] {
    return alternatives.filter((a) => {
      const to = catalog.get(a.exerciseId);
      if (!to) return false;
      for (const c of constraints) {
        if (c.kind === "SAME_PATTERN" && from && from.patterns.length && !to.patterns.some((p) => from.patterns.includes(p))) return false;
        if (c.kind === "EQUIPMENT_CLASS" && to.equipmentKnown !== false && ![to.equipment, ...to.equipmentAlternatives].some((set) => set.includes(c.equipment))) return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // simulation -> suggestion
  // ---------------------------------------------------------------------------------------------------------------------------

  async function simulate(work: Workbench, intent: AdjustIntent, ops: ResolvedOp[]): Promise<{ ok: true; stored: Stored; diff: AdjustmentDiff } | AdjustFailureOutcome> {
    const sim = simulateAdjustments(work.built.input, work.previous, ops);
    if (!sim.ok) return fail("engine_refused", { message: sim.message });
    const catalog = catalogOf(work.ctx.catalog);
    const constraints = intent.constraints as ResolvedConstraint[];
    const checks = evaluateConstraints(work.previous, sim.result, constraints, catalog, ops, muscleName);
    const diff = diffResults(work.previous, sim.result, checks);
    const found = targetItem(work, intent);
    const itemName = found?.item.exerciseName ?? "o exercício";
    const sub = ops.find((o): o is Extract<ResolvedOp, { kind: "SUBSTITUTE_EXERCISE" }> => o.kind === "SUBSTITUTE_EXERCISE");
    const replacementName = sub ? catalog.get(sub.newExerciseId)?.name ?? null : null;
    const violated = checks.find((c) => c.status === "VIOLATED");
    const noEffect = sim.noEffect.length ? "Sem efeito: a progressão da fase define este valor em todas as semanas." : null;
    const blockedReason = noEffect ?? (violated ? violated.detail : null);
    const view: Stored["view"] = {
      request: { op: intent.op, text: requestSentence(intent, { item: itemName, workout: intent.target.label }) },
      suggestion: {
        text: sub ? `Trocar ${itemName} por ${replacementName ?? "a alternativa escolhida"}` : requestSentence({ ...intent, constraints: [] }, { item: itemName, workout: intent.target.label }),
        replacementName, reasons: [], clarification: null, echoMissing: [],
      },
      diff, noEffect, canApply: blockedReason === null, blockedReason, needsAcknowledgement: checks.some((c) => c.status === "UNCHECKABLE"),
    };
    return { ok: true, diff, stored: { v: 1, intent, ops, diffHash: await sha256Hex(canonicalJson(diff)), view } };
  }

  function viewOf(row: Pick<AdjustmentRow, "id" | "proposalId" | "baseVersion" | "startedAt" | "mode" | "cacheHit" | "usageJson">, stored: Stored): SuggestionView {
    let usage: SuggestionView["usage"] = null;
    try {
      const u = row.usageJson ? (JSON.parse(row.usageJson) as { inputTokens?: unknown; outputTokens?: unknown }) : null;
      if (u && typeof u.inputTokens === "number" && typeof u.outputTokens === "number") usage = { inputTokens: u.inputTokens, outputTokens: u.outputTokens };
    } catch {
      usage = null;
    }
    return {
      ...stored.view, adjustmentId: row.id, proposalId: row.proposalId, baseVersion: row.baseVersion, createdAt: row.startedAt,
      expiresAt: new Date(Date.parse(row.startedAt) + ADJUST_SUGGESTION_TTL_MS).toISOString(), mode: row.mode, usage,
      cache: row.mode === "AI" ? (row.cacheHit ? "HIT" : "MISS") : null,
    };
  }

  function readStored(json: string | null): Stored | null {
    if (!json) return null;
    try {
      const v = JSON.parse(json) as Stored;
      return v && v.v === 1 && Array.isArray(v.ops) && v.view ? v : null;
    } catch {
      return null;
    }
  }

  const requestHashOf = (planId: string, revisionId: string, p: { proposalId: string; expectedVersion: number; intent: AdjustIntent }) =>
    sha256Hex(canonicalJson({ kind: "ADJUST", planId, revisionId, proposalId: p.proposalId, expectedVersion: p.expectedVersion, intent: p.intent }));

  async function replayOf(planId: string, revisionId: string, row: AdjustmentRow): Promise<AdjustOutcome> {
    if (row.status === "FAILED") {
      const reason = (row.failureCode ?? "invalid_response").split(":")[0] as AdjustFailure;
      return fail(reason in ADJUST_MESSAGE ? reason : "invalid_response");
    }
    const stored = readStored(await repo.payloadOf(planId, revisionId, row.id));
    // The suggestion is deleted with the student's data: an erased request cannot be replayed.
    if (!stored) return fail("not_found");
    return { ok: true, replayed: true, suggestion: viewOf(row, stored) };
  }

  /** Persist a suggestion that needed no provider (the professional's pick, typed numbers, or "no alternative"). */
  async function persistStructured(
    planId: string, revisionId: string, p: { proposalId: string; expectedVersion: number; idempotencyKey: string }, requestHash: string, intent: AdjustIntent, stored: Stored, now: Date,
  ): Promise<AdjustOutcome> {
    const id = newId();
    const requestJson = canonicalJson({ intent });
    const started = await repo.start({
      id, planId, revisionId, proposalId: p.proposalId, baseVersion: p.expectedVersion, idempotencyKey: p.idempotencyKey, requestHash, requestJson: requestJson.length <= 2000 ? requestJson : "{}",
      mode: "STRUCTURED", contextHash: null, cacheKey: null, providerKind: null, modelId: null, promptVersion: null, now,
    });
    if (!started.ok) return startFailure(planId, revisionId, p, requestHash, started.reason);
    const finished = await repo.finish({
      requestId: id, planId, revisionId, attempt: 1, status: "SUCCEEDED", failureCode: null, cacheHit: false, responseHash: null, usageJson: null, ledgerId: null, now,
      payloadJson: JSON.stringify(stored),
    });
    if (!finished) return fail("in_progress");
    const row = await repo.requestById(planId, revisionId, id);
    return row ? { ok: true, replayed: false, suggestion: viewOf(row, stored) } : fail("not_found");
  }

  async function startFailure(planId: string, revisionId: string, p: { proposalId: string; idempotencyKey: string }, requestHash: string, reason: "duplicate_key" | "in_flight" | "busy" | "not_found"): Promise<AdjustOutcome> {
    if (reason === "duplicate_key") {
      const twin = await repo.requestByKey(planId, revisionId, p.proposalId, p.idempotencyKey);
      if (!twin) return fail("not_found");
      if (twin.requestHash !== requestHash) return fail("key_reused");
      if (twin.status === "RUNNING") return fail("in_progress");
      return replayOf(planId, revisionId, twin);
    }
    if (reason === "in_flight" || reason === "busy") return fail("in_progress", { message: "Já há um pedido de IA em andamento. Aguarde um instante ou use as alternativas do motor." });
    return fail("not_found");
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // the single gated provider call
  // ---------------------------------------------------------------------------------------------------------------------------

  async function callGated(proof: Reserved, provider: PlannerProvider, request: SafeProviderRequest, settings: CallSettings, maxRetries: 0 | 1) {
    void proof;
    const sentAt = clock();
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
        return { result, attempts: maxRetries + 1, usage: null as Usage | null, sentAt, finishedAt: clock() };
      }
      return { ...winner, sentAt, finishedAt: clock() };
    } catch {
      const result: ProviderResult = { ok: false, code: "NETWORK", httpStatus: null, retryable: false, retryAfterMs: null, usage: null, latencyMs: 0 };
      return { result, attempts: 1, usage: null as Usage | null, sentAt, finishedAt: clock() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function settleAction(ledgerId: string, usage: Usage | null, estimatedIn: number, estimatedOut: number, prices: TaskSettings["prices"], attempts: number, latencyMs: number, httpStatus: number | null, at: Date) {
    const inputTokens = usage?.inputTokens ?? estimatedIn;
    const outputTokens = usage?.outputTokens ?? estimatedOut;
    const fromProvider = usage?.source === "PROVIDER" && usage.inputTokens !== null && usage.outputTokens !== null;
    return {
      kind: "SETTLE" as const, ledgerId, inputTokens, outputTokens, cachedInputTokens: usage?.cachedInputTokens ?? null,
      usageSource: fromProvider ? ("PROVIDER" as const) : ("ESTIMATE" as const), costMicros: costMicros(inputTokens, outputTokens, prices), prices, attempts, latencyMs, httpStatus, now: at,
    };
  }
  const usageJsonOf = (usage: Usage | null, estimatedIn: number, estimatedOut: number, attempts: number) =>
    JSON.stringify({
      inputTokens: usage?.inputTokens ?? estimatedIn, outputTokens: usage?.outputTokens ?? estimatedOut,
      source: usage?.source === "PROVIDER" && usage.inputTokens !== null && usage.outputTokens !== null ? "PROVIDER" : "ESTIMATE", attempts,
    });

  // ---------------------------------------------------------------------------------------------------------------------------
  // AI
  // ---------------------------------------------------------------------------------------------------------------------------

  async function suggestWithAi(
    planId: string, revisionId: string, p: { proposalId: string; expectedVersion: number; idempotencyKey: string }, requestHash: string, intent: AdjustIntent,
    work: Workbench, now: Date, env: AiEnv,
  ): Promise<AdjustOutcome> {
    const snapshot = await freshGate(planId, revisionId, now, env);
    if (!snapshot.reach) return fail("not_found");
    const early = evaluateAiGate(gateStateFor(snapshot, env), "ADJUSTMENTS");
    if (early !== "READY") return fail(GATE_TO_FAILURE[early]);

    const catalog = catalogOf(work.ctx.catalog);
    const found = targetItem(work, intent);
    if (!found) return fail("invalid_target");
    const constraints = intent.constraints as ResolvedConstraint[];
    const offered = prune(alternativesOf(work, intent), catalog.get(found.item.exerciseId as string), constraints, catalog).slice(0, ADJUST_MAX_ALTERNATIVES);
    if (!offered.length) {
      // Nothing to choose from: no provider is called and nothing is reserved. The answer is recorded like any other suggestion.
      const stored: Stored = {
        v: 1, intent, ops: [], diffHash: null,
        view: {
          request: { op: intent.op, text: requestSentence(intent, { item: found.item.exerciseName, workout: intent.target.label }) },
          suggestion: { text: CLARIFICATION_TEXT.NO_ELIGIBLE_ALTERNATIVE, replacementName: null, reasons: [], clarification: { code: "NO_ELIGIBLE_ALTERNATIVE", text: CLARIFICATION_TEXT.NO_ELIGIBLE_ALTERNATIVE }, echoMissing: [] },
          diff: null, noEffect: null, canApply: false, blockedReason: CLARIFICATION_TEXT.NO_ELIGIBLE_ALTERNATIVE, needsAcknowledgement: false,
        },
      };
      return persistStructured(planId, revisionId, p, requestHash, intent, stored, now);
    }

    const student = await studentsFor(db, context).findById(work.ctx.plan.studentId);
    const planningBundle = await buildPlanningContext(work.ctx, {
      organizationId: context.organizationId, answers: work.answers, rules: rulesOf(work.header), locked: lockedOf(work.previous),
      identifiers: [student?.displayName, ...(deps.extraIdentifiers ?? [])],
    });
    if (!planningBundle.ok) return planningBundle.code === "STRUCTURE_TOO_LARGE" ? fail("structure_too_large") : fail("privacy_blocked");
    const built = await buildAdjustContext({
      input: work.built.input, result: work.previous, catalog, intent, alternativeIds: offered.map((a) => a.exerciseId), proposalVersion: work.header.version,
    });
    if (!built.ok) return fail("invalid_target");
    const bundle: AdjustContextBundle = built.bundle;

    const gateBase = gateStateFor(snapshot, env, { minor: planningBundle.bundle.minor });
    const closed = evaluateAiGate(gateBase, "ADJUSTMENTS");
    if (closed !== "READY") return fail(GATE_TO_FAILURE[closed]);
    const task = snapshot.taskSettings as TaskSettings;
    const kind = task.providerKind as ProviderKind;
    const modelId = task.modelId as string;
    const timeoutMs = Math.min(task.timeoutMs, env.hardTimeoutMs);
    const staleMs = staleAfterMs(timeoutMs, task.maxRetries);

    const worst = estimateTokens(ADJUST_MAX_RESPONSE_CHARS) + (THINKING_ALLOWANCE_TOKENS[kind] ?? 0);
    if (worst > env.hardMaxOutputTokens) return fail("request_too_large");
    const effectiveMaxOutput = Math.min(env.hardMaxOutputTokens, Math.max(task.maxOutputTokens, worst));
    const schema = toWireSchema(modelAdjustmentSchema, kind);
    let request: SafeProviderRequest;
    try {
      request = await buildProviderPayload(
        "ADJUSTMENTS",
        { kind, system: ADJUST_SYSTEM_PROMPT, user: adjustUserMessage(bundle.context), schema, schemaName: ADJUST_SCHEMA_NAME, vocabularySchemas: [schema] },
        planningBundle.bundle.denyList,
      );
    } catch (error) {
      if (error instanceof PrivacyBlockedError) return fail("privacy_blocked");
      throw error;
    }
    if (request.estimatedInputTokens > task.maxInputTokens) return fail("request_too_large");
    const reservation: Reservation = reservationFor({ estimatedInput: request.estimatedInputTokens, effectiveMaxOutput, maxRetries: task.maxRetries, prices: task.prices });

    const contextHash = await sha256Hex(canonicalJson(bundle.context));
    const cacheKey = await plannerCacheKey({
      task: "ADJUSTMENTS", contextHash, aliasMapHash: bundle.aliases.aliasMapHash, promptVersion: ADJUST_PROMPT_VERSION, schemaVersion: 1, provider: kind, modelId,
      maxOutputTokens: effectiveMaxOutput, roleFocusRef: "adjust", strategiesMax: 0,
    });
    const requestJson = canonicalJson({ intent });
    const startInput = (id: string, key: string | null) => ({
      id, planId, revisionId, proposalId: p.proposalId, baseVersion: p.expectedVersion, idempotencyKey: p.idempotencyKey, requestHash, requestJson: requestJson.length <= 2000 ? requestJson : "{}",
      mode: "AI" as const, contextHash, cacheKey: key, providerKind: kind, modelId, promptVersion: ADJUST_PROMPT_VERSION, now, staleBefore: new Date(now.getTime() - staleMs),
    });

    /** Binds an answer to the offered aliases, simulates it and builds the stored suggestion. */
    const resolve = async (raw: unknown): Promise<{ ok: true; stored: Stored } | { ok: false }> => {
      const checked = validateModelAdjustment(raw, bundle);
      if (!checked.ok) return { ok: false };
      const reasons = checked.reasonCodes.map((code) => ({ code, text: REASON_TEXT[code] }));
      const echoMissing = intent.constraints.map((c) => c.kind).filter((k) => !checked.constraintsEcho.includes(k));
      if (checked.clarification) {
        const text = CLARIFICATION_TEXT[checked.clarification];
        return {
          ok: true,
          stored: {
            v: 1, intent, ops: [], diffHash: null,
            view: {
              request: { op: intent.op, text: requestSentence(intent, { item: found.item.exerciseName, workout: intent.target.label }) },
              suggestion: { text, replacementName: null, reasons, clarification: { code: checked.clarification, text }, echoMissing },
              diff: null, noEffect: null, canApply: false, blockedReason: text, needsAcknowledgement: false,
            },
          },
        };
      }
      const target = substitutionTargetOf(intent);
      if (!target) return { ok: false };
      const ops: ResolvedOp[] = checked.replacements.map((newExerciseId) => ({ kind: "SUBSTITUTE_EXERCISE", target, fromExerciseId: found.item.exerciseId as string, newExerciseId }));
      const sim = await simulate(work, intent, ops);
      if (!sim.ok) return { ok: false };
      sim.stored.view.suggestion.reasons = reasons;
      sim.stored.view.suggestion.echoMissing = echoMissing;
      return { ok: true, stored: sim.stored };
    };

    // cache: a hit costs nothing and is recorded as a 0-token settled ledger row
    const cached = await planning.cacheGet(planId, revisionId, cacheKey, now);
    if (cached) {
      let raw: unknown = null;
      try {
        raw = JSON.parse(cached.responseJson);
      } catch {
        raw = null;
      }
      const resolved = raw === null ? ({ ok: false } as const) : await resolve(raw);
      if (resolved.ok) {
        const id = newId();
        const started = await repo.start({ ...startInput(id, null) });
        if (!started.ok) return startFailure(planId, revisionId, p, requestHash, started.reason);
        const ledgerId = newId();
        const recorded = await planning.recordCacheHit({ planId, revisionId, task: "ADJUSTMENTS", ledgerId, requestKey: `${id}:1`, providerKind: kind, modelId, now });
        const usageJson = JSON.stringify({ inputTokens: 0, outputTokens: 0, source: "CACHE", attempts: 0 });
        const finished = await repo.finish({
          requestId: id, planId, revisionId, attempt: 1, status: recorded ? "SUCCEEDED" : "FAILED", failureCode: recorded ? null : "not_found", cacheHit: true, responseHash: cached.responseHash, usageJson,
          ledgerId: recorded ? ledgerId : null, now, ...(recorded ? { payloadJson: JSON.stringify(resolved.stored) } : {}),
        });
        if (!recorded || !finished) return fail("not_found");
        const row = await repo.requestById(planId, revisionId, id);
        return row ? { ok: true, replayed: false, suggestion: viewOf(row, resolved.stored) } : fail("not_found");
      }
    }

    // the full gate for THIS request, then the circuit breaker; nothing is created yet
    const need = { input: reservation.input, output: reservation.output, costMicros: reservation.costMicros };
    const full = evaluateAiGate(gateStateFor(snapshot, env, { minor: planningBundle.bundle.minor, need, perAttemptTokens: reservation.perAttemptTokens }), "ADJUSTMENTS");
    if (full !== "READY") return fail(GATE_TO_FAILURE[full]);
    const sweepMs = Math.max(staleMs, staleAfterMs(env.hardTimeoutMs, 1));
    const circuit = await planning.circuitCheck(kind, modelId, now, staleMs);
    if (!circuit.allowed) return fail("circuit_open");
    const giveBackProbe = async () => {
      if (circuit.probe) await planning.circuitReleaseProbe(kind, modelId, now);
    };

    const requestId = newId();
    let started = await repo.start(startInput(requestId, cacheKey));
    if (!started.ok && started.reason === "in_flight") {
      const blocker = await repo.runningByCacheKey(planId, revisionId, cacheKey);
      if (blocker && now.getTime() - Date.parse(blocker.startedAt) >= staleMs) {
        await repo.expireStale(planId, revisionId, blocker.id, blocker.startedAt, now);
        started = await repo.start(startInput(requestId, cacheKey));
      }
    }
    if (!started.ok) {
      await giveBackProbe();
      return startFailure(planId, revisionId, p, requestHash, started.reason);
    }
    const ledgerId = newId();
    const reserved = await repo.reserve({
      planId, revisionId, ledgerId, requestKey: `${requestId}:1`, providerKind: kind, modelId, reservation, prices: task.prices, now, staleMs: sweepMs,
    });
    const finishFailed = async (ledger: Parameters<typeof repo.finish>[0]["ledger"], reason: AdjustFailure, detail: string | undefined, usageJson: string | null, at: Date): Promise<AdjustOutcome> => {
      await repo.finish({
        requestId, planId, revisionId, attempt: 1, status: "FAILED", failureCode: (detail ? `${reason}:${detail}` : reason).slice(0, 40), cacheHit: false, responseHash: null, usageJson,
        ledgerId: ledger ? ledgerId : null, now: at, ledger,
      });
      return fail(reason);
    };
    if (!reserved.ok) {
      const again = await freshGate(planId, revisionId, now, env);
      const why = evaluateAiGate(gateStateFor(again, env, { minor: planningBundle.bundle.minor, need, perAttemptTokens: reservation.perAttemptTokens }), "ADJUSTMENTS");
      await giveBackProbe();
      const reason: AdjustFailure = why === "READY" ? "limit_reached" : GATE_TO_FAILURE[why];
      const out = await finishFailed(null, reason, why === "READY" ? "RATE" : undefined, null, now);
      return why === "READY" ? fail(reason, { message: "Muitos pedidos de IA em pouco tempo. Tente de novo em instantes ou use as alternativas do motor." }) : out;
    }
    const proof: Reserved = { ledgerId, requestId };

    let apiKey: string | null = null;
    if (kind !== "mock") {
      try {
        const sealed = await system.readKeyForCall(kind);
        if (!sealed) throw new Error("NO_KEY");
        apiKey = await openSecret(sealed, kind, env.secrets);
      } catch {
        await giveBackProbe();
        return finishFailed({ kind: "RELEASE", ledgerId, errorCode: "KEY_UNREADABLE", countAsFailure: true, now }, "not_configured", undefined, null, now);
      }
    }
    const provider = deps.providers?.[kind] ?? providerFor(kind);
    const settings: CallSettings = { kind, modelId, maxOutputTokens: effectiveMaxOutput, timeoutMs, apiKey, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) };
    const called = await callGated(proof, provider, request, settings, task.maxRetries);
    const done = called.finishedAt;
    const result = called.result;
    const estimatedIn = request.estimatedInputTokens;

    if (!result.ok) {
      await planning.circuitFailure(kind, modelId, result.code, done);
      const spent = called.usage ?? result.usage;
      const tokensKnown = spent !== null && (spent.inputTokens !== null || spent.outputTokens !== null);
      const unknownCost = result.code === "TIMEOUT" || result.code === "NETWORK";
      const modelQuality = result.code === "INVALID_JSON" || result.code === "TRUNCATED" || result.code === "REFUSED";
      if (modelQuality) await planning.circuitSuccess(kind, modelId, done, called.sentAt);
      const ledger = tokensKnown
        ? settleAction(ledgerId, spent, estimatedIn, 0, task.prices, called.attempts, result.latencyMs, result.httpStatus, done)
        : unknownCost
          ? ({ kind: "CHARGE_UNKNOWN", ledgerId, inputTokens: estimatedIn, errorCode: result.code, attempts: called.attempts, latencyMs: result.latencyMs, now: done } as const)
          : ({ kind: "RELEASE", ledgerId, errorCode: result.code, countAsFailure: true, now: done } as const);
      const reason: AdjustFailure = result.code === "TIMEOUT" ? "timeout" : modelQuality ? "invalid_response" : "provider_failed";
      return finishFailed(ledger, reason, result.code, tokensKnown ? usageJsonOf(spent, estimatedIn, 0, called.attempts) : null, done);
    }

    await planning.circuitSuccess(kind, modelId, done, called.sentAt);
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
    const resolved = await resolve(result.json);
    // tokens were spent either way: settle them; nothing is cached for an answer the engine did not accept
    if (!resolved.ok) return finishFailed(settle, "invalid_response", "VALIDATION", usageJson, done);
    const wireHash = await responseHash(result.json);
    const finished = await repo.finish({
      requestId, planId, revisionId, attempt: 1, status: "SUCCEEDED", failureCode: null, cacheHit: false, responseHash: wireHash, usageJson, ledgerId, now: done, ledger: settle,
      cache: {
        planId, revisionId, cacheKey, task: "ADJUSTMENTS", providerKind: kind, modelId, promptVersion: ADJUST_PROMPT_VERSION, responseJson: JSON.stringify(result.json), responseHash: wireHash,
        inputTokens: settle.inputTokens, outputTokens: settle.outputTokens, now: done, expiresAt: new Date(done.getTime() + env.cacheTtlDays * DAY_MS),
      },
      payloadJson: JSON.stringify(resolved.stored),
    });
    if (!finished) return fail("in_progress");
    const row = await repo.requestById(planId, revisionId, requestId);
    return row ? { ok: true, replayed: false, suggestion: viewOf(row, resolved.stored) } : fail("not_found");
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  // public surface
  // ---------------------------------------------------------------------------------------------------------------------------

  return {
    /** Can the AI be offered for adjustments on this revision? Reads only; calls nothing external. `null` = the revision is not reachable. */
    async availability(planId: string, revisionId: string): Promise<AdjustAvailability | null> {
      const now = clock();
      const env = await getEnv();
      const snapshot = await freshGate(planId, revisionId, now, env);
      if (!snapshot.reach) return null;
      const state = evaluateAiGate(gateStateFor(snapshot, env), "ADJUSTMENTS");
      return { state, message: state === "READY" ? "" : GATE_MESSAGE[state], usage: await planning.usageForProfessional(now) };
    },

    /**
     * The engine's alternatives for one item, each with the professional's constraints already evaluated on it (the same impact preview the AI
     * suggestion gets). No provider, no ledger, nothing written: the structured path of the panel.
     */
    async alternatives(planId: string, revisionId: string, raw: unknown): Promise<AlternativesOutcome> {
      const parsed = adjustmentRequestSchema.omit({ idempotencyKey: true }).safeParse(raw);
      if (!parsed.success || parsed.data.intent.op !== "SUBSTITUTE_EXERCISE") return fail("invalid");
      const { proposalId, expectedVersion, intent } = parsed.data;
      const loaded = await workbench(planId, revisionId, proposalId, expectedVersion, clock());
      if (!loaded.ok) return loaded;
      const { work } = loaded;
      const found = targetItem(work, intent);
      const target = substitutionTargetOf(intent);
      if (!found || !target) return fail("invalid_target");
      const catalog = catalogOf(work.ctx.catalog);
      const constraints = intent.constraints as ResolvedConstraint[];
      const ranked = alternativesOf(work, intent);
      // Candidates that fit the catalog-level constraints come first (still in engine order); the rest follow and show their violated checks.
      const fits = new Set(prune(ranked, catalog.get(found.item.exerciseId as string), constraints, catalog).map((a) => a.exerciseId));
      const list = [...ranked.filter((a) => fits.has(a.exerciseId)), ...ranked.filter((a) => !fits.has(a.exerciseId))].slice(0, 6);
      const alternatives: AlternativeView[] = list.map((a) => {
        const ops: ResolvedOp[] = [{ kind: "SUBSTITUTE_EXERCISE", target, fromExerciseId: found.item.exerciseId as string, newExerciseId: a.exerciseId }];
        const sim = simulateAdjustments(work.built.input, work.previous, ops);
        const checks = sim.ok ? evaluateConstraints(work.previous, sim.result, constraints, catalog, ops, muscleName) : [];
        const diff = sim.ok ? diffResults(work.previous, sim.result, checks) : null;
        const verdict = !sim.ok || checks.some((c) => c.status === "VIOLATED") ? "VIOLATED" : checks.some((c) => c.status === "UNCHECKABLE") ? "UNCHECKABLE" : "OK";
        const deltas = diff?.minutes.map((m) => (m.before !== null && m.after !== null ? m.after - m.before : null)) ?? [];
        return {
          exerciseId: a.exerciseId, name: a.name, metadata: a.metadata === "REVIEWED" ? "Revisado" : a.metadata === "INCLUDES_INFERRED" ? "Inferido (não revisado)" : "", reasons: a.reasons,
          checks: checks.map((c) => ({ text: constraintText(c.constraint as never), status: c.status, detail: c.detail })),
          verdict: sim.ok ? verdict : "VIOLATED",
          impact: { sessions: diff?.counts.occurrencesTouched ?? 0, minutesDelta: deltas.length && deltas.every((d) => d !== null) ? Math.max(...(deltas as number[]).map(Math.abs)) * (Math.sign((deltas as number[])[0]) || 1) : null },
        };
      });
      return { ok: true, alternatives };
    },

    /** "Sugerir alternativa com IA" / "Ver impacto": builds, simulates and records a suggestion. Never changes the proposal. */
    async suggest(planId: string, revisionId: string, payload: unknown): Promise<AdjustOutcome> {
      const parsed = adjustmentRequestSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const p = parsed.data;
      const intent = p.intent;
      const now = clock();
      const requestHash = await requestHashOf(planId, revisionId, p);

      // idempotent replay (reach is proven by the repository's revision gate: another organization or a revoked assignment sees nothing)
      const existing = await repo.requestByKey(planId, revisionId, p.proposalId, p.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) return fail("key_reused");
        if (existing.status !== "RUNNING") return replayOf(planId, revisionId, existing);
        const env = await getEnv();
        if (now.getTime() - Date.parse(existing.startedAt) < staleAfterMs(env.hardTimeoutMs, 1)) return fail("in_progress");
        await repo.expireStale(planId, revisionId, existing.id, existing.startedAt, now);
        return fail("stale", { message: "O pedido anterior não terminou. Peça de novo." });
      }

      const loaded = await workbench(planId, revisionId, p.proposalId, p.expectedVersion, now);
      if (!loaded.ok) return loaded;
      const { work } = loaded;
      const found = targetItem(work, intent);
      if (!found) return fail("invalid_target", { message: "O item escolhido não está mais nesta proposta, ou é um exercício fora da biblioteca." });

      if (intent.useAi) {
        if (intent.op !== "SUBSTITUTE_EXERCISE") return fail("invalid", { message: "A IA só sugere alternativas de exercício. Para mudar séries, repetições ou descanso, digite os valores." });
        const env = await getEnv();
        return suggestWithAi(planId, revisionId, p, requestHash, intent, work, now, env);
      }

      // STRUCTURED: the professional's own pick from the engine's list, or typed dose numbers. No provider, no ledger.
      let ops: ResolvedOp[];
      if (intent.op === "SUBSTITUTE_EXERCISE") {
        const target = substitutionTargetOf(intent);
        if (!target || !intent.replacementExerciseId) return fail("invalid", { message: "Escolha uma das alternativas do motor." });
        if (!alternativesOf(work, intent).some((a) => a.exerciseId === intent.replacementExerciseId)) return fail("engine_refused", { message: "Este exercício não está entre as alternativas do motor para o item." });
        ops = [{ kind: "SUBSTITUTE_EXERCISE", target, fromExerciseId: found.item.exerciseId as string, newExerciseId: intent.replacementExerciseId }];
      } else {
        const patch = dosePatchOf(intent);
        if (!patch) return fail("invalid");
        ops = [{ kind: "DOSE", op: intent.op, phaseIndex: intent.target.phaseIndex, label: intent.target.label, slotKey: intent.target.slotKey, exerciseId: found.item.exerciseId as string, patch }];
      }
      const sim = await simulate(work, intent, ops);
      if (!sim.ok) return sim;
      if (intent.op === "SUBSTITUTE_EXERCISE") {
        const to = catalogOf(work.ctx.catalog).get(ops[0].kind === "SUBSTITUTE_EXERCISE" ? ops[0].newExerciseId : "");
        sim.stored.view.suggestion.text = `Trocar ${found.item.exerciseName} por ${to?.name ?? "a alternativa escolhida"}`;
      }
      return persistStructured(planId, revisionId, p, requestHash, intent, sim.stored, now);
    },

    /** The newest undecided suggestion of the proposal, if it still applies to this version (to show it again after a reload). */
    async current(planId: string, revisionId: string, proposalId: string): Promise<SuggestionView | null> {
      const row = await repo.latestUndecided(planId, revisionId, proposalId);
      if (!row) return null;
      const snap = await proposals.asEngineResult(planId, revisionId, proposalId);
      if (!snap || snap.header.state !== "OPEN" || snap.header.version !== row.baseVersion) return null;
      if (clock().getTime() - Date.parse(row.startedAt) > ADJUST_SUGGESTION_TTL_MS) return null;
      const stored = readStored(await repo.payloadOf(planId, revisionId, row.id));
      return stored ? viewOf(row, stored) : null;
    },

    /**
     * "Aplicar ajuste à proposta": ONLY this point change, as a new version of the proposal, after the operations are simulated again on the
     * stored proposal and the effect is the one the professional saw. Never approves, applies to the draft or delivers.
     */
    async apply(planId: string, revisionId: string, payload: unknown): Promise<AdjustApplyOutcome> {
      const parsed = adjustmentApplySchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const p = parsed.data;
      const now = clock();
      const row = await repo.requestById(planId, revisionId, p.adjustmentId);
      if (!row || row.proposalId !== p.proposalId || row.status !== "SUCCEEDED") return fail("not_found");
      const decided = await repo.decisionOf(planId, revisionId, row.id);
      if (decided) {
        // the same apply sent again after a network error: the write is already there
        const generationId = decided.decision === "APPLIED" ? await repo.generationIdByKey(planId, revisionId, p.proposalId, p.idempotencyKey) : null;
        if (generationId) {
          const header = await proposals.header(planId, revisionId, p.proposalId, "ANY");
          return header ? { ok: true, version: header.version, replayed: true } : fail("not_found");
        }
        return fail("already_decided");
      }
      const stored = readStored(await repo.payloadOf(planId, revisionId, row.id));
      if (!stored) return fail("not_found");
      if (!stored.ops.length || stored.diffHash === null) return fail("invalid", { message: "Esta sugestão não tem nenhuma mudança para aplicar." });
      if (now.getTime() - Date.parse(row.startedAt) > ADJUST_SUGGESTION_TTL_MS) {
        await repo.decide({ id: newId(), planId, revisionId, requestId: row.id, decision: "EXPIRED", generationId: null, now });
        return fail("expired");
      }
      if (row.baseVersion !== p.expectedVersion) return fail("stale", { version: row.baseVersion });
      const loaded = await workbench(planId, revisionId, p.proposalId, p.expectedVersion, now);
      if (!loaded.ok) return loaded.reason === "conflict" ? fail("stale", { version: loaded.version }) : loaded;
      // Never trust the stored diff: simulate again on the CURRENT proposal and compare the effect the professional saw.
      const sim = await simulate(loaded.work, stored.intent, stored.ops);
      if (!sim.ok) return sim;
      if (sim.stored.diffHash !== stored.diffHash) return fail("changed");
      if (!sim.stored.view.canApply) return fail("blocked", { message: sim.stored.view.blockedReason ?? ADJUST_MESSAGE.blocked });
      if (sim.stored.view.needsAcknowledgement && !p.acknowledgeUncheckable) return fail("blocked", { message: "Há restrições que não puderam ser verificadas: confirme para aplicar mesmo assim." });

      const out = await proposalService(db, context, { now: clock }).applyAdjustment(
        planId, revisionId,
        { proposalId: p.proposalId, idempotencyKey: p.idempotencyKey, writeId: p.writeId, expectedVersion: p.expectedVersion },
        { adjustmentId: row.id, ops: stored.ops, constraints: stored.intent.constraints as ResolvedConstraint[], acknowledgeUncheckable: p.acknowledgeUncheckable },
      );
      if (!out.ok) {
        const reason: AdjustFailure = out.reason === "conflict" ? "stale" : out.reason === "not_open" || out.reason === "closed" ? "not_open" : out.reason === "revision_changed" ? "revision_changed"
          : out.reason === "key_reused" ? "key_reused" : out.reason === "adjustment_blocked" ? "blocked" : out.reason === "engine_refused" || out.reason === "invalid_target" ? "engine_refused" : "invalid";
        return fail(reason, { message: out.message, ...(out.version !== undefined ? { version: out.version } : {}) });
      }
      const generationId = await repo.generationIdByKey(planId, revisionId, p.proposalId, p.idempotencyKey);
      if (generationId) await repo.decide({ id: newId(), planId, revisionId, requestId: row.id, decision: "APPLIED", generationId, now });
      return { ok: true, version: out.version, replayed: out.replayed };
    },

    /** "Descartar sugestão": records the decision; the proposal is untouched. */
    async reject(planId: string, revisionId: string, payload: unknown): Promise<{ ok: true } | AdjustFailureOutcome> {
      const parsed = adjustmentDecisionSchema.safeParse(payload);
      if (!parsed.success) return fail("invalid");
      const row = await repo.requestById(planId, revisionId, parsed.data.adjustmentId);
      if (!row || row.status !== "SUCCEEDED") return fail("not_found");
      const decided = await repo.decide({ id: newId(), planId, revisionId, requestId: row.id, decision: "REJECTED", generationId: null, now: clock() });
      if (decided.ok) return { ok: true };
      if (decided.reason === "already") return (await repo.decisionOf(planId, revisionId, row.id))?.decision === "REJECTED" ? { ok: true } : fail("already_decided");
      return fail("not_found");
    },
  };
}

export { intentSchema, ADJUST_PROMPT_VERSION };
