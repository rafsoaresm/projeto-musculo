import type { D1Database } from "@cloudflare/workers-types";
import {
  EXPORTS_PER_HOUR,
  EXPORT_CHECKIN_LIMIT,
  EXPORT_REQUEST_LIMIT,
  EXPORT_SESSION_LIMIT,
  buildExport,
  type ExportCheckin,
  type ExportLinkSource,
  type ExportRequest,
  type ExportSession,
  type StudentDataExport,
} from "@/modules/pedidos/export";
import { portalLinksFor, type PortalLink } from "./student-access";
import { studentTrainingFor } from "./student-plan";
import { activeUser } from "./students";

/**
 * "Baixar meus dados": what the tool shows the student, collected for the login that asks and for no
 * one else. Every query goes through the verified link of that login (active, not revoked, login not
 * blocked), like the pages the student already reads; nothing here takes a student, an organization
 * or an identity from the request. It reads the same tables as the screens and returns no row that a
 * screen would not show: no photo, no assessment, no intake sheet, no professional's note.
 *
 * Each generation is first reserved in the audit trail (who and when, never the content) and at most
 * `EXPORTS_PER_HOUR` are made per login and hour, in the same statement that writes the trail.
 */
export const EXPORT_GENERATED = "STUDENT_DATA_EXPORTED";

export type GenerateExportOutcome =
  | { status: "generated"; document: StudentDataExport }
  | { status: "rate_limited" }
  | { status: "not_found" };

const HOUR_MS = 60 * 60 * 1000;

