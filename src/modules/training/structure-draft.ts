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
