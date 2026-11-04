/**
 * Execution history as the automatic prescription reads it (motor S5, design §2.1 and §4.4). Pure: the rows come from a gated query
 * (`executionFor(...).exposures`), and this module only reshapes them. Nothing here grades, fills in or guesses a value:
 * - a set keeps exactly what the student typed (reps, load, RIR of that set, duration, distance, how the load was counted); an
 *   empty field stays null, never 0;
 * - the RIR typed for the whole exercise is never copied onto its sets (design §1.5: "does not copy per-exercise RIR onto sets");
 * - an exercise typed by name only (no library id) cannot be matched to the catalog, so it is counted apart and left out;
 * - an exercise marked not done is not an exposure, unless the student reported pain on it (pain always reaches the professional).
 */
import type { ExposureLog, ExposureSet, LoadBasis, Metric } from "@/modules/prescricao/motor/types";

/** One flat row of the gated query: one per set typed, or one per exercise without sets (set columns null). */
export interface ExposureRow {
  sessionId: string;
  performedOn: string;
  createdAt: string;
  effort: number | null;
  sessionExerciseId: string;
  exerciseId: string | null;
  name: string;
  position: number;
  done: number;
  exerciseRir: number | null;
  pain: number;
  setNumber: number | null;
  reps: number | null;
  loadKg: number | null;
  rir: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  loadBasis: string | null;
}

/** What the gated query read: the window, how many sessions, and whether the newest-first cap cut older ones. */
export interface ExposureWindow {
  since: string;
  until: string;
  sinceDays: number;
  sessions: number;
  /** True when the window had more sessions than `EXPOSURE_MAX_SESSIONS`: only the newest were read. */
  truncated: boolean;
  rows: ExposureRow[];
}

/**
 * Technical cap on the sessions read per generation (newest first). A 180-day window holds about one session a day for a
 * regular student; 200 keeps the worst case (30 exercises × 20 sets each) a bounded read. Not a product rule: when it cuts,
 * `truncated` is true and the adapter says so as an assumption.
 */
export const EXPOSURE_MAX_SESSIONS = 200;

const LOAD_BASES: ReadonlySet<string> = new Set(["TOTAL", "PER_HAND", "PER_SIDE", "MACHINE_STACK", "BODYWEIGHT", "ASSISTANCE", "NONE"]);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface ExposureExercise {
  exerciseId: string;
  name: string;
  exposures: number;
  lastDate: string;
  /** Heaviest load typed on the last date (null when none was typed). */
  lastTopLoadKg: number | null;
  /** Reps typed on the last date, in set order (null where a set has no reps). */
  lastReps: Array<number | null>;
  pain: boolean;
}

export interface ExposureHistory {
  logs: ExposureLog[];
  /** Per library exercise, for the screen ("Histórico usado"). Sorted by exercise id. */
  exercises: ExposureExercise[];
  /** Exercises typed by name only (no library id): logged, but not usable by the engine. */
  customSkipped: number;
  /** Exercises marked not done and without pain: not exposures. */
  notDone: number;
  /** Sessions with an effort (0 a 10) typed by the student. */
  sessionsWithEffort: number;
}

/** The measure the log was typed in: only from what was typed; with nothing typed, the catalog's metric, else REPS (such a log has no sets, so it never feeds a progression). */
function metricOf(sets: ExposureSet[], catalogMetric: Metric | null | undefined): Metric {
  if (sets.some((s) => s.reps !== null)) return "REPS";
  if (sets.some((s) => s.durationSeconds !== null)) return "TIME";
  return catalogMetric ?? "REPS";
}

/** Turns the rows into engine logs (one per exercise per session) and a per-exercise summary. Deterministic. */
export function toExposureHistory(rows: ExposureRow[], catalogMetric: ReadonlyMap<string, Metric | null> = new Map()): ExposureHistory {
  const byExercise = new Map<string, { row: ExposureRow; sets: Array<ExposureSet & { setNumber: number; distanceMeters: number | null }> }>();
  for (const row of rows) {
    const entry = byExercise.get(row.sessionExerciseId) ?? { row, sets: [] };
    if (row.setNumber !== null) {
      const measured = row.reps !== null || row.durationSeconds !== null || row.distanceMeters !== null;
      entry.sets.push({
        setNumber: row.setNumber,
        reps: row.reps,
        durationSeconds: row.durationSeconds,
        distanceMeters: row.distanceMeters,
        loadKg: row.loadKg,
        loadBasis: row.loadBasis !== null && LOAD_BASES.has(row.loadBasis) ? (row.loadBasis as LoadBasis) : null,
        rir: row.rir,
        completed: row.done === 1 && measured,
      });
    }
    byExercise.set(row.sessionExerciseId, entry);
  }
  const logs: ExposureLog[] = [];
  let customSkipped = 0;
  let notDone = 0;
  const effortSessions = new Set<string>();
  for (const { row, sets } of byExercise.values()) {
    if (row.effort !== null) effortSessions.add(row.sessionId);
    if (row.exerciseId === null) {
      customSkipped += 1;
      continue;
    }
    if (row.done !== 1 && row.pain !== 1) {
      notDone += 1;
      continue;
    }
    const ordered = [...sets].sort((a, b) => a.setNumber - b.setNumber);
    const engineSets: ExposureSet[] = ordered.map(({ reps, durationSeconds, loadKg, loadBasis, rir, completed }) => ({
      reps, durationSeconds, loadKg, loadBasis, rir, completed,
    }));
    logs.push({
      exerciseId: row.exerciseId,
      date: row.performedOn,
      equipmentKey: null,
      metric: metricOf(engineSets, catalogMetric.get(row.exerciseId)),
      sets: engineSets,
      pain: row.pain === 1,
      sessionEffort: row.effort,
      ref: `session:${row.sessionId}`,
    });
  }
  logs.sort((a, b) => cmp(a.date, b.date) || cmp(a.ref ?? "", b.ref ?? "") || cmp(a.exerciseId, b.exerciseId));
  const names = new Map<string, string>();
  for (const row of rows) if (row.exerciseId !== null && !names.has(row.exerciseId)) names.set(row.exerciseId, row.name);
  const summary = new Map<string, ExposureExercise>();
  for (const log of logs) {
    const current = summary.get(log.exerciseId);
    const loads = log.sets.map((s) => s.loadKg).filter((v): v is number => v !== null);
    const last = {
      lastDate: log.date,
      lastTopLoadKg: loads.length ? Math.max(...loads) : null,
      lastReps: log.sets.map((s) => s.reps),
    };
    if (!current) {
      summary.set(log.exerciseId, { exerciseId: log.exerciseId, name: names.get(log.exerciseId) ?? log.exerciseId, exposures: 1, pain: log.pain, ...last });
    } else {
      current.exposures += 1;
      current.pain = current.pain || log.pain;
      if (log.date >= current.lastDate) Object.assign(current, last);
    }
  }
  return {
    logs,
    exercises: [...summary.values()].sort((a, b) => cmp(a.exerciseId, b.exerciseId)),
    customSkipped,
    notDone,
    sessionsWithEffort: effortSessions.size,
  };
}
