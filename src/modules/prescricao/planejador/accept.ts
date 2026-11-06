import "server-only";
/**
 * Accept -> generate (design V4 §4.7, sub-stage 2.3): the ONE server path that turns the professional's choice of a suggested strategy
 * into a generation. Three steps, each its own call:
 *
 *   accept    the professional chooses S1/S2/S3 (or CUSTOM), optionally edits the focus per workout and ticks the dose/progression intents
 *             they want. The server checks the choice against the stored run and the saved periodization, DRY-COMPILES it (so nothing is
 *             stored that could not be generated) and appends one row (`blueprint_acceptances`). Idempotent by key.
 *   generate  the server reloads the acceptance, the run's stored blueprint and the real data, compiles (`compile.ts`), merges the block
 *             into the answers and calls the proposal service's own `generate` with the block as a server-side argument. The block never
 *             travels in a payload. The link to the proposal is written by the proposal service in the SAME batch as the generation.
 *   replan    "Voltar à estratégia" on an open proposal: same compile, merged into the stored block by phase and acceptance.
 *
 * Nothing here applies, approves or delivers anything: a generation only creates an OPEN proposal, as always. The strategy of an AI run
 * enters only as an acceptance the professional made; a failure of the planner never reaches this module (the way out is `plan(RULES)`).
 *
 * Tenant and identity come from the verified session; every read and write goes through the gated repositories.
 */
import type { D1Database } from "@cloudflare/workers-types";
import { z, ZodError } from "zod";
import { aiPlanningFor, type AcceptanceRow } from "@/db/ai-planning";
import { proposalsFor } from "@/db/prescription-proposals";
import type { AuthenticatedContext } from "@/db/students";
import { loadGenerationContext } from "@/modules/prescricao/automatica/context";
import { carriesBlueprint, CLIENT_BLUEPRINT_REFUSED, parseGenerationAnswers, type BlueprintAnswers } from "@/modules/prescricao/automatica/contracts";
import { structureFacts } from "@/modules/prescricao/automatica/facts";
import { fail as proposalFail, proposalService, type ProposalOutcome, type ReplanPayload } from "@/modules/prescricao/automatica/service";
import { canonicalJson, sha256Hex } from "@/modules/prescricao/motor/hash";
import { DEFAULT_RULESET, rulesetForNewGeneration } from "@/modules/prescricao/motor/rules";
import type { RuleSetRef, StructureFacts } from "@/modules/prescricao/motor/types";
import { cmp } from "@/modules/prescricao/motor/vocabulary";
import { type BlueprintAcceptance, type StoredStrategy, type TrainingBlueprint } from "./blueprint";
import { compileAcceptance, convertBlueprintToGenerationAnswers, type CompileOutcome } from "./compile";
import { deltaSize, expandFocus, focusDeltaSchema, normalizeDeltaOf, type ExpandedFocus, type FocusDelta } from "./focus";
import { acceptanceHash, blueprintHash, structureFingerprint } from "./hashes";
import { readBlueprint } from "./orchestration";
import { roleTableOf } from "./role-table";
import { type RoleFocusTable } from "./role-focus";
import { toStrategyListView, type StrategyListView } from "./strategy-view";
import { FOCUS_DELTA_MAX_ITEMS, PLANNER_MAX_CANDIDATES_PER_WORKOUT, PLANNER_MAX_PHASES, PLANNER_MAX_WORKOUTS_PER_PHASE } from "./versions";
import { DOSE_PROFILE_CODES, EXERCISE_CLASSES, PROGRESSION_INTENTS, WORKOUT_ROLES, SPLIT_DISPLAY_NAME, type FocusSource, type SplitFamily } from "./vocab";

// ---------- payloads ----------

