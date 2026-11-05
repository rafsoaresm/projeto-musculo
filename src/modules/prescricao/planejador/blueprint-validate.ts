/**
 * Binding validator (design V4 §2.4): the model's output is untrusted data. It is checked against the context it was asked
 * about (aliases only from the shortlist, phases and labels from the saved structure, enums, bounded counts, ineligible and
 * locked items unreachable, hidden-instruction text) and only then turned into a `TrainingBlueprint` with real labels and ids.
 *
 * Refusal policy: faults that are GLOBAL refuse the whole response (schema, size, ids, `global`, an invalid RECOMMENDED
 * strategy). A fault confined to an ALTERNATIVE strategy drops that strategy only and is reported in `dropped`. An invalid
 * recommended strategy is never replaced by promoting an alternative. Stored `problems` are codes + paths only (no echo of
 * model text beyond 60 characters). Pure; no network, database or clock.
 */
import { MUSCLE_CODES, PATTERN_CODES, STIMULUS_CODES, isNonVolumeRole, regionOfMuscle, SPLIT_DISPLAY_NAME, type Region, type SplitFamily, type WorkoutRole } from "./vocab";
import { proseProblems, type ProseContext } from "./text-guards";
import {
  BLUEPRINT_LABEL, plannerResponseSchema, type PlannerResponse, type PlannerStrategy, type StoredPhase, type StoredStrategy, type StoredWorkout, type TrainingBlueprint,
  type BlueprintProducer,
} from "./blueprint";
import type { PlanningCandidate, PlanningContextBundle, PlanningPhase, PlanningWorkout } from "./context-types";
import { DELTA_KEYS, deltaSize, expandFocus, isEmptyDelta, type FocusDelta } from "./focus";
import type { RoleFocusTable } from "./role-focus";
import {
  BLUEPRINT_VERSION, FOCUS_DELTA_MAX_ITEMS, PLANNER_MAX_CANDIDATES_PER_WORKOUT, PLANNER_MAX_RESPONSE_CHARS, ROLE_DRIFT_MIN_KEPT,
} from "./versions";

export interface ValidatorOptions {
  producer: BlueprintProducer;
  /** Name of the table the deltas are relative to ("interim-1" | "gymgital-base@2026.11.5"). */
  roleFocusRef: string;
}
export interface InfoNote {
  strategyId: string;
  code: "STRUCTURE_FOCUS_WINS";
  phaseIndex: number;
  label: string;
}
export type PlannerValidation =
  | { ok: true; blueprint: TrainingBlueprint; dropped: Array<{ strategyId: string; problems: string[] }>; info: InfoNote[] }
  | { ok: false; problems: string[] };

const MAX_PROBLEM = 60;
const problem = (code: string, path = ""): string => (path ? `${code}@${path}` : code).slice(0, MAX_PROBLEM);

/** The references a strategy may cite: fixed ids plus `F#` of the context's observations. */
export function allowedRefs(bundle: Pick<PlanningContextBundle, "context">): string[] {
  return [
    "S.experience", "S.goal", "S.age", "S.minutes", "S.days", "S.equipment", "P.parq", "H", "C", "L.digest",
    ...bundle.context.observations.map((o) => o.alias),
  ];
}

const FAMILY_ROLES: Record<SplitFamily, ReadonlySet<WorkoutRole> | null> = {
  FULL_BODY: new Set<WorkoutRole>(["FULL_BODY", "CORE", "CARDIO", "MOBILITY", "BALANCE", "SKILL"]),
  UPPER_LOWER: new Set<WorkoutRole>(["UPPER", "LOWER", "FULL_BODY", "CORE", "CARDIO", "MOBILITY", "BALANCE", "SKILL"]),
  PUSH_PULL_LEGS: new Set<WorkoutRole>(["PUSH", "PULL", "LEGS", "CORE", "CARDIO", "MOBILITY", "BALANCE", "SKILL"]),
  BODY_PART: new Set<WorkoutRole>(["CHEST_TRICEPS", "BACK_BICEPS", "SHOULDERS_ARMS", "LEGS", "LOWER", "CORE", "CARDIO", "MOBILITY", "BALANCE", "SKILL"]),
  CUSTOM: null,
};

