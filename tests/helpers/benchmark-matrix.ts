/**
 * Motor V4, PR 5.2: matriz de regressão e medição local. Cada caso percorre a cadeia pura e completa que o servidor percorre, sem banco e
 * sem IA real: contexto -> estratégia por regras -> aceite -> compilador -> adaptador (`buildEngineInput`) -> motor -> auditoria. Dados,
 * nomes e preços são fictícios. Nada aqui mede Workers, D1 remoto, provedor real nem aprovação do Técnico (ver `VALIDACAO.md`).
 *
 * Dimensões (design §8.6): dias por semana 2 a 6; estímulo (hipertrofia, força, condicionamento geral, misto força + cardio + mobilidade);
 * nível; rotação (ABAB, ABC, ABCD, PPL, corpo inteiro, personalizada, irregular); equipamento (completo, halteres e banco, só o peso do
 * corpo); calendário (regular, irregular); triagem (sem "Sim", em aberto, com "Sim" e decisão); histórico (ausente, contraditório).
 * O conjunto é uma amostra determinística (gerador com semente fixa) com cobertura conferida por teste, não o produto cartesiano.
 */
import { performance } from "node:perf_hooks";
import { PARQ_CODES, PARQ_DECISION_CODES, readScreening } from "@/modules/avaliacoes/v2/screening";
import { buildEngineInput } from "@/modules/prescricao/automatica/build-input";
import { parseGenerationAnswers, type GenerationAnswersInput } from "@/modules/prescricao/automatica/contracts";
import { structureFacts, type GenerationContext } from "@/modules/prescricao/automatica/facts";
import { canonicalJson, generate, type CatalogExercise, type EngineResult, type ExposureLog } from "@/modules/prescricao/motor";
import { DEFAULT_RULESET, OPT_IN_RULESETS } from "@/modules/prescricao/motor/rules";
import { plannerResponseSchema, type BlueprintAcceptance, type TrainingBlueprint } from "@/modules/prescricao/planejador/blueprint";
import { compileAcceptance, convertBlueprintToGenerationAnswers } from "@/modules/prescricao/planejador/compile";
import { acceptanceHash, blueprintHash } from "@/modules/prescricao/planejador/hashes";
import { buildProviderPayload } from "@/modules/prescricao/planejador/privacy";
import { PLANNER_SCHEMA_NAME, PLANNER_SYSTEM_PROMPT, plannerUserMessage } from "@/modules/prescricao/planejador/prompt";
import { mockProvider } from "@/modules/prescricao/planejador/provedores/mock";
import { costMicros, type TypedPrices } from "@/modules/prescricao/planejador/quota";
import { produceRulesBlueprint } from "@/modules/prescricao/planejador/rules-mode/producer";
import type { WorkoutRole } from "@/modules/prescricao/planejador/vocab";
import { toWireSchema } from "@/modules/prescricao/planejador/provedores/wire-schema";
import { FULL_GYM } from "./motor-fixtures";
import { assessmentOf, generationContext, scheduleOf, xintusBundle, type PhaseSeedV2 } from "./planning-fixtures";
import { XINTUS_CATALOG } from "./xintus";

// ---------- dimensions ----------

export const SESSIONS = [2, 3, 4, 5, 6] as const;
export const STIMULI = ["HYPERTROPHY", "STRENGTH", "GENERAL_FITNESS", "MIXED"] as const;
export const LEVELS = ["Iniciante", "Intermediário", "Avançado"] as const;
export const ROTATIONS = ["ABAB", "ABC", "ABCD", "PPL", "FULL_BODY", "CUSTOM", "IRREGULAR"] as const;
export const EQUIPMENT = ["FULL", "DUMBBELLS_BENCH", "BODYWEIGHT"] as const;
export const CALENDARS = ["REGULAR", "IRREGULAR"] as const;
export const SCREENINGS = ["CLEAR", "OPEN", "POSITIVE_DECIDED"] as const;
export const HISTORIES = ["ABSENT", "CONTRADICTORY"] as const;

export type Stimulus = (typeof STIMULI)[number];
export type Rotation = (typeof ROTATIONS)[number];
export type EquipmentSet = (typeof EQUIPMENT)[number];
export type CalendarKind = (typeof CALENDARS)[number];
export type ScreeningKind = (typeof SCREENINGS)[number];
export type HistoryKind = (typeof HISTORIES)[number];

export interface BenchCase {
  id: string;
  sessions: (typeof SESSIONS)[number];
  stimulus: Stimulus;
  level: (typeof LEVELS)[number];
  rotation: Rotation;
  equipment: EquipmentSet;
  calendar: CalendarKind;
  screening: ScreeningKind;
  history: HistoryKind;
  /** Phases of the saved periodization (the same split family, except CUSTOM, which changes the role per phase). */
  phases: 1 | 2 | 3;
}

