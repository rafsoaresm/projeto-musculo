/**
 * What the professional answers when generating an automatic prescription (motor S5, design §2.3), and the shapes the input
 * adapter returns. Pure: no database, no screen. Server actions parse the answers with `parseGenerationAnswers` (strict: an
 * unknown field is refused, never ignored).
 *
 * The answers carry only what the student's records and the saved periodization do not: the stimulus of each phase, the
 * equipment available, how many exercises a workout without a target gets, exclusions, coverage, weekly progressions and dose
 * adjustments. Whatever is still missing becomes a `GenerationQuestion` asked on the generation screen; nothing is filled in by
 * a guess. Two answers have a default decided by the tool on 04/11/2026 (docs/PENDENCIAS.md R14, Q1 and Q3), and when the
 * default is used the adapter says so in the assumptions: `doseMode` (fill from the editable policy) and `metadataTrust`
 * (reviewed and inferred metadata). `timeBudget` defaults to SOFT (estimate shown next to the time available, nothing cut).
 */
import { z } from "zod";
import { CAUTION_TAGS, EQUIPMENT, MODALITIES, PATTERNS, MUSCLES } from "@/modules/biblioteca/metadata/vocabulary";
import type { Assumption, EngineInput, Issue, Suggestion } from "@/modules/prescricao/motor/types";

/**
 * Technical cap on each list in the answers: it bounds the body of one server action. A real list (exercises preferred or
 * excluded, decisions on flags) is far below it; it is not a training rule.
 */
export const MAX_ANSWER_LIST = 500;
/** Phase indexes follow the structure's technical cap (12, design §3 Q4). */
const phaseIndex = z.number().int().min(1).max(12);
const label = z.string().trim().min(1).max(20);
const exerciseId = z.string().trim().min(1).max(80);
/** A stimulus is any objective the professional names ("qualquer objetivo"): a code like HYPERTROPHY or a free word, normalised by the engine. */
const stimulusCode = z.string().trim().min(1).max(60);
const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(MAX_ANSWER_LIST);
const unique = <T,>(values: T[]) => new Set(values.map((v) => JSON.stringify(v))).size === values.length;
const codeOf = (map: Record<string, string>, what: string) =>
  z.string().refine((code) => Object.hasOwn(map, code), { message: `${what} desconhecido.` });
const finite = z.number().finite();
const nonNegative = finite.min(0);
const range = z.object({ min: nonNegative, max: nonNegative }).strict();

