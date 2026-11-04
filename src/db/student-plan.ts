import type { D1Database } from "@cloudflare/workers-types";
import type { PeriodizationSchedule, SchedulePhase } from "@/modules/training/contracts";
import { phaseDivisionText, phaseName, phaseWorkouts } from "@/modules/training/periodization";
import type { VideoStatus } from "@/modules/biblioteca/contracts";
import { activeUser } from "./students";

/**
 * What a client sees of the training: only revisions a professional approved AND delivered,
 * only for a student the login is actively linked to. Drafts, structures that were never
 * delivered, private library notes and authorship are not part of this data.
 */
export interface StudentExercise {
  /** The prescribed exercise this is, so the student's log can point at it. */
  id: string;
  name: string;
  videoUrl: string | null;
  videoStatus: VideoStatus;
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
  notes: string | null;
  /**
   * OCCURRENCE revisions only (motor S8): the dose text stored when the dose was written; null when it was typed field by field.
   * Absent for TEMPLATE revisions, whose exercises are read exactly as before. Show it with `storedDoseText`.
   */
  doseText?: string | null;
  /**
   * OCCURRENCE revisions only: the metric of the stored structured dose ("REPS", "TIME"…), so the student's log offers the matching
   * optional fields. Null for a dose typed field by field. Never the structured dose itself.
   */
  metric?: string | null;
}
/** One session of one week of an OCCURRENCE revision, with the exercises included in it and their stored doses. */
export interface StudentSession {
  /** `plan_session_occurrences.id`: the student's log of this session points at it. */
  id: string;
  week: number;
  slot: number;
  label: string;
  /** Free name of the v2 workout ("Superior"); null for v1. */
  name: string | null;
  plannedDate: string | null;
  exercises: StudentExercise[];
}
export interface StudentWeek {
  index: number;
  startDate: string;
  endDate: string;
  sessions: StudentSession[];
}
/** TEMPLATE: one dose per exercise for the whole phase (every revision before 0041). OCCURRENCE: a dose per session. */
export type PrescriptionModel = "TEMPLATE" | "OCCURRENCE";
export interface StudentWorkout {
  label: string;
  /** Free name of a v2 workout ("Superior"); null (or absent) for v1. */
  name?: string | null;
  exercises: StudentExercise[];
}
export interface StudentPhase {
  index: number;
  startDate: string;
  endDate: string;
  weeks: number;
  sessionsPerWeek: number;
  /** The division as written for people: the v1 split exactly ("ABC"), or the v2 labels ("Superior / Inferior"). */
  split: string;
  /** Free name of a v2 phase ("Adaptação"); null (or absent) for v1. */
  name?: string | null;
  /**
   * TEMPLATE: the exercises of each workout with their dose. OCCURRENCE: the exercises that appear in some session of the
   * workout, each with the dose of the first session it appears in ("Dose da primeira sessão"); the doses per week are in `weeksDetail`.
   */
  workouts: StudentWorkout[];
  /** OCCURRENCE only: every week of the phase with its sessions, as stored. Absent for TEMPLATE. */
  weeksDetail?: StudentWeek[];
}
export interface StudentTrainingPlan {
  planId: string;
  revisionId: string;
  title: string;
  revisionNumber: number;
  deliveredAt: string;
  /**
   * Display name of the professional who delivered it, as it was at the moment of the delivery (slice 0.90; a later rename in Configurações does
   * not change it). Null when they had no professional record then.
   */
  deliveredBy: string | null;
  /** Name of the workspace at the moment of the delivery (slice 0.90). Null only for a row that somehow lacks it. */
  deliveredOrganizationName: string | null;
  startDate: string;
  endDate: string;
  /** Absent reads as TEMPLATE. */
  prescriptionModel?: PrescriptionModel;
  phases: StudentPhase[];
}

/** A delivered revision, as read by the gated queries of this module and of plan-documents. */
export interface DeliveredRevisionRow {
  planId: string;
  title: string;
  revisionId: string;
  organizationId: string;
  revisionNumber: number;
  deliveredAt: string;
  deliveredBy: string | null;
  deliveredOrganizationName: string | null;
  startDate: string;
  endDate: string;
  scheduleJson: string;
  /** 0041; TEMPLATE for every revision written before it. */
  prescriptionModel: PrescriptionModel;
}

interface OccurrenceRow {
  occurrenceId: string;
  revisionId: string;
  phaseIndex: number;
  weekIndex: number;
  slotIndex: number;
  label: string;
  plannedDate: string | null;
  prescribedExerciseId: string | null;
  name: string | null;
  videoUrl: string | null;
  videoStatus: VideoStatus | null;
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
  notes: string | null;
  doseText: string | null;
  metric: string | null;
}

/**
 * The sessions of OCCURRENCE revisions with the doses included in each (design §5.2). Stored columns only, named one by one: never
 * the trace, the structured dose or the proposal item a dose came from. Sessions with nothing included still come back (empty).
 * The revisions must come from a query that already checked access; each is matched on its organization too.
 */
