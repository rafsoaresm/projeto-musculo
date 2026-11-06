/**
 * `ROLE_FOCUS` (design V4 §3.11): what each workout role means in muscles and patterns. HEURISTIC operational values, editable
 * through the professional's deltas, for the Técnico to validate (docs/PENDENCIAS.md). While they live in code the table is
 * `interim-1`; PR 2.2 moves it into the ruleset (`BLUEPRINT_ROLE_FOCUS`) and a test keeps the two equal until this constant goes.
 * Blueprints already stored with `interim-1` stay valid: they are data and carry `roleFocusRef`.
 */
import type { WorkoutRole } from "./vocab";

export interface RoleFocus {
  dominantMuscles: readonly string[];
  supportingMuscles: readonly string[];
  targetPatterns: readonly string[];
  allowedSpilloverPatterns: readonly string[];
}
export type RoleFocusTable = Readonly<Record<WorkoutRole, RoleFocus>>;

const NONE: RoleFocus = { dominantMuscles: [], supportingMuscles: [], targetPatterns: [], allowedSpilloverPatterns: [] };

const LOWER: RoleFocus = {
  dominantMuscles: ["QUADRICEPS", "HAMSTRINGS", "GLUTEUS", "ADDUCTORS", "ABDUCTORS", "CALVES"],
  supportingMuscles: ["ERECTORS", "ABS", "OBLIQUES"],
  targetPatterns: ["SQUAT", "HINGE", "LUNGE", "KNEE_EXTENSION", "KNEE_FLEXION", "HIP_EXTENSION", "HIP_ABDUCTION", "PLANTAR_FLEXION"],
  allowedSpilloverPatterns: ["ANTI_EXTENSION", "ANTI_ROTATION", "CARRY"],
};
const PUSH_SPILL = ["ANTI_EXTENSION", "SHOULDER_FLEXION", "HORIZONTAL_ADDUCTION"];
const PULL_SPILL = ["SHOULDER_EXTENSION", "CARRY", "ANTI_ROTATION"];

export const ROLE_FOCUS_INTERIM_TABLE: RoleFocusTable = Object.freeze({
  UPPER: {
    dominantMuscles: ["CHEST", "LATS", "UPPER_BACK", "FRONT_DELTOID", "SIDE_DELTOID", "REAR_DELTOID", "TRICEPS", "BICEPS"],
    supportingMuscles: ["TRAPEZIUS", "FOREARMS", "ABS", "OBLIQUES", "ERECTORS"],
    targetPatterns: ["HORIZONTAL_PUSH", "HORIZONTAL_PULL", "VERTICAL_PUSH", "VERTICAL_PULL"],
    allowedSpilloverPatterns: [
      "ELBOW_FLEXION", "ELBOW_EXTENSION", "SHOULDER_ABDUCTION", "SHOULDER_FLEXION", "SHOULDER_EXTENSION", "HORIZONTAL_ADDUCTION",
      "HORIZONTAL_ABDUCTION", "ANTI_EXTENSION", "ANTI_ROTATION", "CARRY",
    ],
  },
  LOWER,
  PUSH: {
    dominantMuscles: ["CHEST", "FRONT_DELTOID", "SIDE_DELTOID", "TRICEPS"],
    supportingMuscles: ["ABS"],
    targetPatterns: ["HORIZONTAL_PUSH", "VERTICAL_PUSH", "ELBOW_EXTENSION", "SHOULDER_ABDUCTION"],
    allowedSpilloverPatterns: PUSH_SPILL,
  },
  PULL: {
    dominantMuscles: ["LATS", "UPPER_BACK", "REAR_DELTOID", "BICEPS"],
    supportingMuscles: ["TRAPEZIUS", "FOREARMS", "ERECTORS"],
    targetPatterns: ["HORIZONTAL_PULL", "VERTICAL_PULL", "ELBOW_FLEXION", "HORIZONTAL_ABDUCTION"],
    allowedSpilloverPatterns: PULL_SPILL,
  },
  LEGS: { ...LOWER, supportingMuscles: ["ABS", "ERECTORS"] },
  CHEST_TRICEPS: {
    dominantMuscles: ["CHEST", "FRONT_DELTOID", "TRICEPS"],
    supportingMuscles: ["ABS"],
    targetPatterns: ["HORIZONTAL_PUSH", "ELBOW_EXTENSION"],
    allowedSpilloverPatterns: PUSH_SPILL,
  },
  BACK_BICEPS: {
    dominantMuscles: ["LATS", "UPPER_BACK", "BICEPS"],
    supportingMuscles: ["FOREARMS", "TRAPEZIUS", "REAR_DELTOID"],
    targetPatterns: ["HORIZONTAL_PULL", "VERTICAL_PULL", "ELBOW_FLEXION"],
    allowedSpilloverPatterns: PULL_SPILL,
  },
  SHOULDERS_ARMS: {
    dominantMuscles: ["FRONT_DELTOID", "SIDE_DELTOID", "REAR_DELTOID", "BICEPS", "TRICEPS"],
    supportingMuscles: ["TRAPEZIUS", "FOREARMS"],
    targetPatterns: ["VERTICAL_PUSH", "SHOULDER_ABDUCTION", "ELBOW_FLEXION", "ELBOW_EXTENSION", "HORIZONTAL_ABDUCTION"],
    allowedSpilloverPatterns: ["ANTI_EXTENSION", "CARRY"],
  },
  FULL_BODY: { dominantMuscles: [], supportingMuscles: [], targetPatterns: ["SQUAT", "HINGE", "HORIZONTAL_PUSH", "HORIZONTAL_PULL", "VERTICAL_PUSH", "VERTICAL_PULL"], allowedSpilloverPatterns: [] },
  CORE: {
    dominantMuscles: ["ABS", "OBLIQUES"],
    supportingMuscles: ["ERECTORS"],
    targetPatterns: ["ANTI_EXTENSION", "ANTI_ROTATION", "ANTI_LATERAL_FLEXION", "TRUNK_FLEXION", "ROTATION"],
    allowedSpilloverPatterns: [],
  },
  CUSTOM: NONE,
  CARDIO: NONE,
  MOBILITY: NONE,
  BALANCE: NONE,
  SKILL: NONE,
});
