/**
 * Focus of a workout as role + delta (design V4 §2.3, §2.5): the model and the stored blueprint carry the role and the
 * differences from the pinned role table; the expanded lists are derived here, always against the table the blueprint names.
 * Pure.
 */
import { z } from "zod";
import { cmp } from "@/modules/prescricao/motor/vocabulary";
import type { RoleFocusTable } from "./role-focus";
import { MUSCLE_CODES, PATTERN_CODES, type WorkoutRole } from "./vocab";

const codes = <T extends z.ZodTypeAny>(c: T) => z.array(c).max(8);
const muscle = z.enum(MUSCLE_CODES);
const pattern = z.enum(PATTERN_CODES);

/** The eight add/remove lists. All empty = "role defaults". Also the stored and compiled shape. */
export const focusDeltaSchema = z.strictObject({
  addDominant: codes(muscle), removeDominant: codes(muscle), addSupporting: codes(muscle), removeSupporting: codes(muscle),
  addTargetPatterns: codes(pattern), removeTargetPatterns: codes(pattern), addSpillover: codes(pattern), removeSpillover: codes(pattern),
});
export type FocusDelta = z.infer<typeof focusDeltaSchema>;
export const DELTA_KEYS = [
  "addDominant", "removeDominant", "addSupporting", "removeSupporting", "addTargetPatterns", "removeTargetPatterns", "addSpillover", "removeSpillover",
] as const satisfies ReadonlyArray<keyof FocusDelta>;

export interface ExpandedFocus {
  dominantMuscles: string[];
  supportingMuscles: string[];
  targetPatterns: string[];
  allowedSpilloverPatterns: string[];
}

export const emptyDelta = (): FocusDelta => ({
  addDominant: [], removeDominant: [], addSupporting: [], removeSupporting: [], addTargetPatterns: [], removeTargetPatterns: [], addSpillover: [], removeSpillover: [],
});
export const deltaSize = (delta: FocusDelta | null): number => (delta ? DELTA_KEYS.reduce((n, k) => n + delta[k].length, 0) : 0);
export const isEmptyDelta = (delta: FocusDelta | null): boolean => deltaSize(delta) === 0;

const apply = (base: readonly string[], add: readonly string[], remove: readonly string[]): string[] =>
  [...new Set([...base.filter((c) => !remove.includes(c)), ...add])].sort(cmp);

/** Role defaults with the delta applied (removals first, then additions); lists sorted by code point. */
export function expandFocus(role: WorkoutRole, delta: FocusDelta | null, table: RoleFocusTable): ExpandedFocus {
  const base = table[role];
  const d = delta ?? emptyDelta();
  return {
    dominantMuscles: apply(base.dominantMuscles, d.addDominant, d.removeDominant),
    supportingMuscles: apply(base.supportingMuscles, d.addSupporting, d.removeSupporting),
    targetPatterns: apply(base.targetPatterns, d.addTargetPatterns, d.removeTargetPatterns),
    allowedSpilloverPatterns: apply(base.allowedSpilloverPatterns, d.addSpillover, d.removeSpillover),
  };
}

/** The delta that turns the role's defaults into `focus` (what the UI edits as expanded lists is stored as a delta). `null` when equal to the defaults. */
export function deriveDelta(role: WorkoutRole, focus: ExpandedFocus, table: RoleFocusTable): FocusDelta | null {
  const base = table[role];
  const add = (now: readonly string[], was: readonly string[]) => [...new Set(now)].filter((c) => !was.includes(c)).sort(cmp);
  const remove = (now: readonly string[], was: readonly string[]) => [...new Set(was)].filter((c) => !now.includes(c)).sort(cmp);
  const delta: FocusDelta = {
    addDominant: add(focus.dominantMuscles, base.dominantMuscles), removeDominant: remove(focus.dominantMuscles, base.dominantMuscles),
    addSupporting: add(focus.supportingMuscles, base.supportingMuscles), removeSupporting: remove(focus.supportingMuscles, base.supportingMuscles),
    addTargetPatterns: add(focus.targetPatterns, base.targetPatterns), removeTargetPatterns: remove(focus.targetPatterns, base.targetPatterns),
    addSpillover: add(focus.allowedSpilloverPatterns, base.allowedSpilloverPatterns), removeSpillover: remove(focus.allowedSpilloverPatterns, base.allowedSpilloverPatterns),
  };
  return isEmptyDelta(delta) ? null : delta;
}

/** Each list deduplicated and sorted by code point; `null` when nothing is left (the canonical form that is hashed and stored). */
export function normalizeDeltaOf(delta: FocusDelta | null): FocusDelta | null {
  if (!delta) return null;
  const out = emptyDelta();
  for (const k of DELTA_KEYS) out[k] = [...new Set(delta[k])].sort(cmp);
  return isEmptyDelta(out) ? null : out;
}
