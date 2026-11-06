/**
 * Training Blueprint v1 (design V4 §2.3, §2.5, §2.6): the wire response a planner model must return, the stored blueprint, and
 * the professional's acceptance. Pure zod/types, no `server-only`, database, network or clock.
 *
 * The model returns a ROLE per workout plus DELTAS against the pinned role table; the server expands defaults, `sameAsPhase`
 * repetitions and candidate aliases (`blueprint-validate.ts`). Nothing the engine does not consume is requested. All objects are
 * strict, every array and string is bounded, and there is no union/oneOf in the wire schema. Free text exists only where
 * `text()` is used; it is plain text, checked by `proseProblems`, and rendered as React text.
 *
 * Provenance: a model-produced strategy is `AI_SUGGESTED`; it is never `EVIDENCE`, `STUDENT_DATA` or `PROFESSIONAL`.
 */
import { z } from "zod";
import { focusDeltaSchema, type FocusDelta } from "./focus";
import { BLUEPRINT_VERSION, PLANNER_MAX_CANDIDATES_PER_WORKOUT, PLANNER_MAX_PHASES, PLANNER_MAX_WORKOUTS_PER_PHASE } from "./versions";
import {
  DOSE_PROFILE_CODES, EXERCISE_CLASSES, PROGRESSION_INTENTS, QUESTION_CODES, SPLIT_FAMILIES, UNCERTAINTY_CODES, WORKOUT_ROLES,
  type FocusSource, type SplitFamily, type WorkoutRole,
} from "./vocab";

export { focusDeltaSchema, type FocusDelta };

export const text = (max: number) => z.string().trim().min(1).max(max);
const aliasT = z.string().regex(/^T[1-9][0-9]{0,2}$/);
const aliasX = z.string().regex(/^X[1-9][0-9]{0,2}$/);
/** Context references a strategy may cite as evidence. */
export const refId = z.string().regex(/^(S\.(experience|goal|age|minutes|days|equipment)|P\.parq|H|C|L\.digest|F[1-9][0-9]{0,2})$/);
const strategyIdSchema = z.enum(["S1", "S2", "S3"]);
const phaseNo = z.number().int().min(1).max(PLANNER_MAX_PHASES);

const workoutPlan = z.strictObject({
  workout: aliasT,
  role: z.enum(WORKOUT_ROLES),
  /** null = the defaults of the role; alternatives (S2/S3) must send null. */
  delta: focusDeltaSchema.nullable(),
  /** Recommended strategy only; [] elsewhere. */
  candidateAliases: z.array(aliasX).max(PLANNER_MAX_CANDIDATES_PER_WORKOUT),
});
const phasePlan = z.strictObject({
  phase: phaseNo,
  splitType: z.enum(SPLIT_FAMILIES),
  /** Non-null => `workouts` must be [] and the server copies that EARLIER phase (same label set required). */
  sameAsPhase: phaseNo.nullable(),
  workouts: z.array(workoutPlan).max(PLANNER_MAX_WORKOUTS_PER_PHASE),
});
const strategy = z.strictObject({
  strategyId: strategyIdSchema,
  splitFamily: z.enum(SPLIT_FAMILIES),
  explanation: text(300),
  tradeoffs: z.array(text(160)).max(2),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidenceRefs: z.array(refId).max(6),
  phases: z.array(phasePlan).min(1).max(PLANNER_MAX_PHASES),
  /** Recommended only; codes, no prose. */
  dosingIntent: z.array(z.strictObject({ exerciseClass: z.enum(EXERCISE_CLASSES), profileCode: z.enum(DOSE_PROFILE_CODES) })).max(EXERCISE_CLASSES.length),
  /** Recommended only. */
  progressionIntent: z.array(z.strictObject({ phase: phaseNo, intent: z.enum(PROGRESSION_INTENTS) })).max(PLANNER_MAX_PHASES),
});

