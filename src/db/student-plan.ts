import type { D1Database } from "@cloudflare/workers-types";
import type { PeriodizationSchedule } from "@/modules/training/contracts";
import { workoutLabels } from "@/modules/training/periodization";
import type { VideoStatus } from "@/modules/biblioteca/contracts";
import { activeUser } from "./students";

/**
 * What a client sees of the training: only revisions a professional approved AND delivered,
 * only for a student the login is actively linked to. Drafts, structures that were never
 * delivered, private library notes and authorship are not part of this data.
 */
export interface StudentExercise {
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
}
export interface StudentWorkout {
  label: string;
  exercises: StudentExercise[];
}
export interface StudentPhase {
  index: number;
  startDate: string;
  endDate: string;
  weeks: number;
  sessionsPerWeek: number;
  split: string;
  workouts: StudentWorkout[];
}
export interface StudentTrainingPlan {
  planId: string;
  title: string;
  revisionNumber: number;
  deliveredAt: string;
  startDate: string;
  endDate: string;
  phases: StudentPhase[];
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
         r.start_date AS startDate, r.end_date AS endDate, r.schedule_json AS scheduleJson
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
    .all<{
      planId: string;
      title: string;
      revisionId: string;
      organizationId: string;
      revisionNumber: number;
      deliveredAt: string;
      startDate: string;
      endDate: string;
      scheduleJson: string;
    }>();
  if (revisions.results.length === 0) return [];
  // The ids below came from the gated query above.
  const items = await db
    .prepare(
      `SELECT pe.revision_id AS revisionId, pe.phase_index AS phaseIndex,
         pe.workout_label AS workoutLabel, pe.name, pe.video_url AS videoUrl,
         pe.video_status AS videoStatus, pe.sets, pe.reps,
         pe.load_instruction AS loadInstruction, pe.cadence, pe.rest_seconds AS restSeconds,
         pe.rest_text AS restText, pe.rir_min AS rirMin, pe.rir_max AS rirMax, pe.notes
       FROM prescribed_exercises pe
       WHERE pe.revision_id IN (SELECT value FROM json_each(?1))
       ORDER BY pe.revision_id, pe.phase_index, pe.workout_label, pe.position`,
    )
    .bind(JSON.stringify(revisions.results.map((revision) => revision.revisionId)))
    .all<StudentExercise & { revisionId: string; phaseIndex: number; workoutLabel: string }>();
  return revisions.results.map((revision) => {
    const schedule = JSON.parse(revision.scheduleJson) as PeriodizationSchedule;
    const mine = items.results.filter((item) => item.revisionId === revision.revisionId);
    return {
      planId: revision.planId,
      title: revision.title,
      revisionNumber: revision.revisionNumber,
      deliveredAt: revision.deliveredAt,
      startDate: revision.startDate,
      endDate: revision.endDate,
      phases: schedule.phases.map((phase) => ({
        index: phase.index,
        startDate: phase.startDate,
        endDate: phase.endDate,
        weeks: phase.weeks,
        sessionsPerWeek: phase.sessionsPerWeek,
        split: phase.split,
        workouts: workoutLabels(phase.split).map((label) => ({
          label,
          exercises: mine
            .filter((item) => item.phaseIndex === phase.index && item.workoutLabel === label)
            .map((item) => ({
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