/** mulberry32: a fixed seed makes the sample the same on every machine. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MATRIX_SEED = 20261106;

/** The Xintus regression (fictitious): 4 x 60 min, hypertrophy, intermediate, ABAB upper/lower, full gym, 3 phases. Always the first case. */
export const XINTUS_CASE: BenchCase = {
  id: "xintus", sessions: 4, stimulus: "HYPERTROPHY", level: "Intermediário", rotation: "ABAB", equipment: "FULL", calendar: "REGULAR", screening: "CLEAR", history: "ABSENT", phases: 3,
};

/**
 * The deterministic sample. First the Xintus case, then one case per frequency x rotation family (so 2 to 6 days and every rotation meet),
 * then seeded draws for the rest; the coverage of each dimension value is asserted by the test, not assumed.
 */
export function buildCases(count = 60): BenchCase[] {
  const rnd = prng(MATRIX_SEED);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const out: BenchCase[] = [XINTUS_CASE];
  const normalise = (c: BenchCase): BenchCase => {
    // A mixed plan needs room for the cardio and mobility sessions beside the strength ones.
    const sessions = c.stimulus === "MIXED" && c.sessions < 4 ? 4 : c.sessions;
    return { ...c, sessions, phases: c.rotation === "CUSTOM" ? 2 : c.phases };
  };
  let n = 1;
  const add = (c: Omit<BenchCase, "id">) => {
    const normalised = normalise({ ...c, id: "" });
    out.push({ ...normalised, id: `m${String(n).padStart(2, "0")}` });
    n += 1;
  };
  for (const sessions of SESSIONS) {
    for (const rotation of ROTATIONS) {
      add({ sessions, rotation, stimulus: sessions < 4 ? pick(STIMULI.filter((x) => x !== "MIXED")) : pick(STIMULI), level: pick(LEVELS), equipment: pick(EQUIPMENT), calendar: pick(CALENDARS), screening: pick(SCREENINGS), history: pick(HISTORIES), phases: 1 });
    }
  }
  while (out.length < count) {
    add({ sessions: pick(SESSIONS), rotation: pick(ROTATIONS), stimulus: pick(STIMULI), level: pick(LEVELS), equipment: pick(EQUIPMENT), calendar: pick(CALENDARS), screening: pick(SCREENINGS), history: pick(HISTORIES), phases: pick([1, 2, 3] as const) });
  }
  return out.slice(0, count);
}

// ---------- building the chain ----------

const DAYS_REGULAR: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
/** Uneven spacing and a start on a Thursday (partial first week): the calendar the regular case does not have. */
const DAYS_IRREGULAR: Record<number, number[]> = { 2: [1, 5], 3: [1, 2, 6], 4: [0, 2, 3, 6], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 4, 5, 6] };

const ROLES: Record<Rotation, Array<[string, WorkoutRole]>> = {
  ABAB: [["A", "UPPER"], ["B", "LOWER"]],
  ABC: [["A", "UPPER"], ["B", "LOWER"], ["C", "FULL_BODY"]],
  ABCD: [["A", "CHEST_TRICEPS"], ["B", "BACK_BICEPS"], ["C", "LEGS"], ["D", "SHOULDERS_ARMS"]],
  PPL: [["A", "PUSH"], ["B", "PULL"], ["C", "LEGS"]],
  FULL_BODY: [["A", "FULL_BODY"], ["B", "FULL_BODY"], ["C", "FULL_BODY"]],
  CUSTOM: [["A", "UPPER"], ["B", "LEGS"], ["C", "SHOULDERS_ARMS"]],
  IRREGULAR: [["A", "UPPER"], ["B", "LOWER"]],
};
const IRREGULAR_ROTATION = ["A", "B", "A", "A", "B", "A"];
const GOAL_TEXT: Record<Stimulus, NonNullable<GenerationContext["profile"]>["goal"]> = { HYPERTROPHY: "Hipertrofia", STRENGTH: "Força", GENERAL_FITNESS: "Saúde e aptidão geral", MIXED: "Saúde e aptidão geral" };
const EQUIPMENT_CODES: Record<EquipmentSet, string[] | "NONE"> = { FULL: FULL_GYM, DUMBBELLS_BENCH: ["DUMBBELL", "BENCH"], BODYWEIGHT: "NONE" };

interface Lane { label: string; role: WorkoutRole; modalities?: string[] }