const intentId = z.string().regex(/^[A-Za-z0-9-]{16,64}$/);
const rowId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const phaseNo = z.number().int().min(1).max(PLANNER_MAX_PHASES);
const workoutInput = z.strictObject({
  label: z.string().trim().min(1).max(20),
  role: z.enum(WORKOUT_ROLES),
  focusDelta: focusDeltaSchema.nullable(),
  candidateExerciseIds: z.array(z.string().trim().min(1).max(40)).max(PLANNER_MAX_CANDIDATES_PER_WORKOUT),
});
const acceptSchema = z.strictObject({
  idempotencyKey: intentId,
  runId: rowId,
  strategyId: z.enum(["S1", "S2", "S3", "CUSTOM"]),
  /** The focus the professional ends up with, per workout, as role + delta. Workouts left out keep the strategy's own (CUSTOM: only those listed exist). */
  phases: z.array(z.strictObject({ phaseIndex: phaseNo, workouts: z.array(workoutInput).min(1).max(PLANNER_MAX_WORKOUTS_PER_PHASE) })).max(PLANNER_MAX_PHASES).default([]),
  /** ONLY what the professional ticked; empty = switched off. */
  dosing: z
    .strictObject({
      byClass: z.array(z.strictObject({ exerciseClass: z.enum(EXERCISE_CLASSES), profileCode: z.enum(DOSE_PROFILE_CODES) })).max(EXERCISE_CLASSES.length).default([]),
      progression: z.array(z.strictObject({ phaseIndex: phaseNo, intent: z.enum(PROGRESSION_INTENTS) })).max(PLANNER_MAX_PHASES).default([]),
    })
    .default({ byClass: [], progression: [] }),
  baseContentVersion: z.number().int().min(0),
});
export type AcceptPayload = z.input<typeof acceptSchema>;

/** `rulesVersion`: adesão explícita a uma versão publicada que não é o padrão (as doses por perfil); ausente = o padrão. Validada pelo serviço de propostas. */
const generateSchema = z.strictObject({ idempotencyKey: intentId, baseContentVersion: z.number().int().min(0), acceptanceId: rowId, answers: z.unknown(), rulesVersion: z.string().trim().min(1).max(40).optional() });
export type BlueprintGeneratePayload = z.input<typeof generateSchema>;

const replanSchema = z.strictObject({
  proposalId: z.string().min(1).max(64),
  idempotencyKey: intentId,
  writeId: intentId,
  expectedVersion: z.number().int().min(1),
  acceptanceId: rowId,
  scope: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("PHASE"), phaseIndex: phaseNo }), z.strictObject({ kind: z.literal("FROM_PHASE"), phaseIndex: phaseNo }), z.strictObject({ kind: z.literal("FULL") })]),
});
export type BlueprintReplanPayload = z.input<typeof replanSchema>;

/** What a "voltar à estratégia" keeps (locked, replaced by the professional, already in the draft) and replaces (the engine's own picks), per occurrence of the scope. */
export interface ReplanPreview {
  kept: number;
  replaced: number;
  locked: number;
  substituted: number;
  preserved: number;
  phases: number[];
}

// ---------- outcomes ----------

export type AcceptFailure =
  | "invalid" | "not_found" | "not_open" | "key_reused" | "revision_changed" | "structure_changed" | "run_missing" | "plan_erased"
  | "strategy_requires_schedule_change" | "structure_focus_locked" | "blueprint_invalid";

export const ACCEPT_MESSAGE: Record<AcceptFailure, string> = {
  invalid: "Confira a escolha: algum valor não é aceito.",
  not_found: "Prescrição não encontrada.",
  not_open: "Só é possível aceitar uma estratégia numa prescrição em rascunho.",
  key_reused: "Esta tentativa já foi usada com outros dados. Tente de novo.",
  revision_changed: "A prescrição mudou desde que as estratégias foram sugeridas. Planeje de novo para atualizar.",
  structure_changed: "A periodização mudou depois do aceite. Planeje de novo.",
  run_missing: "Esta sugestão não existe mais para esta prescrição. Planeje de novo.",
  plan_erased: "Os dados desta sugestão foram apagados com os dados do aluno. Planeje de novo.",
  strategy_requires_schedule_change: "Esta estratégia exige alterar rótulos, rotação ou frequência na periodização antes de ser aceita.",
  structure_focus_locked: "O foco deste treino está salvo na periodização e não é editado aqui. Edite-o na periodização.",
  blueprint_invalid: "O aceite da estratégia não pertence a esta revisão, foi substituído ou não existe mais. Aceite a estratégia de novo antes de gerar.",
};

export interface AcceptanceView {
  acceptanceId: string;
  runId: string;
  strategyId: "S1" | "S2" | "S3" | "CUSTOM";
  splitFamily: string;
  familyLabel: string;
  baseContentVersion: number;
  acceptedAt: string;
  /** The final focus per workout (what will be compiled), with who decided it. */
  workouts: Array<{ phaseIndex: number; label: string; role: string; source: FocusSource; focusDelta: FocusDelta | null }>;
  edits: BlueprintAcceptance["edits"];
  dosing: BlueprintAcceptance["dosing"];
}

