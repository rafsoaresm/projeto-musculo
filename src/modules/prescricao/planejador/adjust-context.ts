/**
 * The compact, anonymised context of an adjustment request, and the binding validator of the model's answer (design V4 §6.3, §6.4).
 * Pure: no `server-only`, database, network or clock.
 *
 * What the model sees: the focus phase of the CURRENT proposal version as codes (aliases X#/T#, muscles, patterns, equipment, small
 * integers) plus, for the one requested item, the engine-ranked eligible alternatives. No name, date, id, title or text of any kind
 * (exercise names are not sent in v1: D9's opt-in needs the library to say which exercises are the system's, and it does not yet).
 * The model's only job is to CHOOSE one of those alternatives; the engine then validates eligibility, recomputes and checks the
 * professional's constraints, so a wrong or hostile answer can never become a change.
 */
import { getRuleSet } from "@/modules/prescricao/motor/rules";
import { parseSlotKey } from "@/modules/prescricao/motor/select";
import type { CatalogExercise, EngineInput, EngineResult, Experience, ItemOut, OccurrenceOut } from "@/modules/prescricao/motor/types";
import { normalizeText } from "@/modules/prescricao/motor/vocabulary";
import { aliasMapHash } from "./hashes";
import {
  ADJUST_MAX_ALTERNATIVES, ADJUST_MAX_RESPONSE_CHARS, modelAdjustmentSchema, type AdjustConstraint, type AdjustIntent, type AdjustReasonCode, type Clarification, type ConstraintKind,
  type ModelAdjustment,
} from "./adjust";
import { MUSCLE_CODES, PATTERN_CODES, EQUIPMENT_CODES } from "./vocab";

export const ADJUST_CONTEXT_VERSION = 1 as const;
const MUSCLE_SET = new Set<string>(MUSCLE_CODES);
const PATTERN_SET = new Set<string>(PATTERN_CODES);
const EQUIPMENT_SET = new Set<string>(EQUIPMENT_CODES);
const keep = (values: readonly string[], allowed: ReadonlySet<string>) => values.filter((v) => allowed.has(v)).sort();

export interface AdjustContextItem {
  alias: `X${number}`;
  modality: string | null;
  primary: string[];
  secondary: string[];
  patterns: string[];
  sets: number | null;
  repsMin: number | null;
  repsMax: number | null;
  rirMin: number | null;
  rirMax: number | null;
  rest: number | null;
  locked: boolean;
  origin: ItemOut["origin"];
  /** Engine-ranked eligible alternatives: only the requested item has any. */
  alternatives: Array<`X${number}`>;
}
export interface AdjustContext {
  contextVersion: typeof ADJUST_CONTEXT_VERSION;
  experience: Experience | null;
  proposalVersion: number;
  request: {
    op: "SUBSTITUTE_EXERCISE";
    target: { phase: number; workout: `T${number}`; item: `X${number}` };
    scope: AdjustIntent["scope"];
    week: number | null;
    slot: number | null;
    constraints: AdjustConstraint[];
  };
  phases: Array<{ phase: number; workouts: Array<{ alias: `T${number}`; minutes: { min: number; max: number } | null; items: AdjustContextItem[] }> }>;
  weeklyVolume: Array<{ phase: number; week: number; muscle: string; weighted: number }>;
  library: Array<{ alias: `X${number}`; primary: string[]; secondary: string[]; patterns: string[]; equipment: string[]; compound: boolean | null; difficulty: number | null }>;
}
export interface AdjustAliases {
  exercises: Map<`X${number}`, string>;
  workouts: Map<`T${number}`, string>;
  aliasMapHash: string;
}
export interface AdjustContextBundle {
  context: AdjustContext;
  aliases: AdjustAliases;
  /** Aliases of the alternatives offered to the model (the only valid `replacement` values). */
  allowed: ReadonlyArray<`X${number}`>;
  targetAlias: `X${number}`;
  workoutAlias: `T${number}`;
}

/** Row cap of the weekly volume block (design: ≤ 40). */
const VOLUME_ROWS_MAX = 40;

export type AdjustContextOutcome = { ok: true; bundle: AdjustContextBundle } | { ok: false; code: "TARGET_NOT_FOUND" | "NOT_A_SUBSTITUTION" };