/** The workouts of a case: the rotation's strength lanes plus, for the mixed stimulus, one cardio and one mobility workout. */
function lanesOf(c: BenchCase): Lane[] {
  const base = ROLES[c.rotation];
  const strength = c.stimulus === "MIXED" ? base.slice(0, Math.max(1, Math.min(base.length, c.sessions - 2))) : base;
  const lanes: Lane[] = strength.map(([label, role]) => ({ label, role }));
  if (c.stimulus === "MIXED") lanes.push({ label: "Z2", role: "CARDIO", modalities: ["CARDIO"] }, { label: "MOB", role: "MOBILITY", modalities: ["MOBILITY"] });
  return lanes;
}

/** CUSTOM changes the role of the strength lanes from the second phase on (a real "different split per phase"). */
function roleIn(c: BenchCase, phaseIndex: number, lane: Lane): WorkoutRole {
  if (c.rotation !== "CUSTOM" || phaseIndex === 1 || lane.modalities) return lane.role;
  return ({ A: "PUSH", B: "PULL", C: "LEGS" } as Record<string, WorkoutRole>)[lane.label] ?? lane.role;
}

function screeningOf(kind: ScreeningKind) {
  const allNo = Object.fromEntries(PARQ_CODES.map((code) => [code, "no"]));
  if (kind === "CLEAR") return readScreening({ parq: { answers: allNo, professionalReview: { decision: null } } });
  if (kind === "OPEN") return readScreening({});
  return readScreening({ parq: { answers: { ...allNo, [PARQ_CODES[0]]: "yes" }, professionalReview: { decision: PARQ_DECISION_CODES[0], notes: "Decisão fictícia do teste." } } });
}

/** A history that disagrees with itself: pain after a heavy success, pain that "goes away", falling loads, effort 9-10 for a beginner. */
function contradictoryHistory(): ExposureLog[] {
  const set = (reps: number, loadKg: number, rir: number | null, completed = true) => ({ reps, durationSeconds: null, loadKg, loadBasis: "TOTAL" as const, rir, completed });
  const log = (exerciseId: string, date: string, pain: boolean, sets: ReturnType<typeof set>[], sessionEffort: number): ExposureLog => ({ exerciseId, date, equipmentKey: null, metric: "REPS", sets, pain, sessionEffort });
  return [
    log("ex-bench", "2026-09-02", false, [set(10, 80, 1), set(10, 80, 1), set(9, 80, 0)], 9),
    log("ex-bench", "2026-10-21", true, [set(5, 40, null, false), set(4, 40, null, false)], 10),
    log("ex-squat", "2026-09-10", true, [set(5, 60, null, false)], 10),
    log("ex-squat", "2026-10-26", false, [set(5, 100, 2), set(5, 100, 2), set(5, 100, 1)], 2),
    log("ex-row", "2026-09-15", false, [set(12, 60, 3), set(12, 60, 3)], 9),
    log("ex-row", "2026-10-30", false, [set(8, 30, 0), set(6, 30, 0)], 2),
  ];
}

function contextOf(c: BenchCase, over: { catalog?: CatalogExercise[]; phasesOverride?: PhaseSeedV2[] } = {}): GenerationContext {
  const base = generationContext();
  const days = (c.calendar === "IRREGULAR" ? DAYS_IRREGULAR : DAYS_REGULAR)[c.sessions];
  const lanes = lanesOf(c);
  const seed = (phaseIndex: number): PhaseSeedV2 => ({
    weeks: 4, sessionsPerWeek: c.sessions, trainingDays: days,
    workouts: lanes.map((l) => ({ label: l.label, exerciseTarget: l.modalities ? 2 : 6 })),
    ...(c.rotation === "IRREGULAR" ? { rotation: IRREGULAR_ROTATION } : {}),
    name: `Fase ${phaseIndex}`,
  });
  const phases = over.phasesOverride ?? Array.from({ length: c.phases }, (_, i) => seed(i + 1));
  const logs = c.history === "CONTRADICTORY" ? contradictoryHistory() : [];
  return {
    ...base,
    revision: { ...base.revision, schedule: scheduleOf(phases, c.calendar === "IRREGULAR" ? "2026-11-12" : "2026-11-09") },
    profile: base.profile && { ...base.profile, goal: GOAL_TEXT[c.stimulus], level: c.level, daysPerWeek: c.sessions, sessionMinutes: 60 },
    assessment: assessmentOf({ screening: screeningOf(c.screening) }),
    catalog: over.catalog ?? XINTUS_CATALOG,
    history: {
      window: { since: "2026-05-09", until: "2026-11-05", sinceDays: 180, sessions: logs.length, truncated: false },
      summary: { logs, exercises: [], customSkipped: 0, notDone: 0, sessionsWithEffort: logs.length },
    },
  };
}

