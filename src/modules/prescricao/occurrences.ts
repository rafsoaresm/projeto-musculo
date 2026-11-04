import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { isV2Phase } from "@/modules/training/contracts";
import type { WorkoutSlot } from "./summary";

/**
 * Sessions of each week of a saved periodization (motor S7, design §5.1): one row per session the student will do, with the
 * dates the student sees. This is what an OCCURRENCE revision stores in `plan_session_occurrences`; pure, no I/O.
 */
export interface ScheduleOccurrence {
  phaseIndex: number;
  week: number;
  slot: number;
  label: string;
  weekStart: string;
  plannedDate: string | null;
}

export function scheduleOccurrences(schedule: PeriodizationSchedule): ScheduleOccurrence[] {
  return schedule.phases.flatMap((phase) =>
    phase.microcycles.flatMap((week) =>
      isV2Phase(phase)
        ? (week as (typeof phase.microcycles)[number]).slots.map((s) => ({
            phaseIndex: phase.index,
            week: week.index,
            slot: s.slot,
            label: s.label,
            weekStart: week.startDate,
            plannedDate: s.plannedDate,
          }))
        : week.sessions.map((label, i) => ({
            phaseIndex: phase.index,
            week: week.index,
            slot: i + 1,
            label,
            weekStart: week.startDate,
            plannedDate: null,
          })),
    ),
  );
}

export const occurrenceKey = (o: { phaseIndex: number; week: number; slot: number }) => `${o.phaseIndex}|${o.week}|${o.slot}`;

/**
 * How the sessions of one workout line up with the sessions of another (a copy of a workout or of a phase): the n-th session of
 * week w of the source goes to the n-th session of week w of the destination. Only when both have exactly the same weeks and the
 * same number of sessions in each week; otherwise `sameShape` is false and the caller uses one dose for every session.
 */
export function pairOccurrences(
  source: Array<{ id: string; week: number; slot: number }>,
  destination: Array<{ id: string; week: number; slot: number }>,
): { sameShape: boolean; pairs: Map<string, string> } {
  const byWeek = (list: Array<{ id: string; week: number; slot: number }>) => {
    const out = new Map<number, string[]>();
    for (const o of [...list].sort((a, b) => a.week - b.week || a.slot - b.slot)) out.set(o.week, [...(out.get(o.week) ?? []), o.id]);
    return out;
  };
  const from = byWeek(source);
  const to = byWeek(destination);
  const sameShape =
    from.size === to.size && [...from].every(([week, ids]) => (to.get(week)?.length ?? -1) === ids.length);
  const pairs = new Map<string, string>();
  if (sameShape) for (const [week, ids] of to) ids.forEach((id, n) => pairs.set(id, from.get(week)![n]));
  return { sameShape, pairs };
}

/**
 * Progress of an OCCURRENCE revision against the targets: each workout counts the exercises included in its emptiest session
 * (a session with fewer than the target is pending, never filled in). A workout with no session yet counts 0.
 */
export function occurrenceCounts(
  slots: WorkoutSlot[],
  perOccurrence: Array<{ phaseIndex: number; label: string; included: number }>,
): Array<WorkoutSlot & { count: number }> {
  return slots.map((slot) => {
    const counts = perOccurrence.filter((o) => o.phaseIndex === slot.phaseIndex && o.label === slot.label).map((o) => o.included);
    return { ...slot, count: counts.length ? Math.min(...counts) : 0 };
  });
}

/** Which sessions an edit per session covers (design §6.1 `dose-form`): this one, this one and the later weeks, or the whole phase. */
export type SessionScope = "ONLY" | "FROM_WEEK" | "PHASE";

/**
 * The sessions of the same workout an edit reaches from one session, and the dose ids of one exercise in them. Sessions of other
 * workouts are never reached. Pure: the editor computes the ids from what the page read and the repository checks them again.
 */
export function sessionTargets(
  sessions: Array<{ id: string; week: number; label: string; items: Array<{ id: string; prescribedExerciseId: string }> }>,
  from: { sessionId: string; prescribedExerciseId?: string },
  scope: SessionScope,
): { sessionIds: string[]; itemIds: string[] } {
  const origin = sessions.find((s) => s.id === from.sessionId);
  if (!origin) return { sessionIds: [], itemIds: [] };
  const reached = sessions.filter(
    (s) => s.label === origin.label && (scope === "PHASE" || (scope === "FROM_WEEK" ? s.week >= origin.week : s.id === origin.id)),
  );
  return {
    sessionIds: reached.map((s) => s.id),
    itemIds: from.prescribedExerciseId
      ? reached.flatMap((s) => s.items.filter((x) => x.prescribedExerciseId === from.prescribedExerciseId).map((x) => x.id))
      : [],
  };
}