export type AcceptOutcome = { ok: true; replayed: boolean; acceptance: AcceptanceView } | { ok: false; reason: AcceptFailure; message: string };

const failed = (reason: AcceptFailure, message?: string): { ok: false; reason: AcceptFailure; message: string } => ({ ok: false, reason, message: message ?? ACCEPT_MESSAGE[reason] });

const COMPILE_TO_FAILURE: Record<Extract<CompileOutcome, { ok: false }>["code"], AcceptFailure> = {
  STRUCTURE_CHANGED: "structure_changed",
  STRATEGY_REQUIRES_SCHEDULE_CHANGE: "strategy_requires_schedule_change",
  PHASE_MISSING: "invalid",
  LABEL_MISSING: "invalid",
  UNKNOWN_CANDIDATE: "invalid",
  UNSUPPORTED_RULESET: "blueprint_invalid",
  ACCEPTANCE_MISMATCH: "blueprint_invalid",
  INVALID_BLUEPRINT: "invalid",
};

// ---------- stored acceptance <-> contract ----------

const storedPhases = z.array(
  z.strictObject({
    phaseIndex: phaseNo,
    splitType: z.string(),
    workouts: z.array(z.strictObject({ label: z.string(), role: z.enum(WORKOUT_ROLES), focusDelta: focusDeltaSchema.nullable(), candidateExerciseIds: z.array(z.string()), source: z.enum(["AI_SUGGESTED", "RULES_HEURISTIC", "PROFESSIONAL"]) })),
  }),
);
const storedDosing = z.strictObject({
  byClass: z.array(z.strictObject({ exerciseClass: z.string(), profileCode: z.string() })),
  progression: z.array(z.strictObject({ phaseIndex: phaseNo, intent: z.string() })),
});
const storedEdits = z.array(z.strictObject({ phaseIndex: phaseNo, label: z.string(), field: z.enum(["role", "dominantMuscles", "supportingMuscles", "targetPatterns", "allowedSpilloverPatterns"]) }));

/** The acceptance row as the contract the compiler reads; null when a stored column does not parse (never trusted blindly). */
export function acceptanceOf(row: AcceptanceRow): BlueprintAcceptance | null {
  try {
    const final = z.strictObject({ phases: storedPhases }).safeParse(JSON.parse(row.finalJson));
    const dosing = storedDosing.safeParse(JSON.parse(row.dosingJson));
    const edits = storedEdits.safeParse(JSON.parse(row.editsJson));
    if (!final.success || !dosing.success || !edits.success) return null;
    return {
      id: row.id, runId: row.runId, strategyId: row.strategyId, splitFamily: row.splitFamily as SplitFamily,
      phases: final.data.phases as BlueprintAcceptance["phases"], edits: edits.data, dosing: dosing.data,
      structureFingerprint: row.structureFingerprint, baseContentVersion: row.baseContentVersion, acceptanceHash: row.acceptanceHash,
      acceptedByUserId: row.acceptedByUserId, acceptedAt: row.acceptedAt,
    };
  } catch {
    return null;
  }
}

export function acceptanceView(a: BlueprintAcceptance): AcceptanceView {
  return {
    acceptanceId: a.id, runId: a.runId, strategyId: a.strategyId, splitFamily: a.splitFamily, familyLabel: SPLIT_DISPLAY_NAME[a.splitFamily] ?? a.splitFamily,
    baseContentVersion: a.baseContentVersion, acceptedAt: a.acceptedAt,
    workouts: a.phases.flatMap((p) => p.workouts.map((w) => ({ phaseIndex: p.phaseIndex, label: w.label, role: w.role, source: w.source, focusDelta: w.focusDelta }))),
    edits: a.edits, dosing: a.dosing,
  };
}

export { roleTableOf };

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, n) => x === b[n]);
const FIELDS: Array<[Exclude<keyof ExpandedFocus, never>, BlueprintAcceptance["edits"][number]["field"]]> = [
  ["dominantMuscles", "dominantMuscles"], ["supportingMuscles", "supportingMuscles"], ["targetPatterns", "targetPatterns"], ["allowedSpilloverPatterns", "allowedSpilloverPatterns"],
];
const key = (phaseIndex: number, label: string) => `${phaseIndex}|${label}`;