function answersOf(c: BenchCase, phaseCount = c.phases): GenerationAnswersInput {
  const stimulus = c.stimulus === "MIXED" ? "STRENGTH" : c.stimulus;
  const modalities = lanesOf(c).filter((l) => l.modalities);
  return {
    stimulusByPhase: Array.from({ length: phaseCount }, (_, i) => ({ phaseIndex: i + 1, value: stimulus, basis: "PROFESSIONAL" as const })),
    equipmentCodes: EQUIPMENT_CODES[c.equipment],
    ...(modalities.length ? { modalitiesByWorkout: Array.from({ length: phaseCount }, (_, i) => modalities.map((l) => ({ phaseIndex: i + 1, label: l.label, modalities: l.modalities! }))).flat() } : {}),
  };
}

type Phases = BlueprintAcceptance["phases"];
async function acceptanceFor(run: TrainingBlueprint, phases: Phases): Promise<BlueprintAcceptance> {
  const dosing = { byClass: [], progression: [] };
  return {
    id: "acc-bench", runId: "run-bench", strategyId: "CUSTOM", splitFamily: "CUSTOM", phases, edits: [], dosing, structureFingerprint: run.structureFingerprint, baseContentVersion: 3,
    acceptanceHash: await acceptanceHash({ runBlueprintHash: await blueprintHash(run), strategyId: "CUSTOM", phases, dosing }),
    acceptedByUserId: "user-bench", acceptedAt: "2026-11-06T12:00:00.000Z",
  };
}
const phasesOf = (labelsByPhase: Lane[][], roleOf: (phaseIndex: number, lane: Lane) => WorkoutRole): Phases =>
  labelsByPhase.map((lanes, i) => ({
    phaseIndex: i + 1, splitType: "CUSTOM" as const,
    workouts: lanes.map((l) => ({ label: l.label, role: roleOf(i + 1, l), focusDelta: null, candidateExerciseIds: [], source: "PROFESSIONAL" as const })),
  }));

// ---------- running a case ----------

export interface Chain {
  ctx: GenerationContext;
  result: EngineResult;
  json: string;
  available: string[];
  compiledWorkouts: number;
  adapterIssues: Array<{ code: string; severity?: string }>;
  stages: Record<string, number>;
  rulesBlueprintCandidates: number;
}

/** Context -> rules strategy -> accepted blueprint -> compiler -> adapter -> engine. `withBlueprint:false` skips the planner/compiler (phase-wide coverage). */
export type RulesRef = typeof DEFAULT_RULESET;
/** The opt-in ruleset with the dose profiles (2026.11.6): the matrix runs it too, because the default one (2026.11.5) never touches them. */
export const DOSE_PROFILES_RULESET: RulesRef = OPT_IN_RULESETS.find((r) => r.version === "2026.11.6")!;

export async function runChain(ctx: GenerationContext, answers: GenerationAnswersInput, accept: ((run: TrainingBlueprint) => Promise<BlueprintAcceptance>) | null, rules: RulesRef = DEFAULT_RULESET): Promise<Chain> {
  const stages: Record<string, number> = {};
  const time = async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    const t = performance.now();
    const value = await fn();
    stages[name] = Math.round((performance.now() - t) * 10) / 10;
    return value;
  };
  let merged = parseGenerationAnswers(answers);
  let compiledWorkouts = 0;
  let candidates = 0;
  if (accept) {
    const bundle = await time("contexto de planejamento", () => xintusBundle({ revision: ctx.revision, profile: ctx.profile, catalog: ctx.catalog, assessment: ctx.assessment, history: ctx.history }, {}, answers));
    const planned = await time("estratégia por regras", () => produceRulesBlueprint(bundle));
    candidates = planned.strategies.length;
    const acceptance = await time("aceite (hashes)", () => accept(planned));
    const compiled = await time("compilador", () =>
      compileAcceptance({ run: planned, acceptance, structure: structureFacts(ctx.revision.schedule), coverageByWorkout: merged.coverageByWorkout, catalogIds: new Set(ctx.catalog.map((e) => e.id)), rules }));
    if (!compiled.ok) throw new Error(`${compiled.code}: ${compiled.message}`);
    merged = convertBlueprintToGenerationAnswers(merged, compiled);
    compiledWorkouts = merged.blueprint?.workouts.length ?? 0;
  }
  const built = await time("adaptador", () => buildEngineInput(ctx, merged, { rules }));
  if (!built.ok) throw new Error(built.code);
  const result = await time("motor", () => generate(built.input));
  return {
    ctx, result, json: canonicalJson(result), available: built.input.parameters.availableEquipment ?? [], compiledWorkouts,
    adapterIssues: built.issues as Chain["adapterIssues"], stages, rulesBlueprintCandidates: candidates,
  };
}

// ---------- metrics ----------

/** Fictitious prices, typed only for the benchmark; they are not any provider's. */
export const TEST_PRICES: TypedPrices = { currency: "USD", inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 15_000_000 };

