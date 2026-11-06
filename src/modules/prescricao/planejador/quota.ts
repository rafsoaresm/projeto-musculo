/**
 * Token and cost arithmetic of the AI layer (design V4 §3.5). Pure: no database, network or clock (the month key takes `now`).
 * The numbers here are conservative OPERATIONAL estimates, replaced by the provider's counts at settle; none is a training rule.
 *
 * Cost is `null` unless the gestor typed prices: it is never invented and never 0 for "unknown".
 */
import { canonicalJson } from "@/modules/prescricao/motor/hash";
import { todayInBrazil } from "@/modules/execucao/contracts";
import type { PlannerResponse } from "./blueprint";
import { FOCUS_DELTA_MAX_ITEMS, PLANNER_MAX_CANDIDATES_PER_WORKOUT } from "./versions";
import {
  DOSE_PROFILE_CODES, EXERCISE_CLASSES, MUSCLE_CODES, PATTERN_CODES, PROGRESSION_INTENTS, QUESTION_CODES, UNCERTAINTY_CODES, WORKOUT_ROLES,
} from "./vocab";

/** Characters per token used for every estimate (conservative for Portuguese/JSON). Replaced by provider counts at settle. */
export const AI_CHARS_PER_TOKEN = 3;
/** Hidden reasoning tokens are billed as output by some providers; placeholder until measured on the first real calls (docs/PENDENCIAS.md). */
export const THINKING_ALLOWANCE_TOKENS: Readonly<Record<string, number>> = Object.freeze({ openai: 1024, google: 1024, anthropic: 0, mock: 0 });
export const WORST_CASE_MARGIN = 1.1;
export const AI_HARD_TIMEOUT_DEFAULT_MS = 25_000;
export const AI_HARD_MAX_OUTPUT_DEFAULT = 8192;
export const AI_CACHE_TTL_DEFAULT_DAYS = 14;
export const AI_CACHE_TTL_MAX_DAYS = 60;
/** Fixed pause before the single retry (deterministic, bounded). */
export const AI_RETRY_DELAY_MS = 400;
/** A run, a reservation and a breaker probe older than `all attempts + this` are stale (design §3.6). */
export const AI_STALE_GRACE_MS = 15_000;

export const estimateTokens = (chars: number): number => Math.ceil(Math.max(0, chars) / AI_CHARS_PER_TOKEN);
/**
 * A reservation covers EVERY attempt (`maxRetries + 1`), so a live run can last `(maxRetries + 1) * timeout + the retry pauses`: staleness starts after that
 * plus the grace. The orchestration must also bound the whole execution (attempts + pauses) to this window.
 */
export const staleAfterMs = (timeoutMs: number, maxRetries: 0 | 1): number => (maxRetries + 1) * timeoutMs + maxRetries * AI_RETRY_DELAY_MS + AI_STALE_GRACE_MS;

/** `YYYY-MM` in America/Sao_Paulo. */
export const monthKey = (now: Date): string => todayInBrazil(now).slice(0, 7);

// ---------- cost ----------

export type Currency = "BRL" | "USD" | "EUR";
/** Integers in micro-units of the typed currency per 1M tokens (0.15 USD => 150000). */
export interface TypedPrices {
  currency: Currency;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
}

/** Null without typed prices ("custo desconhecido"). Cached input is charged as input (no discount is assumed: unknown => conservative). */
export function costMicros(inputTokens: number, outputTokens: number, prices: TypedPrices | null): number | null {
  if (!prices) return null;
  return Math.ceil((inputTokens * prices.inputMicrosPerMillion) / 1_000_000) + Math.ceil((outputTokens * prices.outputMicrosPerMillion) / 1_000_000);
}

// ---------- allowance ----------

export type Allowance = { mode: "TOTAL"; total: number } | { mode: "SPLIT"; input: number; output: number };
export interface MonthUse {
  usedInput: number;
  usedOutput: number;
  reservedInput: number;
  reservedOutput: number;
}
export interface Need {
  input: number;
  output: number;
}

