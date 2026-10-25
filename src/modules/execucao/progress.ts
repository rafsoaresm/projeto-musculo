/**
 * Reading what a student logged against what the cycle foresaw. It counts and lists; it never
 * grades. A week with fewer logs than workouts foreseen is shown as it is: a missing log is not
 * proof that the workout was skipped, and a load that went up or down is not "better" or "worse".
 */
const DAY = 86_400_000;
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The key of an exercise: the name without case, accents and repeated spaces. */
export const seriesKey = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export interface PlannedWeek {
  phaseIndex: number;
  startDate: string;
  endDate: string;
  /** The workouts the schedule foresees for the week, in order. */
  workouts: string[];
}
export interface LoggedWorkout {
  performedOn: string;
  workoutLabel: string;
}
export interface WeekRecord extends PlannedWeek {
  planned: number;
  recorded: number;
  recordedWorkouts: string[];
  /** Today is inside this week and the cycle is still the one in use: it is not over yet. */
  inProgress: boolean;
}
export interface WeeklyRecords {
  weeks: WeekRecord[];
  /** Logs that fall outside every week shown (before the plan was delivered, or after the cycle). */
  outside: number;
  /** Only weeks that are over. The week in progress is never counted as missing. */
  closed: {
    weeks: number;
    planned: number;
    recorded: number;
    /** Planned workouts that have a log: each week counts at most what it foresaw. */
    covered: number;
  };
}

/**
 * `since` is the day the revision reached the student and `until` the last day it was the one in use
 * (today, or the day a newer revision replaced it): weeks before the student had the plan, or after
 * it was replaced, are not shown, so they never look like missed workouts.
 */
export function weeklyRecords(
  plan: PlannedWeek[],
  logs: LoggedWorkout[],
  range: { since: string; until: string; today: string },
): WeeklyRecords {
  const weeks = plan
    .filter((week) => week.endDate >= range.since && week.startDate <= range.until)
    .map((week) => {
      const inside = logs.filter((log) => log.performedOn >= week.startDate && log.performedOn <= week.endDate);
      return {
        ...week,
        planned: week.workouts.length,
        recorded: inside.length,
        recordedWorkouts: inside
          .toSorted((a, b) => a.performedOn.localeCompare(b.performedOn))
          .map((log) => log.workoutLabel),
        inProgress: range.today >= week.startDate && range.today <= week.endDate && range.until >= range.today,
      };
    });
  const closed = weeks.filter((week) => !week.inProgress && week.endDate <= range.until);
  return {
    weeks,
    outside: logs.length - weeks.reduce((sum, week) => sum + week.recorded, 0),
    closed: {
      weeks: closed.length,
      planned: closed.reduce((sum, week) => sum + week.planned, 0),
      recorded: closed.reduce((sum, week) => sum + week.recorded, 0),
      // A fourth log in a week of three does not make up for a week with none.
      covered: closed.reduce((sum, week) => sum + Math.min(week.recorded, week.planned), 0),
    },
  };
}

/**
 * The whole percent of the workouts foreseen, in the weeks that are over, that have a log. It counts
 * logs and is never a grade: no goal, no colour and no word like "low" or "good" goes with it.
 * Null when nothing was foreseen.
 */
export const percentCovered = (closed: { planned: number; covered: number }) =>
  closed.planned > 0 ? Math.round((closed.covered / closed.planned) * 100) : null;

/** The sentence under a cycle: what the weeks that are over hold, and the logs outside the weeks shown. */
export function closedSummary(closed: WeeklyRecords["closed"], outside: number): string {
  const percent = percentCovered(closed);
  const weeks = closed.weeks === 1 ? "semana já encerrada" : "semanas já encerradas";
  const recorded = closed.recorded === 1 ? "treino registrado" : "treinos registrados";
  const base =
    closed.weeks > 0
      ? `Nas ${closed.weeks} ${weeks}: ${closed.recorded} ${recorded} para ${closed.planned} previstos.` +
        (percent === null
          ? ""
          : ` Isso é ${percent}% dos treinos previstos com registro (cada semana conta, no máximo, o que estava previsto).`)
      : "Nenhuma semana encerrada ainda.";
  return outside > 0 ? `${base} ${outside} ${outside === 1 ? "registro fora" : "registros fora"} das semanas mostradas.` : base;
}

export interface LoggedExercise {
  performedOn: string;
  name: string;
  sets: Array<{ reps: number | null; loadKg: number | null }>;
}
export interface LoadPoint {
  performedOn: string;
  /** The heaviest set typed that day, and the repetitions typed for it (the most, on a tie). */
  maxLoadKg: number | null;
  repsAtMax: number | null;
  sets: number;
}
export interface LoadSeries {
  key: string;
  name: string;
  points: LoadPoint[];
  /** The points that can be drawn: a load was typed. */
  numeric: Array<LoadPoint & { maxLoadKg: number }>;
}

/**
 * One series per exercise name (ignoring case and accents), one point per day: the heaviest set
 * typed. Two logs of the same exercise on the same day are one point. Series come with the most
 * recently trained first.
 */
export function loadSeries(rows: LoggedExercise[]): LoadSeries[] {
  const groups = new Map<string, { name: string; lastOn: string; byDay: Map<string, LoggedExercise["sets"]> }>();
  for (const row of rows.toSorted((a, b) => a.performedOn.localeCompare(b.performedOn))) {
    const key = seriesKey(row.name);
    let group = groups.get(key);
    if (!group) {
      group = { name: row.name, lastOn: row.performedOn, byDay: new Map() };
      groups.set(key, group);
    }
    group.name = row.name;
    group.lastOn = row.performedOn;
    group.byDay.set(row.performedOn, [...(group.byDay.get(row.performedOn) ?? []), ...row.sets]);
  }
  return [...groups.entries()]
    .toSorted(([, a], [, b]) => b.lastOn.localeCompare(a.lastOn) || a.name.localeCompare(b.name, "pt-BR"))
    .map(([key, group]) => {
      const points: LoadPoint[] = [...group.byDay.entries()].map(([performedOn, sets]) => {
        const loaded = sets.filter((set) => set.loadKg !== null) as Array<{ reps: number | null; loadKg: number }>;
        const top = loaded.reduce<{ reps: number | null; loadKg: number } | null>(
          (best, set) =>
            !best || set.loadKg > best.loadKg || (set.loadKg === best.loadKg && (set.reps ?? -1) > (best.reps ?? -1))
              ? set
              : best,
          null,
        );
        return { performedOn, maxLoadKg: top?.loadKg ?? null, repsAtMax: top?.reps ?? null, sets: sets.length };
      });
      return {
        key,
        name: group.name,
        points,
        numeric: points.filter((point): point is LoadPoint & { maxLoadKg: number } => point.maxLoadKg !== null),
      };
    });
}