async function occurrencesOf(db: D1Database, revisions: DeliveredRevisionRow[]): Promise<OccurrenceRow[]> {
  const wanted = revisions.filter((revision) => revision.prescriptionModel === "OCCURRENCE");
  if (wanted.length === 0) return [];
  const result = await db
    .prepare(
      `SELECT o.id AS occurrenceId, o.revision_id AS revisionId, o.phase_index AS phaseIndex, o.week_index AS weekIndex,
         o.slot_index AS slotIndex, o.workout_label AS label, o.planned_date AS plannedDate,
         x.prescribed_exercise_id AS prescribedExerciseId, pe.name, pe.video_url AS videoUrl, pe.video_status AS videoStatus,
         x.sets, x.reps, x.load_instruction AS loadInstruction, x.cadence, x.rest_seconds AS restSeconds,
         x.rest_text AS restText, x.rir_min AS rirMin, x.rir_max AS rirMax, x.notes, x.dose_text AS doseText,
         CASE WHEN json_valid(x.dose_json) THEN json_extract(x.dose_json, '$.metric') END AS metric
       FROM json_each(?1) j
       JOIN plan_session_occurrences o ON o.revision_id = json_extract(j.value, '$.r')
         AND o.organization_id = json_extract(j.value, '$.o')
       LEFT JOIN prescribed_exercise_occurrences x ON x.organization_id = o.organization_id AND x.occurrence_id = o.id
         AND x.included = 1
       LEFT JOIN prescribed_exercises pe ON pe.organization_id = x.organization_id AND pe.id = x.prescribed_exercise_id
         AND pe.revision_id = o.revision_id
       ORDER BY o.revision_id, o.phase_index, o.week_index, o.slot_index, pe.position, pe.id`,
    )
    .bind(JSON.stringify(wanted.map((revision) => ({ r: revision.revisionId, o: revision.organizationId }))))
    .all<OccurrenceRow>();
  return result.results;
}

const occurrenceExercise = (row: OccurrenceRow): StudentExercise => ({
  id: row.prescribedExerciseId!,
  name: row.name!,
  videoUrl: row.videoUrl,
  videoStatus: row.videoStatus!,
  sets: row.sets,
  reps: row.reps,
  loadInstruction: row.loadInstruction,
  cadence: row.cadence,
  restSeconds: row.restSeconds,
  restText: row.restText,
  rirMin: row.rirMin,
  rirMax: row.rirMax,
  notes: row.notes,
  doseText: row.doseText,
  metric: row.metric,
});

/** The weeks of one phase of an OCCURRENCE revision, from the saved schedule and the stored sessions. */
function weeksOf(phase: SchedulePhase, rows: OccurrenceRow[]): StudentWeek[] {
  const names = new Map(phaseWorkouts(phase).map((workout) => [workout.label, workout.name]));
  const sessions = new Map<string, StudentSession>();
  for (const row of rows) {
    let session = sessions.get(row.occurrenceId);
    if (!session) {
      session = {
        id: row.occurrenceId,
        week: row.weekIndex,
        slot: row.slotIndex,
        label: row.label,
        name: names.get(row.label) ?? null,
        plannedDate: row.plannedDate,
        exercises: [],
      };
      sessions.set(row.occurrenceId, session);
    }
    if (row.prescribedExerciseId && row.name !== null) session.exercises.push(occurrenceExercise(row));
  }
  const all = [...sessions.values()];
  return phase.microcycles.map((week) => ({
    index: week.index,
    startDate: week.startDate,
    endDate: week.endDate,
    sessions: all.filter((session) => session.week === week.index),
  }));
}

/** "Dose da primeira sessão": each exercise that appears in a session of the workout, with the dose of the first one. */
function firstDoses(weeks: StudentWeek[], label: string): StudentExercise[] {
  const seen = new Map<string, StudentExercise>();
  const order: string[] = [];
  for (const week of weeks)
    for (const session of week.sessions)
      if (session.label === label)
        for (const exercise of session.exercises)
          if (!seen.has(exercise.id)) {
            seen.set(exercise.id, exercise);
            order.push(exercise.id);
          }
  return order.map((exerciseId) => seen.get(exerciseId)!);
}

const header = (revision: DeliveredRevisionRow) => ({
  planId: revision.planId,
  revisionId: revision.revisionId,
  title: revision.title,
  revisionNumber: revision.revisionNumber,
  deliveredAt: revision.deliveredAt,
  deliveredBy: revision.deliveredBy,
  deliveredOrganizationName: revision.deliveredOrganizationName,
  startDate: revision.startDate,
  endDate: revision.endDate,
  prescriptionModel: revision.prescriptionModel,
});
const phaseHeader = (phase: SchedulePhase) => ({
  index: phase.index,
  startDate: phase.startDate,
  endDate: phase.endDate,
  weeks: phase.weeks,
  sessionsPerWeek: phase.sessionsPerWeek,
  split: phaseDivisionText(phase),
  name: phaseName(phase),
});