/** True when `need` still fits after what is used and reserved (the same inequality the reserve statement runs in SQL). */
export function fitsAllowance(allowance: Allowance, month: MonthUse, need: Need): boolean {
  if (allowance.mode === "TOTAL") {
    return month.usedInput + month.usedOutput + month.reservedInput + month.reservedOutput + need.input + need.output <= allowance.total;
  }
  return (
    month.usedInput + month.reservedInput + need.input <= allowance.input && month.usedOutput + month.reservedOutput + need.output <= allowance.output
  );
}
/** An allowance of 0 (TOTAL) or of 0 on either side (SPLIT) means "IA não incluída no plano". */
export const allowanceIsZero = (allowance: Allowance): boolean =>
  allowance.mode === "TOTAL" ? allowance.total <= 0 : allowance.input <= 0 || allowance.output <= 0;

export function remainingTokens(allowance: Allowance, month: MonthUse): { mode: "TOTAL"; total: number } | { mode: "SPLIT"; input: number; output: number } {
  if (allowance.mode === "TOTAL") {
    return { mode: "TOTAL", total: Math.max(0, allowance.total - month.usedInput - month.usedOutput - month.reservedInput - month.reservedOutput) };
  }
  return {
    mode: "SPLIT",
    input: Math.max(0, allowance.input - month.usedInput - month.reservedInput),
    output: Math.max(0, allowance.output - month.usedOutput - month.reservedOutput),
  };
}

/** The per-request cap is a TOTAL tokens cap judged on ONE attempt; 0 means the task is not included in the plan. */
export const withinPerRequestCap = (cap: number, input: number, output: number): boolean => cap > 0 && input + output <= cap;

export interface Reservation {
  input: number;
  output: number;
  costMicros: number;
  /** One attempt's tokens: what the per-request cap is judged on. */
  perAttemptTokens: number;
}
/** One reservation covers EVERY attempt: (1 + maxRetries) x (input estimate, effective max output); priced worst case when prices are typed. */
export function reservationFor(input: { estimatedInput: number; effectiveMaxOutput: number; maxRetries: number; prices: TypedPrices | null }): Reservation {
  const attempts = 1 + Math.max(0, Math.min(1, input.maxRetries));
  const r = { input: attempts * input.estimatedInput, output: attempts * input.effectiveMaxOutput };
  return {
    ...r,
    costMicros: costMicros(r.input, r.output, input.prices) ?? 0,
    perAttemptTokens: input.estimatedInput + input.effectiveMaxOutput,
  };
}

// ---------- output budget ----------

export interface PlanningShape {
  /** Workouts (distinct volume labels) of each phase, in order. */
  phases: ReadonlyArray<{ workouts: number }>;
}
const longest = (codes: readonly string[], n: number): string[] => [...codes].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, n);
const rep = (n: number, ch = "x") => ch.repeat(n);

/**
 * The LARGEST response the wire schema allows for this structure: every phase present once (no `sameAsPhase` credit), the
 * recommended strategy with every workout at FOCUS_DELTA_MAX_ITEMS and the maximum candidate aliases, two alternatives with roles
 * only, every prose field at its `.max`, dosing and progression at their `.max`. The tests parse it with `plannerResponseSchema`.
 */
