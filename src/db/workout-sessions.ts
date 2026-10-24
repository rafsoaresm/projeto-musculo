import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  EDIT_WINDOW_HOURS,
  parseSession,
  todayInBrazil,
  type SessionInput,
} from "@/modules/execucao/contracts";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * What a student did in a workout. Execution is not prescription: a session points at the
 * delivered revision and at its prescribed exercises and copies nothing back, so the delivered
 * plan stays exactly as it was delivered.
 *
 * The student writes, only about themselves: an active link between the login and the student,
 * the newest delivered revision of one of that student's plans, and exercises that belong to that
 * very workout. A report of pain or discomfort, and a session the professional has read, are frozen
 * (also by triggers). The professional reads, with an active technical assignment over the student,
 * and records a reading as an append-only note. Nothing here changes a plan.
 */
export interface SessionSetRow {
  setNumber: number;
  reps: number | null;
  loadKg: number | null;
}
export interface SessionExerciseRow {
  prescribedExerciseId: string;
  name: string;
  position: number;
  done: boolean;
  rir: number | null;
  pain: boolean;
  notes: string | null;
  sets: SessionSetRow[];
}
export interface SessionSummary {
  id: string;
  performedOn: string;
  phaseIndex: number;
  workoutLabel: string;
  effort: number | null;
  painReported: boolean;
  createdAt: string;
}
export interface StudentSession extends SessionSummary {
  planId: string;
  revisionId: string;
  notes: string | null;
  updatedAt: string;
  acknowledged: boolean;
  /** The student can still correct it: no report of pain, not read, and within the window. */
  editable: boolean;
  exercises: SessionExerciseRow[];
}
export type SaveOutcome =
  | { status: "saved"; id: string; created: boolean; painReported: boolean }
  | { status: "locked" }
  | { status: "conflict" }
  | { status: "not_found" }
  | { status: "invalid" };
export type RemoveSessionOutcome = { status: "removed" } | { status: "locked" } | { status: "not_found" };

const windowMs = EDIT_WINDOW_HOURS * 3_600_000;
const withinWindow = (createdAt: string, now: Date) => now.getTime() - Date.parse(createdAt) <= windowMs;

interface SessionRow {
  id: string;
  planId: string;
  revisionId: string;
  phaseIndex: number;
  workoutLabel: string;
  performedOn: string;
  effort: number | null;
  pain: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  loggedBy: string;
  acknowledged: number;
}
interface ExerciseSetRow {
  sessionExerciseId: string;
  prescribedExerciseId: string;
  name: string;
  position: number;
  done: number;
  rir: number | null;
  pain: number;
  notes: string | null;
  setNumber: number | null;
  reps: number | null;
  loadKg: number | null;
}

/** Exercises with their sets, in the order of the workout, for the given sessions (already gated). */
async function exercisesOf(db: D1Database, sessionIds: string[]) {
  if (sessionIds.length === 0) return new Map<string, SessionExerciseRow[]>();
  const rows = await db
    .prepare(
      `SELECT se.session_id AS sessionId, se.id AS sessionExerciseId,
         se.prescribed_exercise_id AS prescribedExerciseId, se.exercise_name AS name,
         se.position, se.done, se.rir, se.pain, se.notes,
         st.set_number AS setNumber, st.reps, st.load_kg AS loadKg
       FROM session_exercises se
       LEFT JOIN session_sets st ON st.session_exercise_id = se.id
       WHERE se.session_id IN (SELECT value FROM json_each(?1))
       ORDER BY se.session_id, se.position, se.id, st.set_number`,
    )
    .bind(JSON.stringify(sessionIds))
    .all<ExerciseSetRow & { sessionId: string }>();
  const bySession = new Map<string, SessionExerciseRow[]>();
  const byExercise = new Map<string, SessionExerciseRow>();
  for (const row of rows.results) {
    let exercise = byExercise.get(row.sessionExerciseId);
    if (!exercise) {
      exercise = {
        prescribedExerciseId: row.prescribedExerciseId,
        name: row.name,
        position: row.position,
        done: Boolean(row.done),
        rir: row.rir,
        pain: Boolean(row.pain),
        notes: row.notes,
        sets: [],
      };
      byExercise.set(row.sessionExerciseId, exercise);
      bySession.set(row.sessionId, [...(bySession.get(row.sessionId) ?? []), exercise]);
    }
    if (row.setNumber !== null)
      exercise.sets.push({ setNumber: row.setNumber, reps: row.reps, loadKg: row.loadKg });
  }
  return bySession;
}