export interface CaseMetrics {
  id: string;
  spec: BenchCase;
  ok: boolean;
  error: string | null;
  items: number;
  /** Items whose exercise is in the catalog, not archived and doable with the available equipment / items (must be 1). */
  eligibility: number;
  /** Mean / min of the per-workout `adherenceMin` the strategy audit reports (null: no workout with focus). */
  adherenceMean: number | null;
  adherenceMin: number | null;
  /** Workouts where the engine itself said the on-focus supply was short (no adherence promise there). */
  supplyShort: number;
  /** Workouts under 0.7 adherence although the supply was not short (must be 0). */
  adherenceBreaches: number;
  patternImbalanceOpen: number;
  patternImbalanceTotal: number;
  /** Sessions with an estimate and a budget: how many exceed the budget, and the worst estimate/budget ratio. */
  timedSessions: number;
  overBudgetSessions: number;
  worstTimeRatio: number | null;
  stable: boolean;
  errors: number;
  /** Errors other than CATALOG_INSUFFICIENT (a library that cannot fill a workout is reported, never silent); must be 0. */
  otherErrors: number;
  warnings: number;
  auditWarnings: number;
  /** errors + warnings + audit warnings: what the professional would still have to look at. */
  corrections: number;
  painExercisesPicked: number;
  /** Picks of the same exercises when the pain flags are removed from the history (null: the case has no pain in its history). */
  painControlPicks: number | null;
  /** One mock planning call: estimated tokens (the rules path costs none) and its cost with the fictitious prices. */
  mockInputTokens: number | null;
  mockOutputTokens: number | null;
  mockCostMicros: number | null;
  wallMs: number;
}

const byId = new Map(XINTUS_CATALOG.map((e) => [e.id, e]));
const eligibleItem = (id: string | null, available: readonly string[]): boolean => {
  const e = byId.get(id ?? "");
  if (!e || e.archived) return false;
  const has = (list: readonly string[]) => list.every((x) => available.includes(x));
  return has(e.equipment) || e.equipmentAlternatives.some(has);
};

async function mockPlanningCost(ctx: GenerationContext, answers: GenerationAnswersInput): Promise<{ input: number; output: number; micros: number | null } | null> {
  const bundle = await xintusBundle({ revision: ctx.revision, profile: ctx.profile, catalog: ctx.catalog, assessment: ctx.assessment, history: ctx.history }, {}, answers);
  const wire = toWireSchema(plannerResponseSchema, "mock");
  const req = await buildProviderPayload("PLANNER", { kind: "mock", system: PLANNER_SYSTEM_PROMPT, user: plannerUserMessage(bundle.context), schema: wire, schemaName: PLANNER_SCHEMA_NAME, vocabularySchemas: [wire] }, bundle.denyList);
  const res = await mockProvider.call(req, { kind: "mock", modelId: "mock-ok", maxOutputTokens: 6144, timeoutMs: 5000, apiKey: null });
  if (!res.ok || res.usage?.inputTokens == null || res.usage.outputTokens == null) return null;
  return { input: res.usage.inputTokens, output: res.usage.outputTokens, micros: costMicros(res.usage.inputTokens, res.usage.outputTokens, TEST_PRICES) };
}

function metricsOf(c: BenchCase, a: Chain, b: Chain, wallMs: number, cost: Awaited<ReturnType<typeof mockPlanningCost>>): CaseMetrics {
  const r = a.result;
  const picked = r.occurrences.flatMap((o) => o.items.filter((i) => i.exerciseId));
  const eligible = picked.filter((i) => eligibleItem(i.exerciseId, a.available)).length;
  const strategy = r.audit?.strategy;
  const ratios: number[] = [];
  let breaches = 0;
  let short = 0;
  for (const w of strategy?.workouts ?? []) {
    if (w.adherenceMin === null) continue;
    ratios.push(w.adherenceMin);
    const low = r.issues.some((i) => i.code === "BLUEPRINT_FOCUS_SUPPLY_LOW" && i.phaseIndex === w.phaseIndex && i.label === w.label);
    if (low) short += 1;
    else if (w.adherenceMin < 0.7) breaches += 1;
  }
  const imbalance = (r.audit?.findings ?? []).filter((f) => f.code === "AUDIT_PATTERN_IMBALANCE");
  const timed = r.occurrences.filter((o) => o.estimatedMinutes !== null && o.budgetMinutes);
  const over = timed.filter((o) => o.estimatedMinutes! > o.budgetMinutes!);
  const painIds = new Set(a.ctx.history.summary.logs.filter((l) => l.pain).map((l) => l.exerciseId));
  const errors = r.issues.filter((i) => i.severity === "ERROR").length;
  const otherErrors = r.issues.filter((i) => i.severity === "ERROR" && i.code !== "CATALOG_INSUFFICIENT").length;
  const warnings = r.issues.filter((i) => i.severity === "WARNING").length;
  const auditWarnings = (r.audit?.findings ?? []).filter((f) => f.severity === "WARNING").length;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    id: c.id, spec: c, ok: true, error: null, items: picked.length, eligibility: picked.length ? eligible / picked.length : 1,
    adherenceMean: ratios.length ? round(ratios.reduce((s, x) => s + x, 0) / ratios.length) : null,
    adherenceMin: ratios.length ? round(Math.min(...ratios)) : null,
    supplyShort: short, adherenceBreaches: breaches,
    patternImbalanceOpen: imbalance.filter((f) => f.status === "OPEN").length, patternImbalanceTotal: imbalance.length,
    timedSessions: timed.length, overBudgetSessions: over.length,
    worstTimeRatio: timed.length ? round(Math.max(...timed.map((o) => o.estimatedMinutes! / o.budgetMinutes!))) : null,
    stable: a.json === b.json, errors, otherErrors, warnings, auditWarnings, corrections: errors + warnings + auditWarnings,
    painExercisesPicked: picked.filter((i) => painIds.has(i.exerciseId!)).length, painControlPicks: null,
    mockInputTokens: cost?.input ?? null, mockOutputTokens: cost?.output ?? null, mockCostMicros: cost?.micros ?? null, wallMs: Math.round(wallMs),
  };
}