/**
 * Turns delivered revisions into what is read: phases, workouts and the exercises exactly as
 * they were delivered. The rows must come from a query that already checked access.
 */
export async function assembleDelivered(
  db: D1Database,
  revisions: DeliveredRevisionRow[],
): Promise<StudentTrainingPlan[]> {
  if (revisions.length === 0) return [];
  // TEMPLATE revisions: the same query as before 0041, over those revisions only.
  const templates = revisions.filter((revision) => revision.prescriptionModel !== "OCCURRENCE");
  const [items, occurrences] = await Promise.all([
    templates.length === 0
      ? { results: [] as Array<StudentExercise & { revisionId: string; phaseIndex: number; workoutLabel: string }> }
      : db
    .prepare(
      `SELECT pe.id, pe.revision_id AS revisionId, pe.phase_index AS phaseIndex,
         pe.workout_label AS workoutLabel, pe.name, pe.video_url AS videoUrl,
         pe.video_status AS videoStatus, pe.sets, pe.reps,
         pe.load_instruction AS loadInstruction, pe.cadence, pe.rest_seconds AS restSeconds,
         pe.rest_text AS restText, pe.rir_min AS rirMin, pe.rir_max AS rirMax, pe.notes
       FROM prescribed_exercises pe
       WHERE pe.revision_id IN (SELECT value FROM json_each(?1))
       ORDER BY pe.revision_id, pe.phase_index, pe.workout_label, pe.position`,
    )
    .bind(JSON.stringify(templates.map((revision) => revision.revisionId)))
    .all<StudentExercise & { revisionId: string; phaseIndex: number; workoutLabel: string }>(),
    occurrencesOf(db, revisions),
  ]);
  return revisions.map((revision) => {
    const schedule = JSON.parse(revision.scheduleJson) as PeriodizationSchedule;
    if (revision.prescriptionModel === "OCCURRENCE") {
      const mine = occurrences.filter((row) => row.revisionId === revision.revisionId);
      return {
        ...header(revision),
        phases: schedule.phases.map((phase) => {
          const weeks = weeksOf(phase, mine.filter((row) => row.phaseIndex === phase.index));
          return {
            ...phaseHeader(phase),
            workouts: phaseWorkouts(phase).map(({ label, name }) => ({ label, name, exercises: firstDoses(weeks, label) })),
            weeksDetail: weeks,
          };
        }),
      };
    }
    const mine = items.results.filter((item) => item.revisionId === revision.revisionId);
    return {
      ...header(revision),
      phases: schedule.phases.map((phase) => ({
        ...phaseHeader(phase),
        workouts: phaseWorkouts(phase).map(({ label, name }) => ({
          label,
          name,
          exercises: mine
            .filter((item) => item.phaseIndex === phase.index && item.workoutLabel === label)
            .map((item) => ({
              id: item.id,
              name: item.name,
              videoUrl: item.videoUrl,
              videoStatus: item.videoStatus,
              sets: item.sets,
              reps: item.reps,
              loadInstruction: item.loadInstruction,
              cadence: item.cadence,
              restSeconds: item.restSeconds,
              restText: item.restText,
              rirMin: item.rirMin,
              rirMax: item.rirMax,
              notes: item.notes,
            })),
        })),
      })),
    };
  });
}

/** The newest delivered revision of each plan of this student. */
export async function studentTrainingFor(
  db: D1Database,
  userId: string,
  studentId: string,
): Promise<StudentTrainingPlan[]> {
  if (!userId?.trim() || !studentId?.trim()) return [];
  const revisions = await db
    .prepare(
      `SELECT p.id AS planId, p.title, r.id AS revisionId, r.organization_id AS organizationId,
         r.revision_number AS revisionNumber, r.delivered_at AS deliveredAt,
         r.delivered_by_name AS deliveredBy, r.delivered_organization_name AS deliveredOrganizationName,
         r.start_date AS startDate, r.end_date AS endDate, r.schedule_json AS scheduleJson,
         r.prescription_model AS prescriptionModel
       FROM student_access sa
       JOIN students s ON s.organization_id = sa.organization_id AND s.id = sa.student_id
       JOIN training_plans p ON p.organization_id = s.organization_id AND p.student_id = s.id
       JOIN plan_revisions r ON r.organization_id = p.organization_id AND r.plan_id = p.id
       WHERE sa.user_id = ?1 AND sa.student_id = ?2 AND sa.revoked_at IS NULL
         AND ${activeUser("?1")} AND r.state = 'DELIVERED'
         AND r.delivered_at = (SELECT MAX(x.delivered_at) FROM plan_revisions x
                                 WHERE x.plan_id = p.id AND x.state = 'DELIVERED')
       ORDER BY r.delivered_at DESC, p.id`,
    )
    .bind(userId, studentId)
    .all<DeliveredRevisionRow>();
  // The rows above came from the gated query.
  return assembleDelivered(db, revisions.results);
}
