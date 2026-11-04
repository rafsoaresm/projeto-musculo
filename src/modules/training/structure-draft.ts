import type { ZodError } from "zod";
import {
  EXERCISES_PER_SESSION_MAX,
  STRUCTURE_LIMITS,
  type PhaseInputV2,
  type WorkoutInputV2,
} from "./contracts";
import { workoutLabels } from "./periodization";

/**
 * Pure helpers of the planner's free structure (v2) editor: what a new phase or workout starts with and how
 * a validation problem is told to the professional. Nothing here is a training rule: the starting values are
 * the same the v1 planner offered (4 weeks, 3 sessions, ABC, target 5), and every one of them is editable.
 */

export const SESSIONS_PER_WEEK_OPTIONS = Array.from({ length: STRUCTURE_LIMITS.MAX_SESSIONS_PER_WEEK }, (_, i) => i + 1);
export const PHASE_COUNT_OPTIONS = Array.from({ length: STRUCTURE_LIMITS.MAX_PHASES }, (_, i) => i + 1);
export const TARGET_OPTIONS = Array.from({ length: EXERCISES_PER_SESSION_MAX }, (_, i) => i + 1);

export const newWorkout = (label: string, exerciseTarget: number | null = 5): WorkoutInputV2 => ({
  label,
  name: null,
  exerciseTarget,
  focus: null,
});

export const defaultPhaseV2 = (): PhaseInputV2 => ({
  name: null,
  weeks: 4,
  sessionsPerWeek: 3,
  workouts: ["A", "B", "C"].map((label) => newWorkout(label)),
  rotation: null,
  trainingDays: null,
});

/** The first free letter (A–Z), then "T27", "T28"… A suggestion only: the professional renames it. */
export function nextLabel(used: string[]): string {
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    if (!used.includes(letter)) return letter;
  }
  let n = 27;
  while (used.includes(`T${n}`)) n += 1;
  return `T${n}`;
}

/** The workouts of a standard split, keeping the target of the first current workout. */
export function workoutsFromSplit(split: string, current: WorkoutInputV2[]): WorkoutInputV2[] {
  const target = current[0]?.exerciseTarget ?? 5;
  return workoutLabels(split).map((label) => newWorkout(label, target));
}

/**
 * Training days spread over the week, one per session, in order (day 0 = first day of each week of the phase).
 * Only a starting point when the professional turns days on; each day stays editable.
 */
export const spreadDays = (sessions: number): number[] =>
  Array.from({ length: sessions }, (_, i) => Math.floor((i * 7) / sessions));

const WEEKDAYS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

/** "Dia 1 (seg.)": the offset and, when the start date is known, its weekday. */
export function dayLabel(startDate: string, offset: number): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? new Date(`${startDate}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return `Dia ${offset + 1}`;
  return `Dia ${offset + 1} (${WEEKDAYS[(parsed.getUTCDay() + offset) % 7]})`;
}

/** The first problem of a v2 structure, said with the phase it belongs to. */
export function structureIssueMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Confira a estrutura antes de continuar.";
  const [root, phase] = issue.path;
  if (root === "startDate") return "Informe uma data de início válida entre 2000 e 2100.";
  const where = root === "phases" && typeof phase === "number" ? `Fase ${phase + 1}: ` : "";
  // zod's own messages (types, limits we did not word) are English; say it plainly instead.
  const worded = !/^(Invalid|Too (small|big)|Unrecognized|Expected)/.test(issue.message);
  if (worded) return `${where}${issue.message}`;
  return where ? `${where}confira os valores desta fase.` : "Confira a estrutura antes de continuar.";
}

/**
 * Which workout (its index in the list) each position of a custom rotation belongs to. The saved rotation
 * holds labels, so while a label is being typed it can briefly equal another workout's label; the editor
 * keeps the owners it last knew (`known`) and uses them while they still describe the rotation, instead of
 * guessing from the text. Without a usable memory, each position belongs to the first workout with its label.
 */
export function rotationOwners(rotation: string[], labels: string[], known: number[] | null): number[] {
  if (known && known.length === rotation.length && known.every((owner, k) => owner >= 0 && labels[owner] === rotation[k]))
    return known;
  return rotation.map((label) => labels.indexOf(label));
}

export interface RotationEdit {
  phase: PhaseInputV2;
  /** The owners of the new rotation's positions (null when the phase follows the list order). */
  owners: number[] | null;
}

/** Changes a workout; a renamed one keeps exactly its own places in a custom rotation, and no other's. */
export function updateWorkout(
  phase: PhaseInputV2,
  index: number,
  update: Partial<WorkoutInputV2>,
  known: number[] | null,
): RotationEdit {
  const workouts = phase.workouts.map((workout, i) => (i === index ? { ...workout, ...update } : workout));
  if (!phase.rotation) return { phase: { ...phase, workouts }, owners: null };
  const owners = rotationOwners(phase.rotation, phase.workouts.map((workout) => workout.label), known);
  const rotation =
    update.label === undefined ? phase.rotation : phase.rotation.map((label, k) => (owners[k] === index ? update.label! : label));
  return { phase: { ...phase, workouts, rotation }, owners };
}

/** Removes a workout and its places in a custom rotation (the rotation goes back to the list order when empty). */
export function removeWorkoutAt(phase: PhaseInputV2, index: number, known: number[] | null): RotationEdit {
  const workouts = phase.workouts.filter((_, i) => i !== index);
  if (!phase.rotation) return { phase: { ...phase, workouts }, owners: null };
  const owners = rotationOwners(phase.rotation, phase.workouts.map((workout) => workout.label), known);
  const kept = phase.rotation.flatMap((label, k) => (owners[k] === index ? [] : [{ label, owner: owners[k] > index ? owners[k] - 1 : owners[k] }]));
  return kept.length
    ? { phase: { ...phase, workouts, rotation: kept.map((entry) => entry.label) }, owners: kept.map((entry) => entry.owner) }
    : { phase: { ...phase, workouts, rotation: null }, owners: null };
}

/** Points one rotation position at a workout (by index, so two workouts that briefly share a label stay apart). */
export function setRotationPosition(phase: PhaseInputV2, position: number, workout: number, known: number[] | null): RotationEdit {
  const labels = phase.workouts.map((item) => item.label);
  const rotation = phase.rotation ?? labels;
  const owners = rotationOwners(rotation, labels, phase.rotation ? known : labels.map((_, i) => i));
  return {
    phase: { ...phase, rotation: rotation.map((label, k) => (k === position ? labels[workout] : label)) },
    owners: owners.map((owner, k) => (k === position ? workout : owner)),
  };
}