/**
 * Whether the saved labels can carry a family (HEURISTIC, design §3.11; Técnico to validate). `volumeLabels` = labels with a volume role.
 * A family that is not supported is kept as an informational card that needs an edit of the saved periodization (never inside the blueprint).
 */
export function familySupportedBy(family: SplitFamily, volumeLabels: number): boolean {
  if (volumeLabels === 0) return true;
  switch (family) {
    case "FULL_BODY":
    case "CUSTOM":
      return true;
    case "UPPER_LOWER":
      return volumeLabels >= 2 && volumeLabels % 2 === 0;
    case "PUSH_PULL_LEGS":
      return volumeLabels === 3 || volumeLabels === 6;
    case "BODY_PART":
      return volumeLabels >= 4;
  }
}

const REGION_KEYS: Region[] = ["UPPER", "LOWER", "TRUNK"];
/** Regions a role's default focus covers; FULL_BODY and CUSTOM cover everything. */
function regionsOf(role: WorkoutRole, table: RoleFocusTable): Set<Region> {
  if (role === "FULL_BODY" || role === "CUSTOM") return new Set(REGION_KEYS);
  const f = table[role];
  return new Set([...f.dominantMuscles, ...f.supportingMuscles].map(regionOfMuscle));
}

/**
 * Whether a shortlisted exercise belongs in a workout of this role: a non-volume role takes only exercises of its own modality;
 * a volume role takes resistance exercises that train a muscle (primary or secondary) or a pattern of the expanded focus
 * (target or allowed spillover). FULL_BODY and CUSTOM without any listed focus accept any resistance exercise.
 */
function candidateFilter(role: WorkoutRole, delta: FocusDelta | null, table: RoleFocusTable): (c: PlanningCandidate) => boolean {
  if (isNonVolumeRole(role)) return (c) => c.modality === role;
  const f = expandFocus(role, delta, table);
  const muscles = new Set([...f.dominantMuscles, ...f.supportingMuscles]);
  const patterns = new Set([...f.targetPatterns, ...f.allowedSpilloverPatterns]);
  if (muscles.size === 0 && patterns.size === 0) return (c) => c.modality === null || c.modality === "RESISTANCE";
  return (c) =>
    (c.modality === null || c.modality === "RESISTANCE") &&
    (c.primaryMuscles.some((m) => muscles.has(m)) || c.secondaryMuscles.some((m) => muscles.has(m)) || c.patterns.some((x) => patterns.has(x)));
}