/** Runs one case twice end to end (two complete chains, to prove stability) and measures it. Never throws: a failure is a result. */
export async function runCase(c: BenchCase, rules: RulesRef = DEFAULT_RULESET): Promise<CaseMetrics> {
  const t0 = performance.now();
  try {
    const ctx = contextOf(c);
    const lanes = lanesOf(c);
    const answers = answersOf(c);
    const labelsByPhase = Array.from({ length: c.phases }, () => lanes);
    const accept = async (run: TrainingBlueprint) => acceptanceFor(run, phasesOf(labelsByPhase, (p, l) => roleIn(c, p, l)));
    const first = await runChain(ctx, answers, accept, rules);
    const second = await runChain(contextOf(c), answers, accept, rules);
    const cost = await mockPlanningCost(ctx, answers);
    const metrics = metricsOf(c, first, second, performance.now() - t0, cost);
    if (rules === DEFAULT_RULESET) {
      // control for the pain check: the same case with the pain flags removed from the history. Without it the count of picks cannot tell
      // "the weight kept them out" from "they were never going to be picked".
      const painIds = new Set(ctx.history.summary.logs.filter((l) => l.pain).map((l) => l.exerciseId));
      if (painIds.size) {
        const clean = contextOf(c);
        clean.history = { ...clean.history, summary: { ...clean.history.summary, logs: clean.history.summary.logs.map((l) => ({ ...l, pain: false })) } };
        const control = await runChain(clean, answers, accept, rules);
        const picks = (ch: Chain) => ch.result.occurrences.flatMap((o) => o.items).filter((i) => i.exerciseId && painIds.has(i.exerciseId)).length;
        metrics.painControlPicks = picks(control);
      }
    }
    return metrics;
  } catch (error) {
    return {
      id: c.id, spec: c, ok: false, error: error instanceof Error ? error.message : String(error), items: 0, eligibility: 0, adherenceMean: null, adherenceMin: null, supplyShort: 0, adherenceBreaches: 0,
      patternImbalanceOpen: 0, patternImbalanceTotal: 0, timedSessions: 0, overBudgetSessions: 0, worstTimeRatio: null, stable: false, errors: 0, otherErrors: 0, warnings: 0, auditWarnings: 0, corrections: 0,
      painExercisesPicked: 0, painControlPicks: null, mockInputTokens: null, mockOutputTokens: null, mockCostMicros: null, wallMs: Math.round(performance.now() - t0),
    };
  }
}

// ---------- the big case: with and without the blueprint path ----------

export interface BigMeasure {
  variant: "SEM_BLUEPRINT" | "COM_BLUEPRINT";
  rulesVersion: string;
  wallMs: number;
  cpuMs: number;
  heapDeltaMb: number;
  rssMb: number;
  occurrences: number;
  stages: Record<string, number>;
  /** Canonical-JSON length of the whole engine result, and of the result without the per-session occurrences (the summary that is stored). */
  resultKb: number;
  summaryKb: number;
}
export interface BigReport { shape: string; runs: number; gcExposed: boolean; node: string; measures: BigMeasure[] }

const BIG_ROLES: WorkoutRole[] = ["PUSH", "PULL", "LEGS", "UPPER", "LOWER", "FULL_BODY", "SHOULDERS_ARMS"];
const BIG_LABELS = ["A", "B", "C", "D", "E", "F", "G"];

