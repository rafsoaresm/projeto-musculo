/**
 * Closed vocabularies of the planner contracts (design V4 §2.1). Muscle, pattern, equipment and modality codes come from the
 * library vocabulary and are never re-declared; stimulus codes from the engine vocabulary.
 */
import { EQUIPMENT, MODALITIES, MUSCLES, PATTERNS } from "@/modules/biblioteca/metadata/vocabulary";
import { STIMULUS_LABELS } from "@/modules/prescricao/motor/vocabulary";

export const MUSCLE_CODES = Object.keys(MUSCLES) as [string, ...string[]];
export const PATTERN_CODES = Object.keys(PATTERNS) as [string, ...string[]];
export const EQUIPMENT_CODES = Object.keys(EQUIPMENT) as [string, ...string[]];
export const MODALITY_CODES = Object.keys(MODALITIES) as [string, ...string[]];
export const STIMULUS_CODES = Object.keys(STIMULUS_LABELS) as [string, ...string[]];

export const SPLIT_FAMILIES = ["FULL_BODY", "UPPER_LOWER", "PUSH_PULL_LEGS", "BODY_PART", "CUSTOM"] as const;
export type SplitFamily = (typeof SPLIT_FAMILIES)[number];

/** Role of a workout inside a phase. Volume roles carry muscle focus; the others never do. */
export const WORKOUT_ROLES = [
  "FULL_BODY", "UPPER", "LOWER", "PUSH", "PULL", "LEGS", "CHEST_TRICEPS", "BACK_BICEPS", "SHOULDERS_ARMS", "CORE", "CUSTOM",
  "CARDIO", "MOBILITY", "BALANCE", "SKILL",
] as const;
export type WorkoutRole = (typeof WORKOUT_ROLES)[number];
export const NON_VOLUME_ROLES = ["CARDIO", "MOBILITY", "BALANCE", "SKILL"] as const;
export const isNonVolumeRole = (role: WorkoutRole): boolean => (NON_VOLUME_ROLES as readonly string[]).includes(role);

/** Where a decision comes from. Separate from the engine's `Basis` (not extended). EVIDENCE is reserved for rules with VERIFIED refs and is never accepted from a model. */
export const PROVENANCE = ["AI_SUGGESTED", "RULES_HEURISTIC", "PROFESSIONAL", "STUDENT_DATA", "STRUCTURE", "EVIDENCE"] as const;
export type Provenance = (typeof PROVENANCE)[number];
/** What a compiled focus can carry. */
export type FocusSource = "AI_SUGGESTED" | "RULES_HEURISTIC" | "PROFESSIONAL";
/** What a model-produced field may claim: never EVIDENCE, STUDENT_DATA or PROFESSIONAL. */
export const MODEL_PROVENANCE: readonly Provenance[] = ["AI_SUGGESTED"];

export const UNCERTAINTY_CODES = [
  "EXPERIENCE_UNKNOWN", "GOAL_UNKNOWN", "TIME_UNKNOWN", "DAYS_UNKNOWN", "EQUIPMENT_LIMITED", "LIBRARY_THIN", "METADATA_INFERRED",
  "SCREENING_OPEN", "HISTORY_ABSENT", "STRUCTURE_CONSTRAINS", "OTHER",
] as const;
export const QUESTION_CODES = ["CONFIRM_SPLIT", "CONFIRM_FOCUS", "CONFIRM_FREQUENCY", "CONFIRM_PROGRESSION", "CONFIRM_DOSE", "OTHER"] as const;

/** Closed catalogue of dose profiles the planner may ask for. The numbers belong to ruleset 2026.11.6; PR 1-2 only store the code. */
export const DOSE_PROFILE_CODES = [
  "COMPOUND_HEAVY", "COMPOUND_MODERATE", "ISOLATION_STANDARD", "ISOLATION_HIGH_REP", "UNILATERAL_STANDARD", "CORE_STABILITY",
  "TIME_BASED", "CONDITIONING_CONTINUOUS", "CONDITIONING_INTERVALS", "MOBILITY_HOLD", "SKILL_PRACTICE",
] as const;
/** No DELOAD: a deload is never automatic. */
export const PROGRESSION_INTENTS = ["HOLD", "VOLUME_RAMP", "LOAD_FIRST", "REPS_THEN_LOAD", "UNDULATING", "BLOCKS"] as const;
export const EXERCISE_CLASSES = [
  "COMPOUND_UPPER_PUSH", "COMPOUND_UPPER_PULL", "COMPOUND_LOWER", "ISOLATION_UPPER", "ISOLATION_LOWER", "CORE", "CONDITIONING", "MOBILITY", "OTHER",
] as const;

/** Fixed pt-BR names of the families: never model text. */
export const SPLIT_DISPLAY_NAME: Record<SplitFamily, string> = {
  FULL_BODY: "Corpo inteiro",
  UPPER_LOWER: "Superior / Inferior",
  PUSH_PULL_LEGS: "Empurrar / Puxar / Pernas",
  BODY_PART: "Por grupo muscular",
  CUSTOM: "Personalizada",
};

/** Coarse body region of a muscle, for the "a delta may not move a workout to another region" check (consistent with the engine's AUDIT_REGIONS, tested). */
export type Region = "UPPER" | "LOWER" | "TRUNK";
const LOWER = ["QUADRICEPS", "HAMSTRINGS", "GLUTEUS", "ADDUCTORS", "ABDUCTORS", "CALVES"];
const TRUNK = ["ABS", "OBLIQUES", "ERECTORS"];
export const regionOfMuscle = (muscle: string): Region => (LOWER.includes(muscle) ? "LOWER" : TRUNK.includes(muscle) ? "TRUNK" : "UPPER");

export const PROFILE_ORIGINS = ["STUDENT_DECLARED", "ASSESSED", "PROFESSIONAL_DECISION", "UNKNOWN"] as const;