function checkWorkout(
  w: PlannerStrategy["phases"][number]["workouts"][number],
  ctxWorkout: PlanningWorkout,
  recommended: boolean,
  table: RoleFocusTable,
  where: string,
): string[] {
  const out: string[] = [];
  const role = w.role;
  const delta: FocusDelta | null = w.delta;
  const nonVolume = isNonVolumeRole(role);
  const mods = ctxWorkout.modalities;
  if (mods && !mods.includes("RESISTANCE") && !nonVolume) out.push(problem("VOLUME_ROLE_ON_NON_VOLUME_WORKOUT", where));
  if (mods && nonVolume && !mods.includes(role)) out.push(problem("ROLE_MODALITY_MISMATCH", where));
  if (!recommended && (delta !== null || w.candidateAliases.length > 0)) out.push(problem("ALTERNATIVE_CARRIES_DETAIL", where));
  if (nonVolume) {
    if (delta !== null && !isEmptyDelta(delta)) out.push(problem("DELTA_ON_NON_VOLUME_ROLE", where));
    return out;
  }
  if (delta === null) {
    if (role === "CUSTOM") out.push(problem("VOLUME_ROLE_WITHOUT_FOCUS", where));
    else if (table[role].dominantMuscles.length === 0 && table[role].targetPatterns.length === 0) out.push(problem("VOLUME_ROLE_WITHOUT_FOCUS", where));
    return out;
  }
  const base = table[role];
  const lists: Array<[keyof FocusDelta, readonly string[], "add" | "remove"]> = [
    ["addDominant", base.dominantMuscles, "add"], ["removeDominant", base.dominantMuscles, "remove"],
    ["addSupporting", base.supportingMuscles, "add"], ["removeSupporting", base.supportingMuscles, "remove"],
    ["addTargetPatterns", base.targetPatterns, "add"], ["removeTargetPatterns", base.targetPatterns, "remove"],
    ["addSpillover", base.allowedSpilloverPatterns, "add"], ["removeSpillover", base.allowedSpilloverPatterns, "remove"],
  ];
  if (deltaSize(delta) > FOCUS_DELTA_MAX_ITEMS) out.push(problem("DELTA_TOO_LARGE", where));
  for (const [key, defaults, kind] of lists) {
    const list = delta[key];
    if (new Set(list).size !== list.length) out.push(problem("DELTA_DUPLICATE", `${where}.${key}`));
    for (const code of list) {
      if (kind === "remove" && !defaults.includes(code)) out.push(problem("DELTA_REMOVE_NOT_IN_ROLE", `${where}.${key}`));
      if (kind === "add" && defaults.includes(code)) out.push(problem("DELTA_ADD_ALREADY_IN_ROLE", `${where}.${key}`));
    }
  }
  const regions = regionsOf(role, table);
  for (const m of [...delta.addDominant, ...delta.addSupporting])
    if (!regions.has(regionOfMuscle(m))) out.push(problem("DELTA_REGION_OUTSIDE_ROLE", `${where}.${m}`));
  if (role === "FULL_BODY" && delta.addDominant.length > 0) out.push(problem("FULL_BODY_DOMINANT", where));
  const focus = expandFocus(role, delta, table);
  if (focus.dominantMuscles.some((m) => focus.supportingMuscles.includes(m))) out.push(problem("DOMINANT_SUPPORTING_OVERLAP", where));
  const kept = (now: readonly string[], was: readonly string[]) => was.length === 0 || was.filter((c) => now.includes(c)).length / was.length >= ROLE_DRIFT_MIN_KEPT;
  if (!kept(focus.dominantMuscles, base.dominantMuscles) || !kept(focus.targetPatterns, base.targetPatterns)) out.push(problem("ROLE_DRIFT", where));
  if (focus.dominantMuscles.length === 0 && focus.targetPatterns.length === 0) out.push(problem("VOLUME_ROLE_WITHOUT_FOCUS", where));
  return out;
}

interface Expanded {
  stored: StoredStrategy;
  info: InfoNote[];
}