export function studentExportFor(db: D1Database, userId: string) {
  if (!userId?.trim()) throw new Error("AUTHENTICATION_REQUIRED");
  // ?1 is always the acting login.
  const linked = (alias: string) => `EXISTS (SELECT 1 FROM student_access sa
    WHERE sa.organization_id = ${alias}.organization_id AND sa.student_id = ${alias}.student_id
      AND sa.user_id = ?1 AND sa.revoked_at IS NULL AND ${activeUser("?1")})`;

  /** One audit row per link, all or none: the count looks only at generations before this one. */
  const reserve = (links: PortalLink[], now: Date) =>
    db.batch(
      links.map((link) =>
        db
          .prepare(
            `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6
             WHERE ${activeUser("?3")}
               AND EXISTS (SELECT 1 FROM student_access sa WHERE sa.organization_id = ?2
                 AND sa.student_id = ?5 AND sa.user_id = ?3 AND sa.revoked_at IS NULL)
               AND (SELECT COUNT(DISTINCT e.created_at) FROM access_audit_events e
                 WHERE e.actor_user_id = ?3 AND e.action = ?4 AND e.created_at > ?7 AND e.created_at < ?6) < ?8`,
          )
          .bind(
            crypto.randomUUID(),
            link.organizationId,
            userId,
            EXPORT_GENERATED,
            link.studentId,
            now.toISOString(),
            new Date(now.getTime() - HOUR_MS).toISOString(),
            EXPORTS_PER_HOUR,
          ),
      ),
    );

  async function checkins(studentId: string): Promise<{ rows: ExportCheckin[]; cut: boolean }> {
    const result = await db
      .prepare(
        `SELECT c.checked_on AS checkedOn, c.effort, c.recovery, c.discomfort_reported AS discomfort,
           c.discomfort_notes AS discomfortNotes, c.notes, c.created_at AS createdAt,
           EXISTS (SELECT 1 FROM checkin_acknowledgements a WHERE a.checkin_id = c.id) AS read
         FROM student_checkins c
         WHERE c.student_id = ?2 AND ${linked("c")}
         ORDER BY c.checked_on DESC, c.created_at DESC LIMIT ?3`,
      )
      .bind(userId, studentId, EXPORT_CHECKIN_LIMIT + 1)
      .all<Omit<ExportCheckin, "discomfort" | "read"> & { discomfort: number; read: number }>();
    const rows = result.results.slice(0, EXPORT_CHECKIN_LIMIT).map((row) => ({
      ...row,
      discomfort: Boolean(row.discomfort),
      read: Boolean(row.read),
    }));
    return { rows, cut: result.results.length > EXPORT_CHECKIN_LIMIT };
  }

  async function sessions(studentId: string): Promise<{ rows: ExportSession[]; cut: boolean }> {
    const result = await db
      .prepare(
        `SELECT ws.id, ws.performed_on AS performedOn, p.title AS planTitle, ws.phase_index AS phaseIndex,
           ws.workout_label AS workoutLabel, ws.effort, ws.pain_reported AS painReported, ws.notes,
           ws.created_at AS createdAt,
           EXISTS (SELECT 1 FROM session_acknowledgements a WHERE a.session_id = ws.id) AS read
         FROM workout_sessions ws
         JOIN plan_revisions r ON r.organization_id = ws.organization_id AND r.id = ws.revision_id
         JOIN training_plans p ON p.organization_id = r.organization_id AND p.id = r.plan_id
         WHERE ws.student_id = ?2 AND ${linked("ws")}
         ORDER BY ws.performed_on DESC, ws.created_at DESC LIMIT ?3`,
      )
      .bind(userId, studentId, EXPORT_SESSION_LIMIT + 1)
      .all<Omit<ExportSession, "painReported" | "read" | "exercises"> & { id: string; painReported: number; read: number }>();
    const kept = result.results.slice(0, EXPORT_SESSION_LIMIT);

    // The exercises of the sessions above, which a gated query already chose, a few at a time.
    const exercises = new Map<string, ExportSession["exercises"]>();
    for (let from = 0; from < kept.length; from += 100) {
      const ids = kept.slice(from, from + 100).map((row) => row.id);
      const logged = await db
        .prepare(
          `SELECT se.session_id AS sessionId, se.id AS exerciseId, se.exercise_name AS name, se.done, se.rir,
             se.pain, se.notes, st.set_number AS setNumber, st.reps, st.load_kg AS loadKg
           FROM session_exercises se
           LEFT JOIN session_sets st ON st.session_exercise_id = se.id
           WHERE se.session_id IN (SELECT value FROM json_each(?1))
           ORDER BY se.session_id, se.position, st.set_number`,
        )
        .bind(JSON.stringify(ids))
        .all<{
          sessionId: string;
          exerciseId: string;
          name: string;
          done: number;
          rir: number | null;
          pain: number;
          notes: string | null;
          setNumber: number | null;
          reps: number | null;
          loadKg: number | null;
        }>();
      const byExercise = new Map<string, ExportSession["exercises"][number]>();
      for (const row of logged.results) {
        let exercise = byExercise.get(row.exerciseId);
        if (!exercise) {
          exercise = { name: row.name, done: Boolean(row.done), rir: row.rir, pain: Boolean(row.pain), notes: row.notes, sets: [] };
          byExercise.set(row.exerciseId, exercise);
          exercises.set(row.sessionId, [...(exercises.get(row.sessionId) ?? []), exercise]);
        }
        if (row.setNumber !== null) exercise.sets.push({ setNumber: row.setNumber, reps: row.reps, loadKg: row.loadKg });
      }
    }
    return {
      rows: kept.map(({ id, painReported, read, ...row }) => ({
        ...row,
        painReported: Boolean(painReported),
        read: Boolean(read),
        exercises: exercises.get(id) ?? [],
      })),
      cut: result.results.length > EXPORT_SESSION_LIMIT,
    };
  }

  async function requests(studentId: string): Promise<{ rows: ExportRequest[]; cut: boolean }> {
    const result = await db
      .prepare(
        `SELECT r.kind, r.message, r.created_at AS createdAt, r.due_at AS dueAt, o.outcome,
           o.note AS outcomeNote, o.created_at AS decidedAt
         FROM data_subject_requests r
         LEFT JOIN data_subject_request_outcomes o ON o.request_id = r.id
         WHERE r.student_id = ?2 AND ${linked("r")}
         ORDER BY r.created_at DESC LIMIT ?3`,
      )
      .bind(userId, studentId, EXPORT_REQUEST_LIMIT + 1)
      .all<ExportRequest>();
    return { rows: result.results.slice(0, EXPORT_REQUEST_LIMIT), cut: result.results.length > EXPORT_REQUEST_LIMIT };
  }

  async function collect(link: PortalLink): Promise<ExportLinkSource> {
    const [checkinRows, sessionRows, plans, requestRows] = await Promise.all([
      checkins(link.studentId),
      sessions(link.studentId),
      studentTrainingFor(db, userId, link.studentId),
      requests(link.studentId),
    ]);
    return {
      organizationName: link.organizationName,
      studentName: link.studentName,
      professionalName: link.professionalName,
      since: link.since,
      checkins: checkinRows.rows,
      checkinsCut: checkinRows.cut,
      sessions: sessionRows.rows,
      sessionsCut: sessionRows.cut,
      plans: plans.map((plan) => ({
        title: plan.title,
        revisionNumber: plan.revisionNumber,
        deliveredAt: plan.deliveredAt,
        deliveredBy: plan.deliveredBy,
        startDate: plan.startDate,
        endDate: plan.endDate,
        phases: plan.phases.map((phase) => ({
          index: phase.index,
          startDate: phase.startDate,
          endDate: phase.endDate,
          weeks: phase.weeks,
          sessionsPerWeek: phase.sessionsPerWeek,
          split: phase.split,
          workouts: phase.workouts.map((workout) => ({
            label: workout.label,
            exercises: workout.exercises.map((exercise) => ({
              name: exercise.name,
              videoUrl: exercise.videoUrl,
              sets: exercise.sets,
              reps: exercise.reps,
              loadInstruction: exercise.loadInstruction,
              cadence: exercise.cadence,
              restSeconds: exercise.restSeconds,
              restText: exercise.restText,
              rirMin: exercise.rirMin,
              rirMax: exercise.rirMax,
              notes: exercise.notes,
            })),
          })),
        })),
      })),
      requests: requestRows.rows,
      requestsCut: requestRows.cut,
    };
  }

  return {
    /**
     * Collects the copy. `rate_limited` writes nothing and reads nothing; `not_found` is a login
     * with no active link (a blocked login, or a link that was revoked).
     */
    async generate(now = new Date()): Promise<GenerateExportOutcome> {
      const links = await portalLinksFor(db, userId);
      if (links.length === 0) return { status: "not_found" };
      const reserved = await reserve(links, now);
      const allowed = links.filter((_, index) => reserved[index].meta.changes > 0);
      if (allowed.length === 0) return { status: "rate_limited" };

      const account = await db
        .prepare(`SELECT a.name, a.email FROM auth_user a WHERE a.id = ?1 AND ${activeUser("?1")}`)
        .bind(userId)
        .first<{ name: string; email: string }>();
      if (!account) return { status: "not_found" };
      const acceptances = await db
        .prepare(
          `SELECT c.terms_version AS termsVersion, c.terms_sha256 AS termsSha256,
             c.photos_authorized AS photosAuthorized, c.accepted_at AS acceptedAt
           FROM consent_acceptances c
           WHERE c.user_id = ?1 AND c.audience = 'STUDENT'
           ORDER BY c.accepted_at, c.rowid LIMIT 500`,
        )
        .bind(userId)
        .all<{ termsVersion: string; termsSha256: string; photosAuthorized: number; acceptedAt: string }>();
      return {
        status: "generated",
        document: buildExport({
          generatedAt: now,
          account,
          acceptances: acceptances.results.map((row) => ({ ...row, photosAuthorized: Boolean(row.photosAuthorized) })),
          links: await Promise.all(allowed.map(collect)),
        }),
      };
    },
  };
}