function bigContext(): GenerationContext {
  const base = generationContext();
  const catalog = Array.from({ length: 200 }, (_, i) => ({ ...XINTUS_CATALOG[i % XINTUS_CATALOG.length], id: `gen-${String(i).padStart(3, "0")}`, substitutes: [] }));
  const phase: PhaseSeedV2 = { weeks: 4, sessionsPerWeek: 7, trainingDays: [0, 1, 2, 3, 4, 5, 6], workouts: BIG_LABELS.map((label) => ({ label, exerciseTarget: 8 })) };
  return { ...base, revision: { ...base.revision, schedule: scheduleOf(Array.from({ length: 12 }, () => phase)) }, catalog };
}

/**
 * 12 phases x 4 weeks x 7 sessions x 7 workouts x 8 items, 200 exercises (design §8.2). Medians of `runs` runs of the whole chain, wall time,
 * process CPU time and heap delta (a `gc()` before each run when the process exposes it). Local Node, NOT Workers: Workers' CPU limits,
 * memory and cold start are not reproduced.
 */
export async function measureBigCase(runs = 1): Promise<BigReport> {
  const gc = (globalThis as { gc?: () => void }).gc;
  const ctx = bigContext();
  const answers: GenerationAnswersInput = {
    stimulusByPhase: Array.from({ length: 12 }, (_, i) => ({ phaseIndex: i + 1, value: "HYPERTROPHY", basis: "PROFESSIONAL" as const })),
    equipmentCodes: FULL_GYM,
  };
  const lanes: Lane[] = BIG_LABELS.map((label, i) => ({ label, role: BIG_ROLES[i] }));
  const accept = async (run: TrainingBlueprint) => acceptanceFor(run, phasesOf(Array.from({ length: 12 }, () => lanes), (_p, l) => l.role));
  const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const measures: BigMeasure[] = [];
  const combos = ([DEFAULT_RULESET, DOSE_PROFILES_RULESET] as const).flatMap((rules) => (["SEM_BLUEPRINT", "COM_BLUEPRINT"] as const).map((variant) => ({ rules, variant })));
  for (const { rules, variant } of combos) {
    const samples: Array<{ wall: number; cpu: number; heap: number; rss: number; chain: Chain }> = [];
    for (let i = 0; i < runs; i += 1) {
      gc?.();
      const heap0 = process.memoryUsage().heapUsed;
      const cpu0 = process.cpuUsage();
      const t0 = performance.now();
      const chain = await runChain(ctx, answers, variant === "COM_BLUEPRINT" ? accept : null, rules);
      const wall = performance.now() - t0;
      const cpu = process.cpuUsage(cpu0);
      const mem = process.memoryUsage();
      samples.push({ wall, cpu: (cpu.user + cpu.system) / 1000, heap: (mem.heapUsed - heap0) / 1048576, rss: mem.rss / 1048576, chain });
    }
    const last = samples[samples.length - 1].chain;
    measures.push({
      variant, rulesVersion: rules.version, wallMs: Math.round(median(samples.map((s) => s.wall))), cpuMs: Math.round(median(samples.map((s) => s.cpu))),
      heapDeltaMb: Math.round(median(samples.map((s) => s.heap)) * 10) / 10, rssMb: Math.round(median(samples.map((s) => s.rss))),
      occurrences: last.result.occurrences.length, stages: last.stages, resultKb: Math.round(last.json.length / 1024),
      summaryKb: Math.round(canonicalJson({ ...last.result, occurrences: [] }).length / 1024),
    });
  }
  return { shape: "12 fases x 4 semanas x 7 sessões, 7 treinos x 8 itens, 200 exercícios", runs, gcExposed: Boolean(gc), node: process.version, measures };
}

// ---------- the report ----------

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const money = (micros: number | null) => (micros === null ? "—" : `US$ ${(micros / 1_000_000).toFixed(4)}`);

