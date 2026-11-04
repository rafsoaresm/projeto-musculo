import {
  parsePeriodizationInput,
  isV2Input,
  isV2Phase,
  type PeriodizationInputV1,
  type PeriodizationInputV2,
  type PeriodizationSchedule,
  type PeriodizationScheduleV1,
  type PeriodizationScheduleV2,
  type PhaseInputV2,
  type SchedulePhase,
  type WorkoutInputV2,
} from "./contracts";

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** The workouts a v1 split is made of: its letters, or the single "Full Body". */
export const workoutLabels = (split: string): string[] =>
  split === "Full Body" ? ["Full Body"] : [...split];

/** Calendar dates, not instants. Rotation continues between weeks within a phase. Throws `ZodError` on invalid input. */
export function buildPeriodization(input: PeriodizationInputV1): PeriodizationScheduleV1;
export function buildPeriodization(input: PeriodizationInputV2): PeriodizationScheduleV2;
export function buildPeriodization(input: unknown): PeriodizationSchedule;
export function buildPeriodization(input: unknown): PeriodizationSchedule {
  const parsed = parsePeriodizationInput(input);
  return isV2Input(parsed) ? buildV2(parsed) : buildV1(parsed);
}

function buildV1(parsed: PeriodizationInputV1): PeriodizationScheduleV1 {
  let cursor = parsed.startDate;
  let totalSessions = 0;
  let totalWeeks = 0;
  const phases = parsed.phases.map((phase, index) => {
    const startDate = cursor;
    const split = workoutLabels(phase.split);
    const microcycles = Array.from({ length: phase.weeks }, (_, week) => {
      const weekStart = cursor;
      const sessions = Array.from(
        { length: phase.sessionsPerWeek },
        (_, session) =>
          split[(week * phase.sessionsPerWeek + session) % split.length],
      );
      cursor = addDays(cursor, 7);
      return {
        index: week + 1,
        startDate: weekStart,
        endDate: addDays(cursor, -1),
        sessions,
      };
    });
    totalSessions += phase.weeks * phase.sessionsPerWeek;
    totalWeeks += phase.weeks;
    return {
      ...phase,
      index: index + 1,
      startDate,
      endDate: addDays(cursor, -1),
      microcycles,
    };
  });
  return {
    schemaVersion: 1,
    engineVersion: "0.1.0",
    status: "DRAFT",
    startDate: parsed.startDate,
    endDate: addDays(cursor, -1),
    totalWeeks,
    totalSessions,
    phases,
  };
}

/**
 * v2: free labels, any number of weeks and sessions, a rotation of the phase's workouts and, when the phase has
 * training days, the planned date of each session (day offset from the first day of that week). Without training
 * days the date stays empty: it is never guessed.
 */
function buildV2(parsed: PeriodizationInputV2): PeriodizationScheduleV2 {
  let cursor = parsed.startDate;
  let totalSessions = 0;
  let totalWeeks = 0;
  const phases = parsed.phases.map((phase, index) => {
    const startDate = cursor;
    const rotation = phaseRotation(phase);
    const microcycles = Array.from({ length: phase.weeks }, (_, week) => {
      const weekStart = cursor;
      const slots = Array.from({ length: phase.sessionsPerWeek }, (_, session) => {
        const day = phase.trainingDays?.[session];
        return {
          slot: session + 1,
          label: rotation[(week * phase.sessionsPerWeek + session) % rotation.length],
          plannedDate: day === undefined ? null : addDays(weekStart, day),
        };
      });
      cursor = addDays(cursor, 7);
      return {
        index: week + 1,
        startDate: weekStart,
        endDate: addDays(cursor, -1),
        sessions: slots.map((slot) => slot.label),
        slots,
      };
    });
    totalSessions += phase.weeks * phase.sessionsPerWeek;
    totalWeeks += phase.weeks;
    return {
      ...phase,
      index: index + 1,
      startDate,
      endDate: addDays(cursor, -1),
      rotation,
      microcycles,
    };
  });
  return {
    schemaVersion: 2,
    engineVersion: "0.2.0",
    status: "DRAFT",
    startDate: parsed.startDate,
    endDate: addDays(cursor, -1),
    totalWeeks,
    totalSessions,
    phases,
  };
}

const phaseRotation = (phase: Pick<PhaseInputV2, "rotation" | "workouts">): string[] =>
  phase.rotation ?? phase.workouts.map((workout) => workout.label);