function validateStrategy(
  s: PlannerStrategy,
  recommended: boolean,
  bundle: PlanningContextBundle,
  table: RoleFocusTable,
  prose: ProseContext,
  refs: ReadonlySet<string>,
): { problems: string[]; expanded: Expanded | null } {
  const problems: string[] = [];
  const id = s.strategyId;
  const ctxPhases = new Map<number, PlanningPhase>(bundle.context.periodization.phases.map((p) => [p.index, p]));
  const labelOf = (alias: string) => bundle.aliases.workouts.get(alias as `T${number}`);

  // evidence + prose
  for (const r of s.evidenceRefs) if (!refs.has(r)) problems.push(problem("UNKNOWN_REF", `${id}.evidenceRefs`));
  if (new Set(s.evidenceRefs).size !== s.evidenceRefs.length) problems.push(problem("DUPLICATE_REF", `${id}.evidenceRefs`));
  for (const [path, t] of [["explanation", s.explanation], ...s.tradeoffs.map((x, i) => [`tradeoffs.${i}`, x] as const)])
    for (const code of proseProblems(t, prose)) problems.push(problem(`PROSE_${code}`, `${id}.${path}`));

  // phases cover every phase of the context exactly once
  const seen = new Set<number>();
  for (const p of s.phases) {
    if (seen.has(p.phase)) problems.push(problem("PHASE_DUPLICATE", `${id}.${p.phase}`));
    seen.add(p.phase);
    if (!ctxPhases.has(p.phase)) problems.push(problem("PHASE_EXTRA", `${id}.${p.phase}`));
  }
  for (const index of ctxPhases.keys()) if (!seen.has(index)) problems.push(problem("PHASE_MISSING", `${id}.${index}`));

  const ordered = [...s.phases].sort((a, b) => a.phase - b.phase);
  const done = new Map<number, StoredPhase>();
  const info: InfoNote[] = [];
  const usedAliasesPerPhase = new Map<number, Set<string>>();
  /** The model's own delta per `phase|label`, before a saved focus replaced it: a copied phase repeats what the model said, not what was stored. */
  const modelDeltas = new Map<string, FocusDelta | null>();
  for (const p of ordered) {
    const ctxPhase = ctxPhases.get(p.phase);
    if (!ctxPhase) continue;
    const where = `${id}.p${p.phase}`;
    if (s.splitFamily !== "CUSTOM" && p.splitType !== s.splitFamily) problems.push(problem("SPLIT_TYPE_MISMATCH", where));
    const ctxAliases = ctxPhase.workouts.map((w) => w.alias as string);
    let workouts = p.workouts;
    const copiedCandidates = new Map<string, string[]>();
    if (p.sameAsPhase !== null) {
      const from = done.get(p.sameAsPhase);
      const fromCtx = ctxPhases.get(p.sameAsPhase);
      if (p.sameAsPhase >= p.phase) problems.push(problem("SAME_AS_FORWARD", where));
      else if (!from || !fromCtx) problems.push(problem("SAME_AS_UNKNOWN", where));
      else {
        if (p.workouts.length > 0) problems.push(problem("SAME_AS_WITH_WORKOUTS", where));
        const a = [...ctxAliases].sort().join(","), b = fromCtx.workouts.map((w) => w.alias as string).sort().join(",");
        if (a !== b) problems.push(problem("SAME_AS_LABEL_SET", where));
        if (from.splitType !== p.splitType) problems.push(problem("SAME_AS_SPLIT_TYPE", where));
        // copy the earlier phase (its roles, deltas and candidates), keyed by label
        workouts = from.workouts.map((w) => {
          copiedCandidates.set(w.label, w.candidateExerciseIds);
          const alias = [...bundle.aliases.workouts].find(([, l]) => l === w.label)?.[0] ?? "";
          return { workout: alias, role: w.role, delta: modelDeltas.get(`${p.sameAsPhase}|${w.label}`) ?? w.focusDelta, candidateAliases: [] as string[] };
        });
      }
    } else {
      const given = p.workouts.map((w) => w.workout as string);
      if (new Set(given).size !== given.length) problems.push(problem("WORKOUT_DUPLICATE", where));
      for (const a of given) if (!ctxAliases.includes(a)) problems.push(problem("WORKOUT_NOT_IN_PHASE", `${where}.${a}`));
      for (const a of ctxAliases) if (!given.includes(a)) problems.push(problem("WORKOUT_MISSING", `${where}.${a}`));
    }
    const stored: StoredWorkout[] = [];
    const candidatesSeen = new Set<string>();
    for (const w of workouts) {
      const ctxWorkout = ctxPhase.workouts.find((c) => c.alias === w.workout);
      const label = labelOf(w.workout);
      if (!ctxWorkout || label === undefined) continue;
      const here = `${where}.${w.workout}`;
      // workouts copied from an earlier phase were checked there; only the label-set/role consistency with THIS phase's modalities is re-checked
      problems.push(...checkWorkout(w as PlannerStrategy["phases"][number]["workouts"][number], ctxWorkout, recommended, table, here));
      if (s.splitFamily !== "CUSTOM") {
        const allowed = FAMILY_ROLES[s.splitFamily];
        if (allowed && !allowed.has(w.role)) problems.push(problem("ROLE_NOT_IN_FAMILY", here));
      }
      modelDeltas.set(`${p.phase}|${label}`, w.delta && !isEmptyDelta(w.delta) ? w.delta : null);
      const ids: string[] = [];
      const fit = candidateFilter(w.role, w.delta, table);
      if (new Set(w.candidateAliases).size !== w.candidateAliases.length) problems.push(problem("CANDIDATE_DUPLICATE", here));
      if (w.candidateAliases.length > PLANNER_MAX_CANDIDATES_PER_WORKOUT) problems.push(problem("CANDIDATE_COUNT", here));
      for (const a of w.candidateAliases) {
        const real = bundle.aliases.exercises.get(a as `X${number}`);
        const candidate = bundle.context.library.candidates.find((c) => c.alias === a);
        if (real === undefined || candidate === undefined) problems.push(problem("CANDIDATE_NOT_IN_SHORTLIST", `${here}.${a}`));
        else if (!fit(candidate)) problems.push(problem("CANDIDATE_NOT_FIT_WORKOUT", `${here}.${a}`));
        else if (!candidatesSeen.has(`${w.workout}|${a}`)) { ids.push(real); candidatesSeen.add(`${w.workout}|${a}`); }
      }
      if (p.sameAsPhase !== null) ids.push(...(copiedCandidates.get(label) ?? []));
      const structureWins = ctxWorkout.existingFocus !== null && !isNonVolumeRole(w.role);
      if (structureWins) info.push({ strategyId: id, code: "STRUCTURE_FOCUS_WINS", phaseIndex: p.phase, label });
      stored.push({
        label,
        role: w.role,
        focusDelta: structureWins ? null : w.delta && !isEmptyDelta(w.delta) ? w.delta : null,
        candidateExerciseIds: ids,
        source: structureWins ? "STRUCTURE" : "AI_SUGGESTED",
      });
    }
    usedAliasesPerPhase.set(p.phase, new Set(workouts.map((w) => w.workout as string)));
    done.set(p.phase, { phaseIndex: p.phase, splitType: p.splitType, workouts: stored });
  }

  if (!recommended && (s.dosingIntent.length > 0 || s.progressionIntent.length > 0)) problems.push(problem("ALTERNATIVE_CARRIES_DETAIL", `${id}.intent`));
  if (new Set(s.dosingIntent.map((d) => d.exerciseClass)).size !== s.dosingIntent.length) problems.push(problem("DOSING_DUPLICATE_CLASS", id));
  const progPhases = s.progressionIntent.map((x) => x.phase);
  if (new Set(progPhases).size !== progPhases.length) problems.push(problem("PROGRESSION_DUPLICATE_PHASE", id));
  for (const x of progPhases) if (!ctxPhases.has(x)) problems.push(problem("PROGRESSION_PHASE_UNKNOWN", `${id}.${x}`));

  if (problems.length) return { problems, expanded: null };

  // Computed by the server (never trusted from the model): can the saved labels carry the family?
  const phases = [...done.values()].sort((a, b) => a.phaseIndex - b.phaseIndex);
  const supported = phases.map((ph) => familySupportedBy(s.splitFamily, ph.workouts.filter((w) => !isNonVolumeRole(w.role)).length));
  const supportedByContext = supported.every(Boolean) ? "YES" : supported.some(Boolean) ? "PARTIAL" : "NO";
  return {
    problems,
    expanded: {
      info,
      stored: {
        strategyId: s.strategyId,
        splitFamily: s.splitFamily,
        displayName: SPLIT_DISPLAY_NAME[s.splitFamily],
        explanation: s.explanation,
        tradeoffs: s.tradeoffs,
        requiresScheduleChange: supportedByContext !== "YES",
        supportedByContext,
        confidence: s.confidence,
        evidenceRefs: s.evidenceRefs,
        provenance: "AI_SUGGESTED",
        phases,
        dosingIntent: s.dosingIntent.map((d) => ({ exerciseClass: d.exerciseClass, profileCode: d.profileCode })),
        progressionIntent: s.progressionIntent.map((x) => ({ phaseIndex: x.phase, intent: x.intent })),
      },
    },
  };
}