export function renderMatrix(results: CaseMetrics[], big: BigReport | null, doseProfiles: CaseMetrics[] | null = null): string {
  const lines: string[] = [];
  lines.push("| caso | dias | estímulo | nível | rotação | equip. | calend. | triagem | histórico | itens | elegib. | aderência (média/mín.) | oferta curta | desequil. abertos | tempo (acima/medidas, pior) | estável | correções (E/A/auditoria) | custo simulado |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const m of results) {
    const s = m.spec;
    if (!m.ok) {
      lines.push(`| ${m.id} | ${s.sessions} | ${s.stimulus} | ${s.level} | ${s.rotation} | ${s.equipment} | ${s.calendar} | ${s.screening} | ${s.history} | FALHOU: ${m.error} |`);
      continue;
    }
    lines.push(
      `| ${m.id} | ${s.sessions} | ${s.stimulus} | ${s.level} | ${s.rotation} | ${s.equipment} | ${s.calendar} | ${s.screening} | ${s.history} | ${m.items} | ${pct(m.eligibility)} | ${m.adherenceMean === null ? "—" : `${pct(m.adherenceMean)}/${pct(m.adherenceMin)}`} | ${m.supplyShort} | ${m.patternImbalanceOpen} | ${m.overBudgetSessions}/${m.timedSessions}${m.worstTimeRatio === null ? "" : `, ${m.worstTimeRatio.toFixed(2)}x`} | ${m.stable ? "sim" : "NÃO"} | ${m.corrections} (${m.errors}/${m.warnings}/${m.auditWarnings}) | ${money(m.mockCostMicros)} |`,
    );
  }
  const ok = results.filter((m) => m.ok);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const adherence = ok.map((m) => m.adherenceMean).filter((x): x is number => x !== null);
  const costs = ok.map((m) => m.mockCostMicros).filter((x): x is number => x !== null);
  lines.push("");
  lines.push(
    `Resumo: ${ok.length}/${results.length} casos concluídos; elegibilidade ${pct(Math.min(...ok.map((m) => m.eligibility)))} no pior caso; ${ok.filter((m) => m.stable).length}/${ok.length} estáveis; ` +
      `aderência média ${pct(mean(adherence))}; ${ok.reduce((n, m) => n + m.adherenceBreaches, 0)} treino(s) abaixo de 70% sem oferta curta; ${ok.reduce((n, m) => n + m.supplyShort, 0)} treino(s) com oferta curta declarada; ` +
      `${ok.reduce((n, m) => n + m.otherErrors, 0)} erro(s) do motor além de biblioteca insuficiente; ${ok.reduce((n, m) => n + m.painExercisesPicked, 0)} escolha(s) de exercício com dor no histórico nos ${ok.filter((m) => m.painControlPicks !== null).length} casos com dor registrada, contra ${ok.reduce((n, m) => n + (m.painControlPicks ?? 0), 0)} no controle (mesmos casos com a dor removida do histórico); correções por caso (média) ${mean(ok.map((m) => m.corrections)).toFixed(1)}; custo simulado por proposta, só com preços de teste inventados: ${costs.length ? `${money(Math.min(...costs))} a ${money(Math.max(...costs))}` : "—"}.`,
  );
  if (doseProfiles) {
    const dp = doseProfiles.filter((m) => m.ok);
    lines.push("");
    lines.push(
      `Mesma amostra com a política de doses opt-in (regras 2026.11.6): ${dp.length}/${doseProfiles.length} casos concluídos; elegibilidade ${pct(Math.min(...dp.map((m) => m.eligibility)))} no pior caso; ${dp.filter((m) => m.stable).length}/${dp.length} estáveis; ` +
        `aderência média ${pct(mean(dp.map((m) => m.adherenceMean).filter((x): x is number => x !== null)))}; ${dp.reduce((n, m) => n + m.adherenceBreaches, 0)} treino(s) abaixo de 70% sem oferta curta; ${dp.reduce((n, m) => n + m.supplyShort, 0)} com oferta curta; ` +
        `${dp.reduce((n, m) => n + m.otherErrors, 0)} erro(s) além de biblioteca insuficiente; ${dp.reduce((n, m) => n + m.overBudgetSessions, 0)} sessão(ões) acima do tempo (contra ${ok.reduce((n, m) => n + m.overBudgetSessions, 0)} nas 2026.11.5).`,
    );
  }
  if (big) {
    lines.push("");
    lines.push(`Caso grande (${big.shape}; mediana de ${big.runs} execução(ões); Node ${big.node}; gc ${big.gcExposed ? "exposto" : "não exposto"}; NÃO é Workers):`);
    lines.push("");
    lines.push("| regras | variante | parede (ms) | CPU do processo (ms) | heap Δ (MB) | RSS (MB) | sessões | resultado completo (KB) | sem as sessões (KB) |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const m of big.measures) lines.push(`| ${m.rulesVersion} | ${m.variant === "COM_BLUEPRINT" ? "com blueprint (regras)" : "sem blueprint"} | ${m.wallMs} | ${m.cpuMs} | ${m.heapDeltaMb} | ${m.rssMb} | ${m.occurrences} | ${m.resultKb} | ${m.summaryKb} |`);
    for (const m of big.measures) lines.push(`- etapas, ${m.rulesVersion} ${m.variant === "COM_BLUEPRINT" ? "com blueprint" : "sem blueprint"} (ms): ${Object.entries(m.stages).map(([k, v]) => `${k} ${v}`).join("; ")}`);
  }
  return lines.join("\n");
}
