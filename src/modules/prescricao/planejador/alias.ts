/**
 * Alias assignment (design V4 §2.2): exercises sorted by real id over the shortlist only -> X1..Xn; workouts by first
 * appearance walking phases in order -> T1..Tn (the same label is the same alias in every phase); findings in the given order
 * -> F1..Fn. Aliases are NOT anonymisation (docs say so): they only keep ids, names and free labels out of the request.
 */
import { cmp } from "@/modules/prescricao/motor/vocabulary";
import type { AliasTables } from "./context-types";
import { aliasMapHash } from "./hashes";

export async function assignAliases(input: {
  exerciseIds: readonly string[];
  /** Labels in first-appearance order across phases (duplicates allowed; they collapse). */
  workoutLabels: readonly string[];
  findings: ReadonlyArray<{ kind: string; code: string }>;
}): Promise<AliasTables> {
  const exercises = new Map<`X${number}`, string>();
  [...new Set(input.exerciseIds)].sort(cmp).forEach((id, i) => exercises.set(`X${i + 1}`, id));
  const workouts = new Map<`T${number}`, string>();
  [...new Set(input.workoutLabels)].forEach((label, i) => workouts.set(`T${i + 1}`, label));
  const findings = new Map<`F${number}`, { kind: string; code: string }>();
  input.findings.forEach((f, i) => findings.set(`F${i + 1}`, { kind: f.kind, code: f.code }));
  return { exercises, workouts, findings, aliasMapHash: await aliasMapHash({ exercises, workouts }) };
}

export const aliasOfLabel = (tables: Pick<AliasTables, "workouts">, label: string): `T${number}` | null => {
  for (const [alias, l] of tables.workouts) if (l === label) return alias;
  return null;
};
export const aliasOfExercise = (tables: Pick<AliasTables, "exercises">, id: string): `X${number}` | null => {
  for (const [alias, e] of tables.exercises) if (e === id) return alias;
  return null;
};