const summaryColumns = `ws.id, ws.performed_on AS performedOn, ws.phase_index AS phaseIndex,
  ws.workout_label AS workoutLabel, ws.effort, ws.pain_reported AS pain, ws.created_at AS createdAt`;

/** The student's side: logs about themselves, through the verified link of their login. */
export function studentSessionsFor(db: D1Database, userId: string) {
  if (!userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  // ?1 is always the acting login.
  const linked = (session: string) => `EXISTS (SELECT 1 FROM student_access sa
    WHERE sa.organization_id = ${session}.organization_id AND sa.student_id = ${session}.student_id
      AND sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")})`;
  const owned = (sessionParam: string) => `EXISTS (SELECT 1 FROM workout_sessions ws
    WHERE ws.id = ${sessionParam} AND ws.logged_by_user_id = ?1 AND ${linked("ws")})`;

  const api = {
    /** The student's own logs of one workout, newest first. */
    async forWorkout(
      studentId: string,
      planId: string,
      phaseIndex: number,
      workoutLabel: string,
      now = new Date(),
    ): Promise<Array<SessionSummary & { editable: boolean; acknowledged: boolean }>> {
      const result = await db
        .prepare(
          `SELECT ${summaryColumns}, ws.logged_by_user_id AS loggedBy,
             EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = ws.id) AS acknowledged
           FROM workout_sessions ws
           JOIN plan_revisions r ON r.organization_id = ws.organization_id AND r.id = ws.revision_id
           WHERE ws.student_id = ?2 AND r.plan_id = ?3 AND ws.phase_index = ?4 AND ws.workout_label = ?5
             AND ${linked("ws")}
           ORDER BY ws.performed_on DESC, ws.created_at DESC LIMIT 10`,
        )
        .bind(userId, studentId, planId, phaseIndex, workoutLabel)
        .all<Omit<SessionSummary, "painReported"> & { pain: number; acknowledged: number; loggedBy: string }>();
      return result.results.map(({ pain, acknowledged, loggedBy, ...row }) => ({
        ...row,
        painReported: Boolean(pain),
        acknowledged: Boolean(acknowledged),
        editable: loggedBy === userId && !pain && !acknowledged && withinWindow(row.createdAt, now),
      }));
    },

    async get(sessionId: string, now = new Date()): Promise<StudentSession | null> {
      const row = await db
        .prepare(
          `SELECT ${summaryColumns}, r.plan_id AS planId, ws.revision_id AS revisionId, ws.notes,
             ws.updated_at AS updatedAt, ws.logged_by_user_id AS loggedBy,
             EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = ws.id) AS acknowledged
           FROM workout_sessions ws
           JOIN plan_revisions r ON r.organization_id = ws.organization_id AND r.id = ws.revision_id
           WHERE ws.id = ?2 AND ${linked("ws")}`,
        )
        .bind(userId, sessionId)
        .first<SessionRow>();
      if (!row) return null;
      const exercises = (await exercisesOf(db, [row.id])).get(row.id) ?? [];
      return {
        id: row.id,
        planId: row.planId,
        revisionId: row.revisionId,
        phaseIndex: row.phaseIndex,
        workoutLabel: row.workoutLabel,
        performedOn: row.performedOn,
        effort: row.effort,
        painReported: Boolean(row.pain),
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        acknowledged: Boolean(row.acknowledged),
        editable: row.loggedBy === userId && !row.pain && !row.acknowledged && withinWindow(row.createdAt, now),
        exercises,
      };
    },

    /**
     * Creates the log of a workout for a day, or corrects the one of that day while it is still
     * editable. Throws a ZodError for a malformed log, which nothing is written for.
     */
    async save(studentId: string, raw: unknown, now = new Date()): Promise<SaveOutcome> {
      const input: SessionInput = parseSession(raw, todayInBrazil(now));
      const stamp = now.toISOString();

      // The newest delivered revision of the plan, for a student this login is linked to.
      const target = await db
        .prepare(
          `SELECT r.id AS revisionId, r.organization_id AS organizationId
           FROM student_access sa
           JOIN students s ON s.organization_id = sa.organization_id AND s.id = sa.student_id
           JOIN training_plans p ON p.organization_id = s.organization_id AND p.student_id = s.id
           JOIN plan_revisions r ON r.organization_id = p.organization_id AND r.plan_id = p.id
           WHERE sa.user_id = ?1 AND sa.student_id = ?2 AND sa.revoked_at IS NULL AND ${activeUser("?1")}
             AND p.id = ?3 AND r.state = 'DELIVERED'
             AND r.delivered_at = (SELECT MAX(x.delivered_at) FROM plan_revisions x
                                     WHERE x.plan_id = p.id AND x.state = 'DELIVERED')`,
        )
        .bind(userId, studentId, input.planId)
        .first<{ revisionId: string; organizationId: string }>();
      if (!target) return { status: "not_found" };

      const prescribed = await db
        .prepare(
          `SELECT id, name, position FROM prescribed_exercises
           WHERE organization_id = ?1 AND revision_id = ?2 AND phase_index = ?3 AND workout_label = ?4`,
        )
        .bind(target.organizationId, target.revisionId, input.phaseIndex, input.workoutLabel)
        .all<{ id: string; name: string; position: number }>();
      if (prescribed.results.length === 0) return { status: "not_found" };
      const byId = new Map(prescribed.results.map((exercise) => [exercise.id, exercise]));
      if (input.exercises.some((exercise) => !byId.has(exercise.prescribedExerciseId)))
        return { status: "invalid" };

      const existing = await db
        .prepare(
          `SELECT id, pain_reported AS pain, created_at AS createdAt, logged_by_user_id AS loggedBy,
             EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = workout_sessions.id) AS acknowledged
           FROM workout_sessions
           WHERE student_id = ?1 AND revision_id = ?2 AND phase_index = ?3 AND workout_label = ?4
             AND performed_on = ?5`,
        )
        .bind(studentId, target.revisionId, input.phaseIndex, input.workoutLabel, input.performedOn)
        .first<{ id: string; pain: number; createdAt: string; loggedBy: string; acknowledged: number }>();
      if (existing && (existing.loggedBy !== userId || existing.pain || existing.acknowledged || !withinWindow(existing.createdAt, now)))
        return { status: "locked" };

      const sessionId = existing?.id ?? crypto.randomUUID();
      const statements: D1PreparedStatement[] = [];
      if (existing) {
        statements.push(
          db
            .prepare(
              `UPDATE workout_sessions SET effort = ?3, notes = ?4, updated_at = ?5
               WHERE id = ?2 AND ${owned("?2")}`,
            )
            .bind(userId, sessionId, input.effort, input.notes, stamp),
          db
            .prepare(
              `DELETE FROM session_sets WHERE ${owned("?2")}
                 AND session_exercise_id IN (SELECT id FROM session_exercises WHERE session_id = ?2)`,
            )
            .bind(userId, sessionId),
          db
            .prepare(`DELETE FROM session_exercises WHERE session_id = ?2 AND ${owned("?2")}`)
            .bind(userId, sessionId),
        );
      } else {
        statements.push(
          db
            .prepare(
              `INSERT INTO workout_sessions
                 (id, organization_id, student_id, revision_id, phase_index, workout_label, performed_on,
                  effort, pain_reported, notes, logged_by_user_id, created_at, updated_at)
               SELECT ?2, s.organization_id, s.id, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?1, ?9, ?9
               FROM students s
               WHERE s.id = ?10 AND s.organization_id = ?11
                 AND EXISTS (SELECT 1 FROM student_access sa
                   WHERE sa.organization_id = s.organization_id AND sa.student_id = s.id
                     AND sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")})`,
            )
            .bind(
              userId, sessionId, target.revisionId, input.phaseIndex, input.workoutLabel,
              input.performedOn, input.effort, input.notes, stamp, studentId, target.organizationId,
            ),
        );
      }
      for (const exercise of input.exercises) {
        const prescribedRow = byId.get(exercise.prescribedExerciseId)!;
        const exerciseId = crypto.randomUUID();
        statements.push(
          db
            .prepare(
              `INSERT INTO session_exercises
                 (id, organization_id, session_id, prescribed_exercise_id, exercise_name, position,
                  done, rir, pain, notes)
               SELECT ?3, ?4, ?2, ?5, ?6, ?7, ?8, ?9, ?10, ?11
               WHERE ${owned("?2")}`,
            )
            .bind(
              userId, sessionId, exerciseId, target.organizationId, prescribedRow.id, prescribedRow.name,
              prescribedRow.position, exercise.done ? 1 : 0, exercise.rir, exercise.pain ? 1 : 0, exercise.notes,
            ),
        );
        exercise.sets.forEach((set, index) =>
          statements.push(
            db
              .prepare(
                `INSERT INTO session_sets (id, organization_id, session_exercise_id, set_number, reps, load_kg)
                 SELECT ?3, ?4, ?5, ?6, ?7, ?8
                 WHERE EXISTS (SELECT 1 FROM session_exercises se WHERE se.id = ?5 AND ${owned("se.session_id")})`,
              )
              .bind(
                userId, sessionId, crypto.randomUUID(), target.organizationId, exerciseId, index + 1,
                set.reps, set.loadKg,
              ),
          ),
        );
      }
      // The report is set last: from here on the session and what is under it are frozen.
      if (input.painReported)
        statements.push(
          db
            .prepare(
              `UPDATE workout_sessions SET pain_reported = 1, updated_at = ?3
               WHERE id = ?2 AND ${owned("?2")}`,
            )
            .bind(userId, sessionId, stamp),
        );
      try {
        const results = await db.batch(statements);
        if ((results[0].meta.changes ?? 0) === 0) return { status: "not_found" };
      } catch (error) {
        const message = String(error);
        if (message.includes("WORKOUT_SESSION_FROZEN")) return { status: "locked" };
        if (message.includes("UNIQUE")) return { status: "conflict" };
        if (message.includes("SESSION_REVISION_INVALID")) return { status: "not_found" };
        if (message.includes("SESSION_EXERCISE_INVALID")) return { status: "invalid" };
        throw error;
      }
      return { status: "saved", id: sessionId, created: !existing, painReported: input.painReported };
    },

    /** Deletes a log the student can still correct. A report of pain, or a log that was read, stays. */
    async remove(sessionId: string, now = new Date()): Promise<RemoveSessionOutcome> {
      const current = await api.get(sessionId, now);
      if (!current) return { status: "not_found" };
      if (!current.editable) return { status: "locked" };
      try {
        const results = await db.batch([
          db
            .prepare(
              `DELETE FROM session_sets WHERE ${owned("?2")}
                 AND session_exercise_id IN (SELECT id FROM session_exercises WHERE session_id = ?2)`,
            )
            .bind(userId, sessionId),
          db
            .prepare(`DELETE FROM session_exercises WHERE session_id = ?2 AND ${owned("?2")}`)
            .bind(userId, sessionId),
          db
            .prepare(`DELETE FROM workout_sessions WHERE id = ?2 AND ${owned("?2")}`)
            .bind(userId, sessionId),
        ]);
        return results[2].meta.changes > 0 ? { status: "removed" } : { status: "not_found" };
      } catch (error) {
        if (String(error).includes("WORKOUT_SESSION_FROZEN")) return { status: "locked" };
        throw error;
      }
    },
  };
  return api;
}

export interface ExecutionRow extends SessionSummary {
  planTitle: string;
  revisionNumber: number;
  exercisesDone: number;
  exercisesPlanned: number;
  setsLogged: number;
  acknowledgedAt: string | null;
}
export interface PlannedDose {
  sets: string | null;
  reps: string | null;
  loadInstruction: string | null;
  cadence: string | null;
  restSeconds: number | null;
  restText: string | null;
  rirMin: number | null;
  rirMax: number | null;
}
export interface ExecutionDetail extends ExecutionRow {
  studentId: string;
  notes: string | null;
  exercises: Array<SessionExerciseRow & { planned: PlannedDose }>;
  /** Prescribed exercises of the workout that the student did not log at all. */
  notLogged: string[];
  acknowledgements: Array<{ reviewerName: string | null; note: string | null; createdAt: string }>;
}
export interface PainPendingRow {
  sessionId: string;
  studentId: string;
  studentName: string;
  performedOn: string;
  workoutLabel: string;
}
export type AcknowledgeOutcome = { status: "recorded" } | { status: "not_found" };
export const SESSION_READ = "WORKOUT_SESSION_READ";

/** The professional's side: reads what the student logged, with an active technical assignment. */
export function executionFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization, ?2 acting professional.
  const reach = (session: string) => `EXISTS (SELECT 1 FROM students s
    WHERE s.organization_id = ${session}.organization_id AND s.id = ${session}.student_id
      AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  const rowColumns = `${summaryColumns}, p.title AS planTitle, r.revision_number AS revisionNumber,
    (SELECT COUNT(*) FROM session_exercises se WHERE se.session_id = ws.id AND se.done = 1) AS exercisesDone,
    (SELECT COUNT(*) FROM prescribed_exercises pe WHERE pe.revision_id = ws.revision_id
       AND pe.phase_index = ws.phase_index AND pe.workout_label = ws.workout_label) AS exercisesPlanned,
    (SELECT COUNT(*) FROM session_sets st JOIN session_exercises se ON se.id = st.session_exercise_id
       WHERE se.session_id = ws.id) AS setsLogged,
    (SELECT MAX(a.created_at) FROM session_acknowledgements a WHERE a.session_id = ws.id) AS acknowledgedAt`;
  const fromRows = `FROM workout_sessions ws
    JOIN plan_revisions r ON r.organization_id = ws.organization_id AND r.id = ws.revision_id
    JOIN training_plans p ON p.organization_id = r.organization_id AND p.id = r.plan_id`;
  type RawRow = Omit<ExecutionRow, "painReported"> & { pain: number };
  const shape = ({ pain, ...row }: RawRow): ExecutionRow => ({ ...row, painReported: Boolean(pain) });

  return {
    /** The logs of one student, newest first. */
    async list(studentId: string, limit = 30): Promise<ExecutionRow[]> {
      const result = await db
        .prepare(
          `SELECT ${rowColumns} ${fromRows}
           WHERE ws.organization_id = ?1 AND ws.student_id = ?3 AND ${reach("ws")}
           ORDER BY ws.performed_on DESC, ws.created_at DESC LIMIT ?4`,
        )
        .bind(organizationId, userId, studentId, Math.max(1, Math.min(limit, 100)))
        .all<RawRow>();
      return result.results.map(shape);
    },

    /** One log with what was planned next to what was done. Null when not reachable. */
    async detail(sessionId: string): Promise<ExecutionDetail | null> {
      const row = await db
        .prepare(
          `SELECT ${rowColumns}, ws.student_id AS studentId, ws.notes ${fromRows}
           WHERE ws.organization_id = ?1 AND ws.id = ?3 AND ${reach("ws")}`,
        )
        .bind(organizationId, userId, sessionId)
        .first<RawRow & { studentId: string; notes: string | null }>();
      if (!row) return null;
      const [logged, planned, readings] = await Promise.all([
        exercisesOf(db, [sessionId]),
        db
          .prepare(
            `SELECT pe.id, pe.name, pe.position, pe.sets, pe.reps, pe.load_instruction AS loadInstruction,
               pe.cadence, pe.rest_seconds AS restSeconds, pe.rest_text AS restText,
               pe.rir_min AS rirMin, pe.rir_max AS rirMax
             FROM workout_sessions ws
             JOIN prescribed_exercises pe ON pe.revision_id = ws.revision_id
               AND pe.phase_index = ws.phase_index AND pe.workout_label = ws.workout_label
             WHERE ws.id = ?1 ORDER BY pe.position`,
          )
          .bind(sessionId)
          .all<PlannedDose & { id: string; name: string; position: number }>(),
        db
          .prepare(
            `SELECT pr.display_name AS reviewerName, a.note, a.created_at AS createdAt
             FROM session_acknowledgements a
             LEFT JOIN professionals pr ON pr.organization_id = a.organization_id AND pr.user_id = a.user_id
             WHERE a.organization_id = ?1 AND a.session_id = ?2 ORDER BY a.created_at, a.rowid`,
          )
          .bind(organizationId, sessionId)
          .all<{ reviewerName: string | null; note: string | null; createdAt: string }>(),
      ]);
      const plannedById = new Map(planned.results.map((item) => [item.id, item]));
      const exercises = (logged.get(sessionId) ?? []).map((exercise) => {
        const item = plannedById.get(exercise.prescribedExerciseId);
        return {
          ...exercise,
          planned: {
            sets: item?.sets ?? null,
            reps: item?.reps ?? null,
            loadInstruction: item?.loadInstruction ?? null,
            cadence: item?.cadence ?? null,
            restSeconds: item?.restSeconds ?? null,
            restText: item?.restText ?? null,
            rirMin: item?.rirMin ?? null,
            rirMax: item?.rirMax ?? null,
          },
        };
      });
      const seen = new Set(exercises.map((exercise) => exercise.prescribedExerciseId));
      return {
        ...shape(row),
        studentId: row.studentId,
        notes: row.notes,
        exercises,
        notLogged: planned.results.filter((item) => !seen.has(item.id)).map((item) => item.name),
        acknowledgements: readings.results,
      };
    },

    /** The professional's reading of a log, with an optional note. It never changes the log. */
    async acknowledge(sessionId: string, note: unknown, now = new Date()): Promise<AcknowledgeOutcome> {
      const text = typeof note === "string" ? note.trim() : "";
      if (text.length > 500) throw new Error("ACKNOWLEDGEMENT_NOTE_TOO_LONG");
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO session_acknowledgements (id, organization_id, session_id, user_id, note, created_at)
             SELECT ?4, ws.organization_id, ws.id, ?2, ?5, ?6
             FROM workout_sessions ws
             WHERE ws.organization_id = ?1 AND ws.id = ?3 AND ${reach("ws")}`,
          )
          .bind(organizationId, userId, sessionId, crypto.randomUUID(), text || null, stamp),
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
          )
          .bind(crypto.randomUUID(), organizationId, userId, SESSION_READ, sessionId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "recorded" } : { status: "not_found" };
    },

    /** Reports of pain or discomfort that no professional has read yet, newest first. */
    async painPending(): Promise<PainPendingRow[]> {
      const result = await db
        .prepare(
          `SELECT ws.id AS sessionId, ws.student_id AS studentId, s.display_name AS studentName,
             ws.performed_on AS performedOn, ws.workout_label AS workoutLabel
           FROM workout_sessions ws
           JOIN students s ON s.organization_id = ws.organization_id AND s.id = ws.student_id
           WHERE ws.organization_id = ?1 AND ws.pain_reported = 1 AND ${reach("ws")}
             AND NOT EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = ws.id)
           ORDER BY ws.performed_on DESC, ws.created_at DESC`,
        )
        .bind(organizationId, userId)
        .all<PainPendingRow>();
      return result.results;
    },
  };
}