export function validatePlannerResponse(raw: unknown, bundle: PlanningContextBundle, roleFocus: RoleFocusTable, options: ValidatorOptions): PlannerValidation {
  // 1. size and schema (strict: an unknown field is refused, never ignored)
  let size = 0;
  try { size = JSON.stringify(raw)?.length ?? 0; } catch { return { ok: false, problems: [problem("NOT_JSON")] }; }
  if (size > PLANNER_MAX_RESPONSE_CHARS) return { ok: false, problems: [problem("RESPONSE_TOO_LARGE")] };
  const parsed = plannerResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.slice(0, 20).map((i) => problem(`SCHEMA_${i.code}`, i.path.join("."))) };
  const response: PlannerResponse = parsed.data;

  // 2. ids
  const ids = response.strategies.map((s) => s.strategyId);
  if (new Set(ids).size !== ids.length) return { ok: false, problems: [problem("STRATEGY_ID_DUPLICATE")] };
  if (!ids.includes(response.recommendedStrategyId)) return { ok: false, problems: [problem("RECOMMENDED_MISSING")] };

  // global faults refuse the whole response
  const prose: ProseContext = {
    denyTokens: bundle.denyList.prose,
    aliases: new Set<string>([...bundle.aliases.exercises.keys(), ...bundle.aliases.workouts.keys(), ...bundle.context.observations.map((o) => o.alias)]),
  };
  const refs = new Set(allowedRefs(bundle));
  const globalProblems: string[] = [];
  const g = response.global;
  const stimuli = new Set<string>(STIMULUS_CODES);
  for (const c of g.goalCodes) if (!stimuli.has(c)) globalProblems.push(problem("GOAL_CODE_UNKNOWN", "global"));
  const globalTexts: Array<[string, string]> = [
    ["rationale", g.rationale],
    ...g.assumptions.map((t, i) => [`assumptions.${i}`, t] as [string, string]),
    ...g.uncertainties.map((u, i) => [`uncertainties.${i}`, u.text] as [string, string]),
    ...g.questionsForProfessional.map((q, i) => [`questions.${i}`, q.text] as [string, string]),
    ...g.keyTradeoffs.map((t, i) => [`tradeoffs.${i}`, t] as [string, string]),
  ];
  for (const [path, t] of globalTexts) for (const code of proseProblems(t, prose)) globalProblems.push(problem(`PROSE_${code}`, `global.${path}`));
  if (globalProblems.length) return { ok: false, problems: globalProblems };

  // 3. strategies
  const survivors: StoredStrategy[] = [];
  const dropped: Array<{ strategyId: string; problems: string[] }> = [];
  const info: InfoNote[] = [];
  for (const s of response.strategies) {
    const recommended = s.strategyId === response.recommendedStrategyId;
    const out = validateStrategy(s, recommended, bundle, roleFocus, prose, refs);
    if (out.expanded) { survivors.push(out.expanded.stored); info.push(...out.expanded.info); continue; }
    if (recommended) return { ok: false, problems: out.problems.slice(0, 20) };
    dropped.push({ strategyId: s.strategyId, problems: out.problems.slice(0, 20) });
  }

  const blueprint: TrainingBlueprint = {
    blueprintVersion: BLUEPRINT_VERSION,
    producer: options.producer,
    contextHash: bundle.contextHash,
    structureFingerprint: bundle.refs.structureFingerprint,
    aliasMapHash: bundle.aliases.aliasMapHash,
    roleFocusRef: options.roleFocusRef,
    global: {
      goalCodes: [...g.goalCodes],
      rationale: g.rationale,
      assumptions: g.assumptions,
      uncertainties: g.uncertainties,
      questionsForProfessional: g.questionsForProfessional,
      keyTradeoffs: g.keyTradeoffs,
    },
    recommendedStrategyId: response.recommendedStrategyId,
    strategies: survivors,
    label: BLUEPRINT_LABEL.AI,
  };
  return { ok: true, blueprint, dropped, info };
}

// Exported for tests that assert the vocabulary the schema enforces.
export const VALIDATOR_VOCABULARY = { muscles: MUSCLE_CODES, patterns: PATTERN_CODES, deltaKeys: DELTA_KEYS } as const;