export function maximalPlannerResponse(shape: PlanningShape): PlannerResponse {
  const muscles = longest(MUSCLE_CODES, 8);
  const patterns = longest(PATTERN_CODES, FOCUS_DELTA_MAX_ITEMS - 8);
  const delta = {
    addDominant: muscles, removeDominant: [], addSupporting: [], removeSupporting: [],
    addTargetPatterns: patterns, removeTargetPatterns: [], addSpillover: [], removeSpillover: [],
  };
  const role = longest(WORKOUT_ROLES, 1)[0] as PlannerResponse["strategies"][number]["phases"][number]["workouts"][number]["role"];
  const aliases = Array.from({ length: PLANNER_MAX_CANDIDATES_PER_WORKOUT }, (_, i) => `X${48 - i}`);
  const phasesOf = (recommended: boolean) =>
    shape.phases.map((p, i) => ({
      phase: i + 1,
      splitType: "PUSH_PULL_LEGS" as const,
      sameAsPhase: null,
      workouts: Array.from({ length: p.workouts }, (_, w) => ({
        workout: `T${Math.min(999, i * 8 + w + 1)}`,
        role,
        delta: recommended ? delta : null,
        candidateAliases: recommended ? aliases : [],
      })),
    }));
  const strategy = (id: "S1" | "S2" | "S3", recommended: boolean) => ({
    strategyId: id,
    splitFamily: "PUSH_PULL_LEGS" as const,
    explanation: rep(300),
    tradeoffs: [rep(160), rep(160)],
    confidence: "MEDIUM" as const,
    evidenceRefs: Array.from({ length: 6 }, () => "S.equipment"),
    phases: phasesOf(recommended),
    dosingIntent: recommended
      ? EXERCISE_CLASSES.map((exerciseClass, i) => ({ exerciseClass, profileCode: longest(DOSE_PROFILE_CODES, DOSE_PROFILE_CODES.length)[i % DOSE_PROFILE_CODES.length] as (typeof DOSE_PROFILE_CODES)[number] }))
      : [],
    progressionIntent: recommended
      ? shape.phases.map((_, i) => ({ phase: i + 1, intent: longest(PROGRESSION_INTENTS, 1)[0] as (typeof PROGRESSION_INTENTS)[number] }))
      : [],
  });
  return {
    schemaVersion: 1,
    global: {
      goalCodes: ["ABCDEFGHIJKLMNOPQRSTUVWXYZ_ABC", "ABCDEFGHIJKLMNOPQRSTUVWXYZ_ABC", "ABCDEFGHIJKLMNOPQRSTUVWXYZ_ABC"],
      rationale: rep(300),
      assumptions: [rep(160), rep(160), rep(160), rep(160)],
      uncertainties: Array.from({ length: 4 }, () => ({ code: longest(UNCERTAINTY_CODES, 1)[0] as (typeof UNCERTAINTY_CODES)[number], text: rep(160) })),
      questionsForProfessional: Array.from({ length: 3 }, () => ({ code: longest(QUESTION_CODES, 1)[0] as (typeof QUESTION_CODES)[number], text: rep(160) })),
      keyTradeoffs: [rep(160), rep(160)],
    },
    recommendedStrategyId: "S1",
    strategies: [strategy("S1", true), strategy("S2", false), strategy("S3", false)],
  };
}

export const estimatedTokensOf = (value: unknown): number => estimateTokens(canonicalJson(value).length);

/** Output tokens to budget for a planning call of this shape and provider kind (design §2.3): maximal response + hidden reasoning + margin. */
export function worstCaseOutputTokens(shape: PlanningShape, kind: string): number {
  const base = estimatedTokensOf(maximalPlannerResponse(shape));
  return Math.ceil(base * WORST_CASE_MARGIN) + (THINKING_ALLOWANCE_TOKENS[kind] ?? 0);
}

export interface OutputBudget {
  worstCase: number;
  effectiveMaxOutput: number;
  /** Worst case does not fit under the hard ceiling: the call must not be made (REQUEST_TOO_LARGE). */
  tooLarge: boolean;
}
export function outputBudget(shape: PlanningShape, kind: string, taskMaxOutput: number, hardMaxOutput: number): OutputBudget {
  const worstCase = worstCaseOutputTokens(shape, kind);
  return { worstCase, effectiveMaxOutput: Math.min(hardMaxOutput, Math.max(taskMaxOutput, worstCase)), tooLarge: worstCase > hardMaxOutput };
}