export async function buildAdjustContext(args: {
  input: Pick<EngineInput, "rules" | "student">;
  result: EngineResult;
  catalog: ReadonlyMap<string, CatalogExercise>;
  intent: AdjustIntent;
  /** Exercise ids of the alternatives to offer (already filtered and capped by the caller). */
  alternativeIds: readonly string[];
  proposalVersion: number;
}): Promise<AdjustContextOutcome> {
  const { intent, result, catalog } = args;
  if (intent.op !== "SUBSTITUTE_EXERCISE") return { ok: false, code: "NOT_A_SUBSTITUTION" };
  const parsed = parseSlotKey(intent.target.slotKey);
  if (!parsed || parsed.phaseIndex !== intent.target.phaseIndex) return { ok: false, code: "TARGET_NOT_FOUND" };
  const phaseOccs = result.occurrences.filter((o) => o.phaseIndex === intent.target.phaseIndex);
  const targetOcc = phaseOccs.find((o) => o.label === parsed.label && o.items.some((i) => i.slotKey === intent.target.slotKey) && (intent.target.week === undefined || o.week === intent.target.week));
  const targetItem = targetOcc?.items.find((i) => i.slotKey === intent.target.slotKey);
  if (!targetOcc || !targetItem?.exerciseId) return { ok: false, code: "TARGET_NOT_FOUND" };

  // Representative session of each workout of the phase: the one at the requested week when given, else the first.
  const representative = new Map<string, OccurrenceOut>();
  for (const o of [...phaseOccs].sort((a, b) => a.week - b.week || a.slot - b.slot)) {
    const have = representative.get(o.label);
    if (!have || (intent.target.week !== undefined && have.week !== intent.target.week && o.week === intent.target.week)) representative.set(o.label, o);
  }
  const labels = [...new Set(phaseOccs.map((o) => o.label))];
  const workouts = new Map<`T${number}`, string>(labels.map((label, i) => [`T${i + 1}` as `T${number}`, label]));
  const workoutAlias = [...workouts].find(([, label]) => label === parsed.label)?.[0] as `T${number}`;

  const ids = new Set<string>([targetItem.exerciseId, ...args.alternativeIds]);
  for (const o of representative.values()) for (const i of o.items) if (i.exerciseId) ids.add(i.exerciseId);
  const exercises = new Map<`X${number}`, string>([...ids].sort().map((id, i) => [`X${i + 1}` as `X${number}`, id]));
  const aliasOf = (id: string) => [...exercises].find(([, e]) => e === id)![0];

  const itemOf = (i: ItemOut, withAlternatives: boolean): AdjustContextItem => {
    const e = i.exerciseId ? catalog.get(i.exerciseId) : undefined;
    const dose = i.dose;
    const reps = dose?.metric === "REPS" ? dose.reps : null;
    const rir = dose?.metric === "REPS" && dose.intensity?.kind === "RIR" ? dose.intensity.range : null;
    return {
      alias: aliasOf(i.exerciseId as string),
      modality: e?.modality ?? null,
      primary: keep(e?.primaryMuscles ?? [], MUSCLE_SET),
      secondary: keep(e?.secondaryMuscles ?? [], MUSCLE_SET),
      patterns: keep(e?.patterns ?? [], PATTERN_SET),
      sets: dose && "sets" in dose ? dose.sets : null,
      repsMin: reps?.min ?? null,
      repsMax: reps?.max ?? null,
      rirMin: rir?.min ?? null,
      rirMax: rir?.max ?? null,
      rest: dose && "restSeconds" in dose ? dose.restSeconds : null,
      locked: i.origin === "LOCKED" || i.origin === "PRESERVED",
      origin: i.origin,
      alternatives: withAlternatives ? args.alternativeIds.map(aliasOf) : [],
    };
  };
  const phase = {
    phase: intent.target.phaseIndex,
    workouts: [...workouts].map(([alias, label]) => {
      const occ = representative.get(label) as OccurrenceOut;
      const minutes = phaseOccs.filter((o) => o.label === label && o.estimatedMinutes !== null).map((o) => o.estimatedMinutes as number);
      return {
        alias,
        minutes: minutes.length ? { min: Math.min(...minutes), max: Math.max(...minutes) } : null,
        items: occ.items.filter((i) => i.exerciseId).map((i) => itemOf(i, i.slotKey === intent.target.slotKey)),
      };
    }),
  };
  const targetMuscles = new Set([...(catalog.get(targetItem.exerciseId)?.primaryMuscles ?? []), ...(catalog.get(targetItem.exerciseId)?.secondaryMuscles ?? []), ...args.alternativeIds.flatMap((id) => catalog.get(id)?.primaryMuscles ?? [])]);
  const weeklyVolume = result.volume
    .filter((v) => v.phaseIndex === intent.target.phaseIndex && targetMuscles.has(v.muscle) && MUSCLE_SET.has(v.muscle))
    .slice(0, VOLUME_ROWS_MAX)
    .map((v) => ({ phase: v.phaseIndex, week: v.week, muscle: v.muscle, weighted: v.weightedSets }));
  const library = [targetItem.exerciseId, ...args.alternativeIds].map((id) => {
    const e = catalog.get(id) as CatalogExercise;
    return {
      alias: aliasOf(id), primary: keep(e.primaryMuscles, MUSCLE_SET), secondary: keep(e.secondaryMuscles, MUSCLE_SET), patterns: keep(e.patterns, PATTERN_SET),
      equipment: keep(e.equipment, EQUIPMENT_SET), compound: e.compound, difficulty: e.difficulty,
    };
  });
  const map = getRuleSet(args.input.rules)?.rules.EXPERIENCE_MAP.value as Record<string, Experience> | undefined;
  const level = args.input.student.level?.value;
  const experience = level && map ? (map[normalizeText(level)] ?? null) : null;
  const context: AdjustContext = {
    contextVersion: ADJUST_CONTEXT_VERSION,
    experience,
    proposalVersion: args.proposalVersion,
    request: {
      op: "SUBSTITUTE_EXERCISE",
      target: { phase: intent.target.phaseIndex, workout: workoutAlias, item: aliasOf(targetItem.exerciseId) },
      scope: intent.scope,
      week: intent.scope === "PHASE" ? null : intent.target.week ?? null,
      slot: intent.scope === "OCCURRENCE" ? intent.target.slot ?? null : null,
      constraints: intent.constraints,
    },
    phases: [phase],
    weeklyVolume,
    library,
  };
  const aliases: AdjustAliases = { exercises, workouts, aliasMapHash: await aliasMapHash({ exercises, workouts }) };
  return { ok: true, bundle: { context, aliases, allowed: args.alternativeIds.map(aliasOf), targetAlias: aliasOf(targetItem.exerciseId), workoutAlias } };
}

