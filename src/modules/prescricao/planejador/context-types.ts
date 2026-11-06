/**
 * `TrainingPlanningContext` v1 (design V4 §2.2): the ONLY student-derived object a planner request may be built from.
 * Everything in it is coded (enums, vocabulary codes, small integers, bands, aliases). There is deliberately no free-text
 * field: a new field must be added here, to the key whitelist in `tests/planning-context.test.ts` and to the minimisation table.
 * Pure types, no `server-only`.
 */
import type { Experience, FindingFact, Metric, ScreeningDecision } from "@/modules/prescricao/motor/types";
import type { RuleSetRef } from "@/modules/prescricao/motor/types";
import type { PLANNING_CONTEXT_VERSION } from "./versions";
import type { PROFILE_ORIGINS } from "./vocab";

export type Origin = (typeof PROFILE_ORIGINS)[number];
export type AgeBand = "18_29" | "30_39" | "40_49" | "50_59" | "60_PLUS";
/** NONE = 0, FEW = 1..9, MANY >= 10 (HEURISTIC constants in `context.ts`, to confirm). */
export type Band = "NONE" | "FEW" | "MANY";

export interface PlanningCandidate {
  alias: `X${number}`;
  modality: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  patterns: string[];
  difficulty: number | null;
  compound: boolean | null;
  laterality: "UNILATERAL" | "BILATERAL" | null;
  metric: Metric | null;
  /** PENDING never enters the pool. */
  metadata: "REVIEWED" | "INFERRED";
}

export interface PlanningWorkout {
  alias: `T${number}`;
  sessionsInPhase: number;
  perWeek: { min: number; max: number };
  modalities: string[] | null;
  exerciseTarget: number | "BY_TIME" | null;
  existingFocus: { muscles: string[]; patterns: string[] } | null;
  hasFixedItems: boolean;
}

export interface PlanningPhase {
  index: number;
  weeks: number;
  sessionsPerWeek: number;
  stimulus: string | null;
  /** ISO weekday numbers (1 = Monday) of the first full week when the structure has training days; no dates. */
  weekdays: number[] | null;
  /** Workout aliases of the first full week, in session order. */
  weekSequence: string[];
  workouts: PlanningWorkout[];
}

export interface TrainingPlanningContext {
  contextVersion: typeof PLANNING_CONTEXT_VERSION;
  student: {
    experience: Experience | null;
    goalCodes: string[];
    ageBand: AgeBand | null;
    sessionMinutes: number | null;
    daysPerWeek: number | null;
    equipment: { known: boolean; codes: string[] };
    origins: { experience: Origin; goal: Origin; sessionMinutes: Origin; daysPerWeek: Origin; equipment: Origin };
  };
  screening: { parq: "CLEAR" | "POSITIVE" | "NOT_DONE"; decision: ScreeningDecision | null };
  /** Coded: kind, code, grade and Flexiteste readings. No label text, reference, id or date. */
  observations: Array<{ alias: `F${number}`; kind: FindingFact["kind"]; code: string; grade: string | null; readings: Array<{ code: string; level: number }> }>;
  periodization: { phases: PlanningPhase[]; irregular: boolean };
  /** Bands, never counts: every logged workout would otherwise change the hash and cause a new paid call. */
  history: { windowDays: number; sessionsBand: Band; recordsBand: Band; painRecorded: boolean };
  constraints: { hasLocked: boolean; hasPreserved: boolean; excludedPatterns: string[]; excludedCautionTags: string[]; timeBudget: "SOFT" | "HARD" };
  library: {
    eligibleExercises: number;
    byPattern: Record<string, number>;
    byPrimaryMuscle: Record<string, number>;
    reviewedShare: "ALL" | "MOST" | "SOME" | "NONE";
    candidates: PlanningCandidate[];
  };
}

/** Server-only companion: never serialised to a provider. */
export interface PlanningServerRefs {
  organizationId: string;
  planId: string;
  revisionId: string;
  studentId: string;
  baseContentVersion: number;
  /** sha256 of the saved structure (phases, labels, occurrences, planned dates). A different structure is a different context. */
  structureFingerprint: string;
  /** `GenerationContext.catalogHash`. */
  catalogHash: string;
  rules: RuleSetRef;
}

export interface AliasTables {
  exercises: Map<`X${number}`, string>;
  /** Alias -> real label. */
  workouts: Map<`T${number}`, string>;
  findings: Map<`F${number}`, { kind: string; code: string }>;
  /** sha256 of the sorted "alias=id" lines (exercises) + "alias=label" (workouts). */
  aliasMapHash: string;
}

export type OmittedReason = "NOT_NEEDED" | "FREE_TEXT" | "DIRECT_IDENTIFIER" | "HEALTH_DETAIL" | "UNKNOWN_VALUE" | "CAPPED" | "DEFERRED";
export interface OmittedRecord {
  field: string;
  reason: OmittedReason;
  detail?: string;
}

/**
 * Values that identify a person or an organization record (or text a person typed). They never leave the server; the privacy
 * scanner (PR 1.2) searches the final provider payload for them and fails closed. `values` are matched as normalised phrases
 * or substrings, `tokens` as whole words.
 */
export interface DenyList {
  values: string[];
  tokens: string[];
  /**
   * Only for the model's PROSE (validator): real identifiers (names, e-mail, phone digits, birth date, ids, plan title as a phrase).
   * Never goal, level, phase/workout names, exercise names or free-text profile values: ordinary words must not refuse an answer.
   * Normalised (`normalizeText`, non-alphanumerics collapsed to one space); digit-only entries are compared against the digits of the text.
   */
  prose: string[];
}

export interface PlanningContextBundle {
  context: TrainingPlanningContext;
  refs: PlanningServerRefs;
  aliases: AliasTables;
  omitted: OmittedRecord[];
  denyList: DenyList;
  /** Known age < 18: the gate blocks AI mode (D1). */
  minor: boolean;
  /** sha256(canonicalJson(context)): the exact object a provider payload is built from. */
  contextHash: string;
}