export const plannerResponseSchema = z.strictObject({
  schemaVersion: z.literal(BLUEPRINT_VERSION),
  global: z.strictObject({
    goalCodes: z.array(z.string().regex(/^[A-Z_]{3,30}$/)).max(3),
    rationale: text(300),
    assumptions: z.array(text(160)).max(4),
    uncertainties: z.array(z.strictObject({ code: z.enum(UNCERTAINTY_CODES), text: text(160) })).max(4),
    questionsForProfessional: z.array(z.strictObject({ code: z.enum(QUESTION_CODES), text: text(160) })).max(3),
    keyTradeoffs: z.array(text(160)).max(2),
  }),
  recommendedStrategyId: strategyIdSchema,
  strategies: z.array(strategy).min(1).max(3),
});
export type PlannerResponse = z.infer<typeof plannerResponseSchema>;
export type PlannerStrategy = PlannerResponse["strategies"][number];

// ---------- stored blueprint ----------

export type BlueprintProducer =
  | { kind: "AI"; provider: "openai" | "anthropic" | "google" | "mock"; modelId: string; promptVersion: string }
  | { kind: "RULES"; templatesVersion: string };

export interface StoredWorkout {
  /** The real label, restored on the server. */
  label: string;
  role: WorkoutRole;
  /** Role + delta; the expanded lists are derived by `expandFocus(role, delta, table)` against `roleFocusRef`. */
  focusDelta: FocusDelta | null;
  /** At most 6 real library ids, resolved from aliases (recommended strategy only). */
  candidateExerciseIds: string[];
  /** STRUCTURE = the saved focus of the periodization wins (design §2.4.7). */
  source: FocusSource | "STRUCTURE";
}
export interface StoredPhase {
  phaseIndex: number;
  splitType: SplitFamily;
  workouts: StoredWorkout[];
}
export interface StoredStrategy {
  strategyId: "S1" | "S2" | "S3";
  splitFamily: SplitFamily;
  /** From the fixed pt-BR table, never model text. */
  displayName: string;
  explanation: string;
  tradeoffs: string[];
  /** Computed by the server, never trusted from a model. */
  requiresScheduleChange: boolean;
  supportedByContext: "YES" | "PARTIAL" | "NO";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidenceRefs: string[];
  provenance: "AI_SUGGESTED" | "RULES_HEURISTIC";
  phases: StoredPhase[];
  dosingIntent: Array<{ exerciseClass: string; profileCode: string }>;
  progressionIntent: Array<{ phaseIndex: number; intent: string }>;
}
export interface TrainingBlueprint {
  blueprintVersion: typeof BLUEPRINT_VERSION;
  producer: BlueprintProducer;
  contextHash: string;
  structureFingerprint: string;
  aliasMapHash: string;
  /** The table the deltas are relative to: "interim-1" | "gymgital-base@2026.11.5". */
  roleFocusRef: string;
  global: {
    goalCodes: string[];
    rationale: string | null;
    assumptions: string[];
    uncertainties: Array<{ code: string; text: string }>;
    questionsForProfessional: Array<{ code: string; text: string }>;
    keyTradeoffs: string[];
  };
  recommendedStrategyId: "S1" | "S2" | "S3";
  strategies: StoredStrategy[];
  /** Rules producer: "Heurística operacional (editável)"; AI: "Sugestão da IA". Never presents rules as AI. */
  label: string;
}