/** Which fields of a workout's focus differ between the strategy's and the professional's (expanded against the run's role table). */
export function editedFields(table: RoleFocusTable, from: { role: string; focusDelta: Parameters<typeof expandFocus>[1] }, to: { role: string; focusDelta: Parameters<typeof expandFocus>[1] }): Array<BlueprintAcceptance["edits"][number]["field"]> {
  const out: Array<BlueprintAcceptance["edits"][number]["field"]> = [];
  if (from.role !== to.role) out.push("role");
  const a = expandFocus(from.role as never, from.focusDelta, table);
  const b = expandFocus(to.role as never, to.focusDelta, table);
  for (const [field, name] of FIELDS) if (!sameList(a[field], b[field])) out.push(name);
  return out;
}

export interface BlueprintServiceDeps {
  now?: () => Date;
  newId?: () => string;
  workUnitsPerRequest?: number;
}

export function blueprintService(db: D1Database, context: AuthenticatedContext, deps: BlueprintServiceDeps = {}) {
  const repo = aiPlanningFor(db, context);
  const clock = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const proposals = () => proposalService(db, context, { now: clock, ...(deps.workUnitsPerRequest ? { workUnitsPerRequest: deps.workUnitsPerRequest } : {}) });

  async function loadRun(planId: string, revisionId: string, runId: string): Promise<{ ok: true; row: NonNullable<Awaited<ReturnType<typeof repo.runById>>>; blueprint: TrainingBlueprint } | { ok: false; failure: AcceptFailure }> {
    const row = await repo.runById(planId, revisionId, runId);
    if (!row || row.status !== "SUCCEEDED") return { ok: false, failure: "run_missing" };
    const json = await repo.payloadOf(planId, revisionId, runId);
    if (!json) return { ok: false, failure: "plan_erased" };
    const blueprint = readBlueprint(json);
    return blueprint ? { ok: true, row, blueprint } : { ok: false, failure: "plan_erased" };
  }

  /** The acceptance the professional can generate from: it exists in this revision, parses, and is the newest (a later acceptance supersedes it). */
  async function currentAcceptance(planId: string, revisionId: string, acceptanceId: string): Promise<{ ok: true; acceptance: BlueprintAcceptance } | { ok: false; message?: string }> {
    const row = await repo.acceptanceById(planId, revisionId, acceptanceId);
    if (!row) return { ok: false };
    const latest = await repo.latestAcceptance(planId, revisionId);
    if (!latest || latest.id !== row.id) return { ok: false, message: "Esta estratégia foi substituída por um aceite mais novo. Use o aceite atual." };
    const acceptance = acceptanceOf(row);
    return acceptance ? { ok: true, acceptance } : { ok: false };
  }

  /** Compiles an acceptance against the real, current data. */
  async function compileFor(planId: string, revisionId: string, acceptance: BlueprintAcceptance, answers: ReturnType<typeof parseGenerationAnswers>, structure: StructureFacts, catalogIds: ReadonlySet<string>, rules: RuleSetRef = DEFAULT_RULESET) {
    const run = await loadRun(planId, revisionId, acceptance.runId);
    if (!run.ok) return { ok: false as const, failure: run.failure, message: undefined as string | undefined };
    const compiled = await compileAcceptance({ run: run.blueprint, acceptance, structure, coverageByWorkout: answers.coverageByWorkout, catalogIds, rules });
    if (!compiled.ok) return { ok: false as const, failure: COMPILE_TO_FAILURE[compiled.code], message: compiled.message };
    return { ok: true as const, compiled };
  }

  return {
    /** Records the professional's choice (append-only). Idempotent by key; a new acceptance supersedes the earlier ones. */
    async accept(planId: string, revisionId: string, payload: AcceptPayload): Promise<AcceptOutcome> {
      const parsed = acceptSchema.safeParse(payload);
      if (!parsed.success) return failed("invalid");
      const p = parsed.data;
      const hash = await sha256Hex(canonicalJson({ kind: "ACCEPT", planId, revisionId, runId: p.runId, strategyId: p.strategyId, phases: p.phases, dosing: p.dosing, baseContentVersion: p.baseContentVersion }));

      const replayOf = async (): Promise<AcceptOutcome | null> => {
        const existing = await repo.acceptanceByKey(planId, revisionId, p.idempotencyKey);
        if (!existing) return null;
        if (existing.requestHash !== hash) return failed("key_reused");
        const a = acceptanceOf(existing);
        return a ? { ok: true, replayed: true, acceptance: acceptanceView(a) } : failed("blueprint_invalid");
      };
      const replay = await replayOf();
      if (replay) return replay;

      const loaded = await loadGenerationContext(db, context, planId, revisionId, { now: clock() });
      if (loaded.status === "not_found") return failed("not_found");
      if (loaded.status === "not_open") return failed("not_open");
      const gen = loaded.context;
      if (gen.revision.contentVersion !== p.baseContentVersion) return failed("revision_changed");

      const run = await loadRun(planId, revisionId, p.runId);
      if (!run.ok) return failed(run.failure);
      if (run.row.baseContentVersion !== gen.revision.contentVersion) return failed("revision_changed");
      const structure = structureFacts(gen.revision.schedule);
      const fingerprint = await structureFingerprint(structure);
      if (run.row.structureFingerprint !== fingerprint || run.blueprint.structureFingerprint !== fingerprint) return failed("structure_changed");
      const table = roleTableOf(run.blueprint.roleFocusRef);
      if (!table) return failed("blueprint_invalid");

      const strategy: StoredStrategy | null = p.strategyId === "CUSTOM" ? null : run.blueprint.strategies.find((s) => s.strategyId === p.strategyId) ?? null;
      if (p.strategyId !== "CUSTOM" && !strategy) return failed("invalid");
      if (strategy && (strategy.requiresScheduleChange || strategy.supportedByContext === "NO")) return failed("strategy_requires_schedule_change");
      const provenance: "AI_SUGGESTED" | "RULES_HEURISTIC" = strategy ? strategy.provenance : run.blueprint.producer.kind === "AI" ? "AI_SUGGESTED" : "RULES_HEURISTIC";
      const catalogIds = new Set(gen.catalog.map((e) => e.id));

      // Workouts whose focus the saved periodization already holds: read-only here (the saved focus wins at generation).
      const structureLocked = new Set<string>();
      for (const ph of structure.phases) for (const w of ph.workouts) if (w.focus.muscles?.length || w.focus.patterns?.length) structureLocked.add(key(ph.index, w.label));
      const structureLabels = new Map(structure.phases.map((ph) => [ph.index, new Set(ph.workouts.map((w) => w.label))]));

      const wanted = new Map<string, z.infer<typeof workoutInput>>();
      for (const ph of p.phases)
        for (const w of ph.workouts) {
          if (!structureLabels.get(ph.phaseIndex)?.has(w.label)) return failed("invalid", "A escolha cita uma fase ou um treino que não existe na periodização salva.");
          if (wanted.has(key(ph.phaseIndex, w.label))) return failed("invalid", "Um foco por treino.");
          if (deltaSize(w.focusDelta) > FOCUS_DELTA_MAX_ITEMS) return failed("invalid", "Ajuste de foco grande demais.");
          if (w.candidateExerciseIds.some((id) => !catalogIds.has(id))) return failed("invalid", "A escolha cita um exercício que não está na biblioteca visível.");
          wanted.set(key(ph.phaseIndex, w.label), w);
        }

      const edits: BlueprintAcceptance["edits"] = [];
      const phases: BlueprintAcceptance["phases"] = [];
      if (strategy) {
        for (const sp of strategy.phases) {
          const workouts: BlueprintAcceptance["phases"][number]["workouts"] = [];
          for (const w of sp.workouts) {
            const base = { label: w.label, role: w.role, focusDelta: normalizeDeltaOf(w.focusDelta), candidateExerciseIds: [...w.candidateExerciseIds].sort(cmp) };
            const strategySource: FocusSource = w.source === "STRUCTURE" ? provenance : w.source;
            const asked = wanted.get(key(sp.phaseIndex, w.label));
            wanted.delete(key(sp.phaseIndex, w.label));
            if (!asked) {
              workouts.push({ ...base, source: strategySource });
              continue;
            }
            const next = { label: w.label, role: asked.role, focusDelta: normalizeDeltaOf(asked.focusDelta), candidateExerciseIds: [...new Set(asked.candidateExerciseIds)].sort(cmp) };
            const fields = editedFields(table, base, next);
            const candidatesChanged = !sameList(base.candidateExerciseIds, next.candidateExerciseIds);
            if (!fields.length && !candidatesChanged) {
              workouts.push({ ...base, source: strategySource });
              continue;
            }
            if (w.source === "STRUCTURE" || structureLocked.has(key(sp.phaseIndex, w.label))) return failed("structure_focus_locked");
            // The professional may drop nominations, never invent the strategy's: a candidate the strategy did not name is not "AI".
            if (next.candidateExerciseIds.some((id) => !base.candidateExerciseIds.includes(id))) return failed("invalid", "Os exercícios candidatos só podem ser retirados da estratégia.");
            for (const field of fields) edits.push({ phaseIndex: sp.phaseIndex, label: w.label, field });
            workouts.push({ ...next, source: "PROFESSIONAL" });
          }
          phases.push({ phaseIndex: sp.phaseIndex, splitType: sp.splitType, workouts });
        }
        if (wanted.size) return failed("invalid", "A estratégia não prevê algum dos treinos editados.");
      } else {
        if (!p.phases.length) return failed("invalid", "A estratégia personalizada precisa do foco de pelo menos um treino.");
        for (const ph of [...p.phases].sort((a, b) => a.phaseIndex - b.phaseIndex)) {
          const workouts: BlueprintAcceptance["phases"][number]["workouts"] = [];
          for (const w of ph.workouts) {
            if (structureLocked.has(key(ph.phaseIndex, w.label))) return failed("structure_focus_locked");
            workouts.push({ label: w.label, role: w.role, focusDelta: normalizeDeltaOf(w.focusDelta), candidateExerciseIds: [...new Set(w.candidateExerciseIds)].sort(cmp), source: "PROFESSIONAL" });
          }
          phases.push({ phaseIndex: ph.phaseIndex, splitType: "CUSTOM", workouts });
        }
      }
      for (const ph of phases) ph.workouts.sort((a, b) => cmp(a.label, b.label));
      phases.sort((a, b) => a.phaseIndex - b.phaseIndex);
      edits.sort((a, b) => a.phaseIndex - b.phaseIndex || cmp(a.label, b.label) || cmp(a.field, b.field));

      // Only dose/progression intents the strategy itself carried can be ticked (CUSTOM: the recommended strategy's).
      const intents = strategy ?? run.blueprint.strategies.find((s) => s.strategyId === run.blueprint.recommendedStrategyId) ?? null;
      const dosing = {
        byClass: [...p.dosing.byClass].sort((a, b) => cmp(a.exerciseClass, b.exerciseClass)),
        progression: [...p.dosing.progression].sort((a, b) => a.phaseIndex - b.phaseIndex),
      };
      if (dosing.byClass.some((d) => !intents?.dosingIntent.some((i) => i.exerciseClass === d.exerciseClass && i.profileCode === d.profileCode))) return failed("invalid", "A escolha de dose não faz parte da estratégia.");
      if (dosing.progression.some((d) => !intents?.progressionIntent.some((i) => i.phaseIndex === d.phaseIndex && i.intent === d.intent))) return failed("invalid", "A escolha de progressão não faz parte da estratégia.");

      const runHash = await blueprintHash(run.blueprint);
      const now = clock();
      const draft: BlueprintAcceptance = {
        id: newId(), runId: p.runId, strategyId: p.strategyId, splitFamily: strategy ? strategy.splitFamily : "CUSTOM", phases, edits, dosing,
        structureFingerprint: fingerprint, baseContentVersion: gen.revision.contentVersion,
        acceptanceHash: await acceptanceHash({ runBlueprintHash: runHash, strategyId: p.strategyId, phases, dosing }),
        acceptedByUserId: context.userId, acceptedAt: now.toISOString(),
      };
      // Dry compile: nothing is stored that the generation could not compile (labels, candidates, size, ruleset).
      const dry = await compileAcceptance({ run: run.blueprint, acceptance: draft, structure, catalogIds, rules: DEFAULT_RULESET });
      if (!dry.ok) return failed(COMPILE_TO_FAILURE[dry.code], dry.message);

      const inserted = await repo.insertAcceptance({
        id: draft.id, planId, revisionId, runId: draft.runId, idempotencyKey: p.idempotencyKey, requestHash: hash, strategyId: draft.strategyId, splitFamily: draft.splitFamily,
        finalJson: canonicalJson({ phases }), dosingJson: canonicalJson(dosing), editsJson: canonicalJson(edits), acceptanceHash: draft.acceptanceHash,
        structureFingerprint: fingerprint, baseContentVersion: draft.baseContentVersion, now,
      });
      if (inserted.ok) return { ok: true, replayed: false, acceptance: acceptanceView(draft) };
      if (inserted.reason === "duplicate_key") return (await replayOf()) ?? failed("key_reused");
      if (inserted.reason === "revision_changed") return failed("revision_changed");
      if (inserted.reason === "not_found") return failed("not_found");
      return failed("run_missing");
    },

    /** The newest successful run's strategies and the newest acceptance (null when there is no run to accept from). */
    async current(planId: string, revisionId: string): Promise<{ run: StrategyListView; acceptance: AcceptanceView | null } | null> {
      const run = await repo.latestRun(planId, revisionId, "SUCCEEDED");
      if (!run) return null;
      const version = await repo.currentContentVersion(planId, revisionId);
      if (version === null || version !== run.baseContentVersion) return null;
      const blueprint = readBlueprint(await repo.payloadOf(planId, revisionId, run.id));
      if (!blueprint) return null;
      const row = await repo.latestAcceptance(planId, revisionId);
      const acceptance = row ? acceptanceOf(row) : null;
      return { run: toStrategyListView(blueprint, run.id, run.baseContentVersion), acceptance: acceptance && acceptance.runId === run.id ? acceptanceView(acceptance) : null };
    },

    /**
     * "Gerar com a estratégia aceita": compiles the acceptance against the real data and generates. The block is the server's own argument
     * to the proposal service; the rest (budget and phase splitting, `open_exists`, `revision_changed`, idempotent replay) is its own logic.
     */
    async generate(planId: string, revisionId: string, payload: BlueprintGeneratePayload): Promise<ProposalOutcome> {
      const parsed = generateSchema.safeParse(payload);
      if (!parsed.success) return proposalFail("invalid");
      if (carriesBlueprint(parsed.data.answers)) return proposalFail("invalid", { message: CLIENT_BLUEPRINT_REFUSED });
      let answers: ReturnType<typeof parseGenerationAnswers>;
      try {
        answers = parseGenerationAnswers(parsed.data.answers);
      } catch (error) {
        if (error instanceof ZodError) return proposalFail("invalid", { message: "Confira as respostas: algum valor não é aceito (código, número ou lista)." });
        throw error;
      }
      // A retry of a generation that already succeeded replays it, before anything is recompiled against data that may have moved since.
      const earlier = await proposalsFor(db, context).proposalOfKey(planId, revisionId, parsed.data.idempotencyKey);
      if (earlier) {
        const links = await proposalsFor(db, context).blueprintLinks(planId, revisionId, earlier.proposalId);
        if (links.some((l) => l.acceptanceId === parsed.data.acceptanceId)) return { ok: true, proposalId: earlier.proposalId, version: earlier.version, complete: earlier.complete, replayed: true };
      }
      const found = await currentAcceptance(planId, revisionId, parsed.data.acceptanceId);
      if (!found.ok) return proposalFail("blueprint_invalid", found.message ? { message: found.message } : {});
      const loaded = await loadGenerationContext(db, context, planId, revisionId, { now: clock() });
      if (loaded.status === "not_found") return proposalFail("not_found");
      if (loaded.status === "not_open") return proposalFail("not_open");
      const gen = loaded.context;
      if (gen.revision.contentVersion !== parsed.data.baseContentVersion) return proposalFail("revision_changed", { contentVersion: gen.revision.contentVersion });
      // A version outside the default and the published opt-ins is refused here too, before anything is compiled.
      const rules = rulesetForNewGeneration(parsed.data.rulesVersion);
      if (!rules) return proposalFail("invalid", { message: "Versão de regras não disponível para novas gerações." });
      const compiled = await compileFor(planId, revisionId, found.acceptance, answers, structureFacts(gen.revision.schedule), new Set(gen.catalog.map((e) => e.id)), rules);
      if (!compiled.ok) return proposalFail(compiled.failure === "structure_changed" ? "structure_changed" : "blueprint_invalid", { message: compiled.message ?? ACCEPT_MESSAGE[compiled.failure] });
      const merged = convertBlueprintToGenerationAnswers(answers, compiled.compiled);
      // The newest-acceptance rule is checked again right before the hand-off, after the slow compile (a second accept in between supersedes this one).
      const stillCurrent = await currentAcceptance(planId, revisionId, parsed.data.acceptanceId);
      if (!stillCurrent.ok) return proposalFail("blueprint_invalid", stillCurrent.message ? { message: stillCurrent.message } : {});
      // A strategy whose every workout keeps a focus saved by the professional compiles to no block: the generation then runs as the plain one.
      return proposals().generate(
        planId,
        revisionId,
        { idempotencyKey: parsed.data.idempotencyKey, baseContentVersion: parsed.data.baseContentVersion, answers: parsed.data.answers, ...(parsed.data.rulesVersion ? { rulesVersion: parsed.data.rulesVersion } : {}) },
        merged.blueprint ? { blueprint: merged.blueprint } : undefined,
      );
    },

    /** "Voltar à estratégia": applies the (newest) acceptance to a phase, from a phase on, or to the whole open proposal. */
    async replan(planId: string, revisionId: string, payload: BlueprintReplanPayload): Promise<ProposalOutcome> {
      const parsed = replanSchema.safeParse(payload);
      if (!parsed.success) return proposalFail("invalid");
      const p = parsed.data;
      const found = await currentAcceptance(planId, revisionId, p.acceptanceId);
      if (!found.ok) return proposalFail("blueprint_invalid", found.message ? { message: found.message } : {});
      const head = await proposalsFor(db, context).header(planId, revisionId, p.proposalId, "ANY");
      if (!head) return proposalFail("not_found");
      if (head.state !== "OPEN") return proposalFail("closed");
      const loaded = await loadGenerationContext(db, context, planId, revisionId, { now: clock() });
      if (loaded.status === "not_found") return proposalFail("not_found");
      if (loaded.status === "not_open") return proposalFail("not_open");
      const gen = loaded.context;
      let answers: ReturnType<typeof parseGenerationAnswers>;
      try {
        answers = parseGenerationAnswers(head.parameters);
      } catch {
        return proposalFail("invalid", { message: "As respostas desta proposta não são mais aceitas pelas regras atuais. Descarte e gere de novo." });
      }
      const compiled = await compileFor(planId, revisionId, found.acceptance, answers, structureFacts(gen.revision.schedule), new Set(gen.catalog.map((e) => e.id)));
      if (!compiled.ok) return proposalFail(compiled.failure === "structure_changed" ? "structure_changed" : "blueprint_invalid", { message: compiled.message ?? ACCEPT_MESSAGE[compiled.failure] });
      const inScope = (phaseIndex: number) => (p.scope.kind === "FULL" ? true : p.scope.kind === "PHASE" ? phaseIndex === p.scope.phaseIndex : phaseIndex >= p.scope.phaseIndex);
      const block: BlueprintAnswers = { ...compiled.compiled.blueprint, workouts: compiled.compiled.blueprint.workouts.filter((w) => inScope(w.phaseIndex)) };
      if (!block.workouts.length) return proposalFail("invalid", { message: "A estratégia aceita não define o foco dos treinos das fases escolhidas." });
      const stillCurrent = await currentAcceptance(planId, revisionId, p.acceptanceId);
      if (!stillCurrent.ok) return proposalFail("blueprint_invalid", stillCurrent.message ? { message: stillCurrent.message } : {});
      const payloadOut: ReplanPayload = { proposalId: p.proposalId, idempotencyKey: p.idempotencyKey, writeId: p.writeId, expectedVersion: p.expectedVersion, scope: p.scope };
      return proposals().replan(planId, revisionId, payloadOut, { blueprint: block });
    },

    /**
     * What a "voltar à estratégia" would keep and what it would replace, per the stored proposal (read only): items the professional decided
     * (locked, preserved, substituted) stay; the engine's own picks in the scope are re-chosen.
     */
    async replanPreview(planId: string, revisionId: string, proposalId: string, scope: BlueprintReplanPayload["scope"]): Promise<ReplanPreview | null> {
      const snap = await proposalsFor(db, context).asEngineResult(planId, revisionId, proposalId);
      if (!snap || snap.header.state !== "OPEN") return null;
      const generated = snap.header.phasesGenerated;
      const phases = generated.filter((i) => (scope.kind === "FULL" ? true : scope.kind === "PHASE" ? i === scope.phaseIndex : i >= scope.phaseIndex)).sort((a, b) => a - b);
      let replaced = 0;
      let locked = 0;
      let substituted = 0;
      let preserved = 0;
      for (const o of snap.result.occurrences) {
        if (!phases.includes(o.phaseIndex)) continue;
        for (const item of o.items) {
          if (item.origin === "ENGINE") replaced += 1;
          else if (item.origin === "LOCKED") locked += 1;
          else if (item.origin === "SUBSTITUTED") substituted += 1;
          else preserved += 1;
        }
      }
      return { kept: locked + substituted + preserved, replaced, locked, substituted, preserved, phases };
    },
  };
}