const intensity = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("RIR"), range }).strict(),
  z.object({ kind: z.literal("RPE"), range }).strict(),
  z.object({ kind: z.literal("PERCENT_1RM"), range }).strict(),
  z
    .object({
      kind: z.literal("ZONE"),
      systemLabel: z.string().trim().min(1).max(60),
      zone: z.string().trim().min(1).max(40),
      bounds: z.object({ unit: z.enum(["BPM", "PACE_S_PER_KM", "WATTS", "RPE"]), range }).strict().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("PACE"), secondsPerKm: range }).strict(),
  z.object({ kind: z.literal("TEXT"), text: z.string().trim().min(1).max(120) }).strict(),
]);
const method = z
  .object({
    kind: z.enum(["STRAIGHT", "SUPERSET", "CIRCUIT", "DROP_SET", "REST_PAUSE", "CLUSTER", "EMOM", "AMRAP", "CUSTOM"]),
    groupKey: z.string().trim().min(1).max(20).optional(),
    text: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const DOSE_PARAMS = [
  "sets", "repsMin", "repsMax", "durationMin", "durationMax", "distanceMin", "distanceMax", "restSeconds", "rirMin", "rirMax",
  "rpeMin", "rpeMax", "blocks", "repeats", "workDurationMin", "workDurationMax", "workDistanceMin", "workDistanceMax",
  "recoveryMin", "recoveryMax", "restBetweenBlocks",
] as const;
const doseParam = z.enum(DOSE_PARAMS);
const metric = z.enum(["REPS", "TIME", "DISTANCE", "INTERVALS", "CONTINUOUS"]);
export const dosePatchSchema = z
  .object({
    values: z.partialRecord(doseParam, nonNegative).optional(),
    intensity: intensity.optional(),
    tempo: z.string().trim().min(1).max(20).optional(),
    method: method.optional(),
    loadBasis: z.enum(["TOTAL", "PER_HAND", "PER_SIDE", "MACHINE_STACK", "BODYWEIGHT", "ASSISTANCE", "NONE"]).optional(),
    loadInstruction: z.string().trim().min(1).max(200).optional(),
    recoveryMode: z.enum(["PASSIVE", "ACTIVE"]).optional(),
  })
  .strict();

/** Weekly progression of a phase (engine `WeeklyProgression`); the engine checks its meaning (ramps with both ends, blocks adding up). */
export const weeklyProgressionSchema = z
  .object({
    model: z.enum(["NONE", "LINEAR", "STEP", "SEQUENCE", "BLOCK", "CUSTOM"]),
    ramps: z.array(z.object({ param: doseParam, from: finite, to: finite, metric: metric.optional() }).strict()).max(DOSE_PARAMS.length * 5).optional(),
    steps: z
      .array(z.object({ param: doseParam, delta: finite, everyWeeks: z.number().int().min(1), limit: finite.optional(), metric: metric.optional() }).strict())
      .max(DOSE_PARAMS.length * 5)
      .optional(),
    sequence: z.object({ per: z.enum(["WEEK", "OCCURRENCE_IN_WEEK"]), stimuli: z.array(stimulusCode).min(1).max(52) }).strict().optional(),
    blocks: z.array(z.object({ weeks: z.number().int().min(1), stimulus: stimulusCode }).strict()).min(1).max(52).optional(),
    weekOverrides: z.array(z.object({ week: z.number().int().min(1), patch: dosePatchSchema }).strict()).max(52).optional(),
    deload: z
      .object({ weeks: z.array(z.number().int().min(1)).min(1).max(52), setsMultiplier: nonNegative.max(1), patch: dosePatchSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();

const flagDecision = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("EXCLUDE_PATTERN"), pattern: codeOf(PATTERNS, "Padrão") }).strict(),
  z.object({ kind: z.literal("EXCLUDE_CAUTION_TAG"), tag: codeOf(CAUTION_TAGS, "Marcador") }).strict(),
  z.object({ kind: z.literal("EXCLUDE_EXERCISE"), exerciseId }).strict(),
  z.object({ kind: z.literal("ACKNOWLEDGE") }).strict(),
]);

export const generationAnswersSchema = z
  .object({
    /** The stimulus of each phase: typed or chosen by the professional, or a suggestion chip they clicked (HEURISTIC_ACCEPTED, with its rule). */
    stimulusByPhase: list(
      z
        .object({ phaseIndex, value: stimulusCode, basis: z.enum(["PROFESSIONAL", "HEURISTIC_ACCEPTED"]), ruleId: z.string().max(60).optional() })
        .strict()
        .refine((s) => s.basis !== "HEURISTIC_ACCEPTED" || Boolean(s.ruleId), { message: "Uma sugestão aceita cita a sua regra." }),
    )
      .refine((items) => unique(items.map((s) => s.phaseIndex)), { message: "Um estímulo por fase." })
      .default([]),
    /** Array-shaped, never "fase|rótulo" keys: a free label can hold any visible character. */
    modalitiesByWorkout: list(
      z.object({ phaseIndex, label, modalities: z.array(codeOf(MODALITIES, "Modalidade")).min(1).max(Object.keys(MODALITIES).length) }).strict(),
    )
      .refine((items) => unique(items.map((m) => [m.phaseIndex, m.label])), { message: "Uma escolha de modalidades por treino." })
      .default([]),
    /** The equipment available; "NONE" = no equipment at all. Absent = still to be answered (never read from the profile's free text). */
    equipmentCodes: z.union([z.literal("NONE"), z.array(codeOf(EQUIPMENT, "Equipamento")).min(1).max(Object.keys(EQUIPMENT).length)]).optional(),
    /** Minutes per session for the whole plan; a workout's own minutes in the structure win. */
    availableMinutes: z.number().int().min(1).max(600).optional(),
    timeBudget: z.enum(["SOFT", "HARD"]).optional(),
    exerciseCountByWorkout: list(z.object({ phaseIndex, label, count: z.union([z.number().int().min(1).max(30), z.literal("BY_TIME")]) }).strict())
      .refine((items) => unique(items.map((c) => [c.phaseIndex, c.label])), { message: "Uma quantidade por treino." })
      .default([]),
    preferredExerciseIds: list(exerciseId).default([]),
    excludedExerciseIds: list(exerciseId).default([]),
    excludedPatterns: list(codeOf(PATTERNS, "Padrão")).default([]),
    excludedCautionTags: list(codeOf(CAUTION_TAGS, "Marcador")).default([]),
    phaseCoverage: list(
      z
        .object({
          phaseIndex,
          muscles: z.array(codeOf(MUSCLES, "Músculo")).max(Object.keys(MUSCLES).length).optional(),
          patterns: z.array(codeOf(PATTERNS, "Padrão")).max(Object.keys(PATTERNS).length).optional(),
          basis: z.enum(["PROFESSIONAL", "HEURISTIC_ACCEPTED"]),
          ruleId: z.string().max(60).optional(),
        })
        .strict()
        .refine((c) => c.basis !== "HEURISTIC_ACCEPTED" || Boolean(c.ruleId), { message: "Uma sugestão aceita cita a sua regra." }),
    )
      .refine((items) => unique(items.map((c) => c.phaseIndex)), { message: "Uma cobertura por fase." })
      .default([]),
    progressionByPhase: list(z.object({ phaseIndex, progression: weeklyProgressionSchema }).strict())
      .refine((items) => unique(items.map((p) => p.phaseIndex)), { message: "Uma progressão por fase." })
      .default([]),
    doseMode: z.enum(["FILL_FROM_POLICY", "LEAVE_EMPTY"]).optional(),
    /** Adjustments to the dose policy table shown before generating (engine `DoseOverride`). */
    policyOverrides: list(
      z
        .object({
          stimulus: stimulusCode.optional(),
          modality: codeOf(MODALITIES, "Modalidade").optional(),
          metric: metric.optional(),
          phaseIndex: phaseIndex.optional(),
          label: label.optional(),
          exerciseId: exerciseId.optional(),
          patch: dosePatchSchema,
        })
        .strict(),
    ).default([]),
    metricOverrides: list(z.object({ exerciseId, metric }).strict())
      .refine((items) => unique(items.map((m) => m.exerciseId)), { message: "Uma medida por exercício." })
      .default([]),
    metadataTrust: z.enum(["REVIEWED_ONLY", "REVIEWED_AND_INFERRED"]).optional(),
    acceptedFlagDecisions: list(z.object({ flagCode: z.string().trim().min(1).max(200), decision: flagDecision }).strict())
      .refine((items) => unique(items.map((d) => d.flagCode)), { message: "Uma decisão por alerta." })
      .default([]),
  })
  .strict();

export type GenerationAnswers = z.output<typeof generationAnswersSchema>;
export type GenerationAnswersInput = z.input<typeof generationAnswersSchema>;

/** Strict parse: throws `ZodError` on anything the schema does not take (unknown field, unknown code, number out of range). */
export function parseGenerationAnswers(raw: unknown): GenerationAnswers {
  return generationAnswersSchema.parse(raw ?? {});
}

/** Where the professional fixes a missing fact: here, on the generation screen, or in the student's records. */
export type QuestionWhere = "GENERATION" | "PROFILE" | "ASSESSMENT" | "STRUCTURE";

/**
 * Something the adapter could not find in the real data. `required` blocks the "Gerar" button until answered; the others are
 * shown with what the engine will do without them (the matching assumption). Nothing is ever filled in by a guess.
 */
export interface GenerationQuestion {
  code:
    | "STIMULUS"
    | "EQUIPMENT"
    | "EXERCISE_COUNT"
    | "MODALITIES"
    | "AVAILABLE_MINUTES"
    | "PROFILE_LEVEL"
    | "PROFILE_GOAL"
    | "PROFILE_MISSING"
    | "ASSESSMENT_MISSING"
    | "SCREENING_DECISION";
  required: boolean;
  where: QuestionWhere;
  message: string;
  phaseIndex?: number;
  label?: string;
  /** Buttons, nothing pre-selected; a click records HEURISTIC_ACCEPTED with the rule. */
  suggestions?: Suggestion[];
  /** Free text from the student's records shown next to the question (equipment, preferences); never parsed. */
  context?: string;
}

/**
 * References to what a generation read, for the append-only ledger (design §2): ids, dates and counts only. Health free text,
 * names and values never go here; the full input lives in the deletable `prescription_generation_inputs` (S6).
 */
export interface GenerationFactRefs {
  plan: { id: string; studentId: string };
  revision: { id: string; contentVersion: number; prescriptionModel: string; structureVersion: 1 | 2 };
  profile: { updatedAt: string } | null;
  assessment: { id: string; assessedOn: string; recordedAt: string | null; formatVersion: number | null } | null;
  /** `hash`: SHA-256 of the catalog and its resolved metadata as read; the counts alone cannot show a reviewed field. */
  catalog: { hash: string; exercises: number; reviewed: number; inferred: number; pending: number };
  history: { since: string; until: string; sinceDays: number; sessions: number; truncated: boolean; logs: number };
  existing: { rows: number };
  asOf: string;
}

export type BuildOutcome =
  | {
      ok: true;
      input: EngineInput;
      questions: GenerationQuestion[];
      /** True when no required question is open: the engine can run. */
      ready: boolean;
      /** What the adapter assumed (beyond the engine's own), shown with "Premissas usadas". */
      assumptions: Assumption[];
      /** Facts found in the records that deserve a look before generating (never blocking). */
      issues: Issue[];
      facts: GenerationFactRefs;
    }
  | { ok: false; code: "UNKNOWN_EXERCISE"; exerciseIds: string[] }
  | { ok: false; code: "UNKNOWN_TARGET"; targets: Array<{ phaseIndex: number; label?: string }> }
  /**
   * An answer marked HEURISTIC_ACCEPTED that no rule of this rule set suggested: a value the professional chose is PROFESSIONAL,
   * and the justification must never pass it off as an accepted heuristic.
   */
  | { ok: false; code: "UNSUPPORTED_SUGGESTION"; targets: Array<{ field: "stimulusByPhase" | "phaseCoverage"; phaseIndex: number }> };
