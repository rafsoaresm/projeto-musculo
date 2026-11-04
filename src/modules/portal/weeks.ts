import type { StudentPhase, StudentTrainingPlan, StudentWeek } from "@/db/student-plan";
import { storedDoseText } from "@/modules/prescricao/describe";

/**
 * Reading a delivered OCCURRENCE revision week by week (motor S8, design §5.2). Pure: the stored doses are shown as stored, nothing
 * is computed from them. TEMPLATE revisions never come here.
 */

/** The phase and week shown: the ones asked for when they exist, otherwise the week of today, otherwise the first. */
export function selectedWeek(
  plan: StudentTrainingPlan,
  today: string,
  asked: { phase?: number | null; week?: number | null } = {},
): { phase: number; week: number } | null {
  const phases = plan.phases.filter((phase) => phase.weeksDetail && phase.weeksDetail.length > 0);
  if (phases.length === 0) return null;
  const pick = (phase: StudentPhase) => {
    const weeks = phase.weeksDetail!;
    const exact = weeks.find((week) => week.index === asked.week);
    if (asked.phase === phase.index && exact) return exact.index;
    const now = weeks.find((week) => today >= week.startDate && today <= week.endDate);
    if (now) return now.index;
    return today > phase.endDate ? weeks[weeks.length - 1].index : weeks[0].index;
  };
  const askedPhase = phases.find((phase) => phase.index === asked.phase);
  if (askedPhase) return { phase: askedPhase.index, week: pick(askedPhase) };
  const current = phases.find((phase) => today >= phase.startDate && today <= phase.endDate);
  const phase = current ?? (today > plan.endDate ? phases[phases.length - 1] : phases[0]);
  return { phase: phase.index, week: pick(phase) };
}

/** A whole number from the address, or null. */
export const queryNumber = (value: string | string[] | undefined): number | null =>
  typeof value === "string" && /^\d{1,3}$/.test(value) ? Number(value) : null;

export interface ProgressionRow {
  exerciseId: string;
  name: string;
  /** One cell per week of the phase: the stored doses of that week ("/" between different ones), "—" when left out, "" when the workout has no session that week. */
  cells: string[];
}

/** "Progressão nesta fase": each exercise of one workout across the weeks, with the stored dose text of each week. */
export function progressionOf(weeks: StudentWeek[], label: string): ProgressionRow[] {
  const order: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();
  for (const week of weeks)
    for (const session of week.sessions)
      if (session.label === label)
        for (const exercise of session.exercises)
          if (!seen.has(exercise.id)) {
            seen.add(exercise.id);
            order.push({ id: exercise.id, name: exercise.name });
          }
  return order.map(({ id, name }) => ({
    exerciseId: id,
    name,
    cells: weeks.map((week) => {
      const sessions = week.sessions.filter((session) => session.label === label);
      if (sessions.length === 0) return "";
      const texts = sessions.flatMap((session) =>
        session.exercises.filter((exercise) => exercise.id === id).map((exercise) => storedDoseText(exercise) || "Sem parâmetros definidos"),
      );
      return texts.length === 0 ? "—" : [...new Set(texts)].join(" / ");
    }),
  }));
}

/** "Semana 2, sessão 1": how a session of the week is named to the student. */
export const sessionName = (session: { week: number; slot: number }) => `Semana ${session.week}, sessão ${session.slot}`;

/** The session of an OCCURRENCE plan with this id, with its phase; null when it is not one of them. */
export function findSession(plan: StudentTrainingPlan, occurrenceId: string | null) {
  if (!occurrenceId) return null;
  for (const phase of plan.phases)
    for (const week of phase.weeksDetail ?? [])
      for (const session of week.sessions) if (session.id === occurrenceId) return { phase, week, session };
  return null;
}