/** One workout of a saved phase, whatever the version. v1 has no names nor per-workout focus. */
export interface PhaseWorkout {
  label: string;
  name: string | null;
  /** Exercises the professional aims at; null = no target. */
  target: number | null;
  focus: WorkoutInputV2["focus"];
}

/** The workouts of a phase, in the order the professional listed them. */
export function phaseWorkouts(phase: SchedulePhase): PhaseWorkout[] {
  if (isV2Phase(phase))
    return phase.workouts.map((workout) => ({
      label: workout.label,
      name: workout.name,
      target: workout.exerciseTarget,
      focus: workout.focus,
    }));
  return workoutLabels(phase.split).map((label) => ({
    label,
    name: null,
    target: phase.exercisesPerSession,
    focus: null,
  }));
}

export const phaseWorkoutLabels = (phase: SchedulePhase): string[] =>
  isV2Phase(phase) ? phase.workouts.map((workout) => workout.label) : workoutLabels(phase.split);

/**
 * How the division of a phase is written for people. v1 keeps its split exactly ("ABC", "Full Body"), so what
 * delivered v1 plans show (and the PDF fingerprint) does not change. v2 lists the labels.
 */
export const phaseDivisionText = (phase: SchedulePhase): string =>
  isV2Phase(phase) ? phase.workouts.map((workout) => workout.label).join(" / ") : phase.split;

/** Free name of a v2 phase ("Adaptação"); v1 phases have none. */
export const phaseName = (phase: SchedulePhase): string | null => (isV2Phase(phase) ? phase.name : null);

/** The target of one workout of a phase (null = no target, or not a workout of the phase). */
export function phaseTarget(phase: SchedulePhase, label: string): number | null {
  return phaseWorkouts(phase).find((workout) => workout.label === label)?.target ?? null;
}

/** Targets of the phase written for a table cell: "5" for v1, "A 6 · B 5" or "sem alvo" for v2. */
export function phaseTargetText(phase: SchedulePhase): string {
  if (!isV2Phase(phase)) return String(phase.exercisesPerSession);
  const workouts = phaseWorkouts(phase);
  const targets = new Set(workouts.map((workout) => workout.target));
  if (targets.size === 1) {
    const [only] = targets;
    return only === null ? "sem alvo" : String(only);
  }
  return workouts.map((workout) => `${workout.label} ${workout.target ?? "sem alvo"}`).join(" · ");
}

/**
 * The same structure written as v2: labels, targets and rotation come from the split, so the calendar, the
 * sessions and the workout labels (and so every prescribed exercise) stay where they were.
 */
export function convertV1ToV2(input: PeriodizationInputV1): PeriodizationInputV2 {
  return {
    schemaVersion: 2,
    startDate: input.startDate,
    phases: input.phases.map((phase) => ({
      name: null,
      weeks: phase.weeks,
      sessionsPerWeek: phase.sessionsPerWeek,
      workouts: workoutLabels(phase.split).map((label) => ({
        label,
        name: null,
        exerciseTarget: phase.exercisesPerSession,
        focus: null,
      })),
      rotation: null,
      trainingDays: null,
    })),
  };
}

const V1_SPLITS = ["Full Body", "AB", "ABC", "ABCD", "ABCDE", "ABCDEF", "ABCDEFG"] as const;

/**
 * The v1 form of a v2 structure, when it has one (the planner's "Divisão padrão" mode): same labels in split
 * order, one shared target, no names, focus, custom rotation nor training days, and v1's limits. Null otherwise.
 */
export function convertV2ToV1(input: PeriodizationInputV2): PeriodizationInputV1 | null {
  if (![3, 6, 12].includes(input.phases.length)) return null;
  const phases: PeriodizationInputV1["phases"] = [];
  for (const phase of input.phases) {
    const labels = phase.workouts.map((workout) => workout.label);
    const split = V1_SPLITS.find((candidate) => workoutLabels(candidate).join("|") === labels.join("|"));
    const target = phase.workouts[0]?.exerciseTarget ?? null;
    const plain =
      phase.name === null &&
      phase.trainingDays === null &&
      (phase.rotation === null || phase.rotation.join("|") === labels.join("|")) &&
      phase.workouts.every((workout) => workout.name === null && workout.focus === null && workout.exerciseTarget === target);
    if (
      !split ||
      !plain ||
      target === null ||
      target < 3 ||
      phase.weeks < 3 ||
      phase.weeks > 6 ||
      phase.sessionsPerWeek > 7
    )
      return null;
    phases.push({ weeks: phase.weeks, sessionsPerWeek: phase.sessionsPerWeek, split, exercisesPerSession: target });
  }
  return { startDate: input.startDate, phases };
}