// ---------- the model's answer, bound to the context ----------

export type ModelAdjustmentCheck =
  | {
      ok: true;
      /** Real ids, in the order the model gave. Empty when the model asked for clarification. */
      replacements: string[];
      reasonCodes: AdjustReasonCode[];
      clarification: Clarification | null;
      constraintsEcho: ConstraintKind[];
    }
  | { ok: false; code: "TOO_LARGE" | "SCHEMA" | "TARGET_MISMATCH" | "REPLACEMENT_NOT_OFFERED" | "DUPLICATE" | "EMPTY" | "CLARIFICATION_WITH_OPERATIONS" };

/**
 * The model's output is untrusted data. It is accepted only if it parses, targets exactly what was asked (phase, workout alias, item alias,
 * scope, week, session) and names, as the replacement, an alias the context OFFERED for that item. Anything else refuses the whole answer.
 */
export function validateModelAdjustment(raw: unknown, bundle: AdjustContextBundle): ModelAdjustmentCheck {
  let size = 0;
  try {
    size = JSON.stringify(raw)?.length ?? 0;
  } catch {
    size = Number.MAX_SAFE_INTEGER;
  }
  if (size > ADJUST_MAX_RESPONSE_CHARS) return { ok: false, code: "TOO_LARGE" };
  const parsed = modelAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "SCHEMA" };
  const answer: ModelAdjustment = parsed.data;
  if (answer.clarification !== null && answer.operations.length > 0) return { ok: false, code: "CLARIFICATION_WITH_OPERATIONS" };
  if (answer.operations.length === 0 && answer.clarification === null) return { ok: false, code: "EMPTY" };
  const { request } = bundle.context;
  const seen = new Set<string>();
  const replacements: string[] = [];
  for (const op of answer.operations) {
    if (op.target.phase !== request.target.phase || op.target.workout !== request.target.workout || op.target.item !== request.target.item) return { ok: false, code: "TARGET_MISMATCH" };
    if (op.scope !== request.scope || op.week !== request.week || op.slot !== request.slot) return { ok: false, code: "TARGET_MISMATCH" };
    if (seen.has(op.replacement)) return { ok: false, code: "DUPLICATE" };
    seen.add(op.replacement);
    if (!bundle.allowed.includes(op.replacement as `X${number}`)) return { ok: false, code: "REPLACEMENT_NOT_OFFERED" };
    replacements.push(bundle.aliases.exercises.get(op.replacement as `X${number}`) as string);
  }
  // Two operations on the same requested target would be applied one over the other: v1 takes one replacement per request.
  if (replacements.length > 1) return { ok: false, code: "DUPLICATE" };
  return {
    ok: true,
    replacements,
    reasonCodes: [...new Set(answer.reasonCodes)],
    clarification: answer.clarification,
    constraintsEcho: [...new Set(answer.constraintsEcho)],
  };
}

export { ADJUST_MAX_ALTERNATIVES };