export const BLUEPRINT_LABEL = { AI: "Sugestão da IA", RULES: "Heurística operacional (editável)" } as const;

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const storedWorkout = z.strictObject({
  label: z.string().min(1).max(20),
  role: z.enum(WORKOUT_ROLES),
  focusDelta: focusDeltaSchema.nullable(),
  candidateExerciseIds: z.array(z.string().min(1).max(80)).max(PLANNER_MAX_CANDIDATES_PER_WORKOUT),
  source: z.enum(["AI_SUGGESTED", "RULES_HEURISTIC", "PROFESSIONAL", "STRUCTURE"]),
});
const storedStrategy = z.strictObject({
  strategyId: strategyIdSchema,
  splitFamily: z.enum(SPLIT_FAMILIES),
  displayName: text(60),
  explanation: z.string().max(300),
  tradeoffs: z.array(z.string().max(160)).max(2),
  requiresScheduleChange: z.boolean(),
  supportedByContext: z.enum(["YES", "PARTIAL", "NO"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidenceRefs: z.array(refId).max(6),
  provenance: z.enum(["AI_SUGGESTED", "RULES_HEURISTIC"]),
  phases: z.array(z.strictObject({ phaseIndex: phaseNo, splitType: z.enum(SPLIT_FAMILIES), workouts: z.array(storedWorkout).max(PLANNER_MAX_WORKOUTS_PER_PHASE) })).min(1).max(PLANNER_MAX_PHASES),
  dosingIntent: z.array(z.strictObject({ exerciseClass: z.enum(EXERCISE_CLASSES), profileCode: z.enum(DOSE_PROFILE_CODES) })).max(EXERCISE_CLASSES.length),
  progressionIntent: z.array(z.strictObject({ phaseIndex: phaseNo, intent: z.enum(PROGRESSION_INTENTS) })).max(PLANNER_MAX_PHASES),
});
/** Strict reader for a stored blueprint (what `planning_run_payloads.blueprint_json` holds): refuses anything this version does not define. */
export const trainingBlueprintSchema = z.strictObject({
  blueprintVersion: z.literal(BLUEPRINT_VERSION),
  producer: z.union([
    z.strictObject({ kind: z.literal("AI"), provider: z.enum(["openai", "anthropic", "google", "mock"]), modelId: z.string().min(1).max(100), promptVersion: z.string().min(1).max(40) }),
    z.strictObject({ kind: z.literal("RULES"), templatesVersion: z.string().min(1).max(40) }),
  ]),
  contextHash: sha,
  structureFingerprint: sha,
  aliasMapHash: sha,
  roleFocusRef: z.string().min(1).max(60),
  global: z.strictObject({
    goalCodes: z.array(z.string().regex(/^[A-Z_]{3,30}$/)).max(3),
    rationale: z.string().max(300).nullable(),
    assumptions: z.array(z.string().max(160)).max(4),
    uncertainties: z.array(z.strictObject({ code: z.enum(UNCERTAINTY_CODES), text: z.string().max(160) })).max(4),
    questionsForProfessional: z.array(z.strictObject({ code: z.enum(QUESTION_CODES), text: z.string().max(160) })).max(3),
    keyTradeoffs: z.array(z.string().max(160)).max(2),
  }),
  recommendedStrategyId: strategyIdSchema,
  strategies: z.array(storedStrategy).min(1).max(3),
  label: z.enum([BLUEPRINT_LABEL.AI, BLUEPRINT_LABEL.RULES]),
});

// ---------- acceptance (append-only row, PR 2 persists it) ----------

export interface BlueprintAcceptance {
  id: string;
  runId: string;
  /** CUSTOM = the "Personalizar" card: every workout is source PROFESSIONAL. */
  strategyId: "S1" | "S2" | "S3" | "CUSTOM";
  splitFamily: SplitFamily;
  /** The FINAL focus after the professional's edits, as role + delta. */
  phases: Array<{ phaseIndex: number; splitType: SplitFamily; workouts: Array<{ label: string; role: WorkoutRole; focusDelta: FocusDelta | null; candidateExerciseIds: string[]; source: FocusSource }> }>;
  edits: Array<{ phaseIndex: number; label: string; field: "role" | "dominantMuscles" | "supportingMuscles" | "targetPatterns" | "allowedSpilloverPatterns" }>;
  /** Only what the professional ticked; both empty by default = switched off. */
  dosing: { byClass: Array<{ exerciseClass: string; profileCode: string }>; progression: Array<{ phaseIndex: number; intent: string }> };
  structureFingerprint: string;
  baseContentVersion: number;
  acceptanceHash: string;
  acceptedByUserId: string;
  acceptedAt: string;
}

/** Where each field of the contracts may come from; a model never claims more than `AI_SUGGESTED`. */
export const FIELD_PROVENANCE = {
  strategy: "AI_SUGGESTED",
  focus: "AI_SUGGESTED",
  candidates: "AI_SUGGESTED",
  dosingIntent: "AI_SUGGESTED",
  progressionIntent: "AI_SUGGESTED",
  evidenceRefs: "AI_SUGGESTED",
} as const;
