import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  periodizationInputSchema,
  type PeriodizationInput,
  type PeriodizationSchedule,
} from "@/modules/training/contracts";
import { buildPeriodization } from "@/modules/training/periodization";
import { workoutSlots } from "@/modules/prescricao/summary";
import {
  activeUser,
  assertContext,
  technicalAccessExists,
  type AuthenticatedContext,
} from "./students";

/**
 * Saved periodization plans. A plan belongs to one student and has revisions.
 *
 * Only a professional with an active technical care assignment reaches this data:
 * the student, a platform manager and commercial or finance members do not. Drafts
 * are never shown in the client portal. The schedule is always recomputed here from
 * the validated input, so a caller cannot store a schedule the engine would not make.
 *
 * READY means the structure was validated. It is not approval and releases nothing.
 * Content changes only while DRAFT; READY revisions are copied, never edited.
 */
export type PlanState =
  | "DRAFT"
  | "REVIEW_REQUIRED"
  | "READY"
  | "APPROVED"
  | "DELIVERED"
  | "ARCHIVED";

export interface PlanRevisionSummary {
  id: string;
  revisionNumber: number;
  state: PlanState;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  totalSessions: number;
  updatedAt: string;
  readyAt: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
}
export interface PlanSummary {
  id: string;
  title: string;
  createdAt: string;
  /** Newest revision first. */
  revisions: PlanRevisionSummary[];
}
export interface PlanRevisionDetail {
  plan: { id: string; studentId: string; title: string };
  revision: PlanRevisionSummary & {
    basedOnRevisionId: string | null;
    input: PeriodizationInput;
    schedule: PeriodizationSchedule;
  };
}
/** One plan, with its newest revision and how far the prescription is from its targets. */
export interface PlanOverviewRow {
  planId: string;
  title: string;
  studentId: string;
  studentName: string;
  revisionId: string;
  revisionNumber: number;
  state: PlanState;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  updatedAt: string;
  exercises: number;
  workouts: number;
  /** Workouts with fewer exercises than the target. A pending item, never filled in. */
  below: number;
}
export type ApproveOutcome =
  | { status: "approved" }
  | { status: "below_target"; below: number }
  | { status: "screening_acknowledgement_required" }
  | { status: "not_found" };
export type NewRevisionResult =
  | { status: "created"; revisionId: string }
  | { status: "draft_open" }
  | { status: "not_found" };

const TITLE_MAX = 120;
export function cleanTitle(title: unknown): string {
  const value = typeof title === "string" ? title.trim() : "";
  if (value.length < 1 || value.length > TITLE_MAX)
    throw new Error("PLAN_TITLE_INVALID");
  return value;
}

export function plansFor(
  db: D1Database,
  context: AuthenticatedContext | null,
) {
  const { userId, organizationId } = assertContext(context);
  // The student behind a plan must be reachable by this user right now. `p` is the
  // plan alias and ?2 is always the acting user.
  const gate = (plan: string) =>
    `EXISTS (SELECT 1 FROM students s
       WHERE s.organization_id = ${plan}.organization_id AND s.id = ${plan}.student_id
         AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  // Same rule for statements that start from a revision row.
  const revisionGate = (revision: string) =>
    `EXISTS (SELECT 1 FROM training_plans tp
       JOIN students s ON s.organization_id = tp.organization_id AND s.id = tp.student_id
       WHERE tp.organization_id = ${revision}.organization_id AND tp.id = ${revision}.plan_id
         AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  // Recorded only when the statement right before it changed a row.
  const eventAfterChange = (
    action: string,
    revisionId: string,
    now: string,
  ): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO training_plan_events
           (id, organization_id, plan_id, revision_id, actor_user_id, action, created_at)
         SELECT ?1, r.organization_id, r.plan_id, r.id, ?2, ?3, ?4
         FROM plan_revisions r
         WHERE r.organization_id = ?5 AND r.id = ?6 AND (SELECT changes()) > 0`,
      )
      .bind(crypto.randomUUID(), userId, action, now, organizationId, revisionId);
  const revisionColumns = (schedule: PeriodizationSchedule) => [
    schedule.engineVersion,
    schedule.startDate,
    schedule.endDate,
    schedule.totalWeeks,
    schedule.totalSessions,
  ];

  return {
    /** Plans of one student, newest first, each with its revisions. */
    async listForStudent(studentId: string): Promise<PlanSummary[]> {
      const rows = await db
        .prepare(
          `SELECT p.id AS planId, p.title, p.created_at AS planCreatedAt,
             r.id AS revisionId, r.revision_number AS revisionNumber, r.state,
             r.start_date AS startDate, r.end_date AS endDate,
             r.total_weeks AS totalWeeks, r.total_sessions AS totalSessions,
             r.updated_at AS updatedAt, r.ready_at AS readyAt,
             r.approved_at AS approvedAt, r.delivered_at AS deliveredAt
           FROM training_plans p
           JOIN plan_revisions r
             ON r.organization_id = p.organization_id AND r.plan_id = p.id
           WHERE p.organization_id = ?1 AND p.student_id = ?3 AND ${gate("p")}
           ORDER BY p.created_at DESC, p.id, r.revision_number DESC`,
        )
        .bind(organizationId, userId, studentId)
        .all<{
          planId: string;
          title: string;
          planCreatedAt: string;
        } & Omit<PlanRevisionSummary, "id"> & { revisionId: string }>();
      const plans = new Map<string, PlanSummary>();
      for (const row of rows.results) {
        const plan = plans.get(row.planId) ?? {
          id: row.planId,
          title: row.title,
          createdAt: row.planCreatedAt,
          revisions: [],
        };
        plan.revisions.push({
          id: row.revisionId,
          revisionNumber: row.revisionNumber,
          state: row.state,
          startDate: row.startDate,
          endDate: row.endDate,
          totalWeeks: row.totalWeeks,
          totalSessions: row.totalSessions,
          updatedAt: row.updatedAt,
          readyAt: row.readyAt,
          approvedAt: row.approvedAt,
          deliveredAt: row.deliveredAt,
        });
        plans.set(row.planId, plan);
      }
      return [...plans.values()];
    },

    /**
     * The newest revision of every plan of the students this user reaches through an
     * active technical assignment. Open drafts come first, then the most recent.
     */
    async overview(limit = 200): Promise<PlanOverviewRow[]> {
      const rows = await db
        .prepare(
          `SELECT p.id AS planId, p.title, s.id AS studentId, s.display_name AS studentName,
             r.id AS revisionId, r.revision_number AS revisionNumber, r.state,
             r.start_date AS startDate, r.end_date AS endDate, r.total_weeks AS totalWeeks,
             r.updated_at AS updatedAt, r.schedule_json AS scheduleJson
           FROM training_plans p
           JOIN students s ON s.organization_id = p.organization_id AND s.id = p.student_id
           JOIN plan_revisions r ON r.organization_id = p.organization_id AND r.plan_id = p.id
           WHERE p.organization_id = ?1 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}
             AND r.revision_number =
               (SELECT MAX(x.revision_number) FROM plan_revisions x WHERE x.plan_id = p.id)
           ORDER BY CASE r.state WHEN 'DRAFT' THEN 0 ELSE 1 END, r.updated_at DESC
           LIMIT ?3`,
        )
        .bind(organizationId, userId, limit)
        .all<Omit<PlanOverviewRow, "exercises" | "workouts" | "below"> & { scheduleJson: string }>();
      if (rows.results.length === 0) return [];
      // The ids come from the gated query above, so counting them needs no second gate.
      const counts = await db
        .prepare(
          `SELECT pe.revision_id AS revisionId, pe.phase_index AS p, pe.workout_label AS w,
             COUNT(*) AS n
           FROM prescribed_exercises pe
           WHERE pe.organization_id = ?1 AND pe.revision_id IN (SELECT value FROM json_each(?2))
           GROUP BY pe.revision_id, pe.phase_index, pe.workout_label`,
        )
        .bind(organizationId, JSON.stringify(rows.results.map((row) => row.revisionId)))
        .all<{ revisionId: string; p: number; w: string; n: number }>();
      const byWorkout = new Map(
        counts.results.map((c) => [`${c.revisionId}|${c.p}|${c.w}`, c.n]),
      );
      return rows.results.map(({ scheduleJson, ...row }) => {
        const slots = workoutSlots(JSON.parse(scheduleJson) as PeriodizationSchedule);
        const countOf = (slot: { phaseIndex: number; label: string }) =>
          byWorkout.get(`${row.revisionId}|${slot.phaseIndex}|${slot.label}`) ?? 0;
        return {
          ...row,
          exercises: slots.reduce((total, slot) => total + countOf(slot), 0),
          workouts: slots.length,
          below: slots.filter((slot) => countOf(slot) < slot.target).length,
        };
      });
    },

    async findRevision(
      planId: string,
      revisionId: string,
    ): Promise<PlanRevisionDetail | null> {
      const row = await db
        .prepare(
          `SELECT p.id AS planId, p.student_id AS studentId, p.title,
             r.id AS revisionId, r.revision_number AS revisionNumber, r.state,
             r.start_date AS startDate, r.end_date AS endDate,
             r.total_weeks AS totalWeeks, r.total_sessions AS totalSessions,
             r.updated_at AS updatedAt, r.ready_at AS readyAt,
             r.approved_at AS approvedAt, r.delivered_at AS deliveredAt,
             r.based_on_revision_id AS basedOnRevisionId,
             r.input_json AS inputJson, r.schedule_json AS scheduleJson
           FROM training_plans p
           JOIN plan_revisions r
             ON r.organization_id = p.organization_id AND r.plan_id = p.id
           WHERE p.organization_id = ?1 AND p.id = ?3 AND r.id = ?4 AND ${gate("p")}`,
        )
        .bind(organizationId, userId, planId, revisionId)
        .first<
          Omit<PlanRevisionSummary, "id"> & {
            planId: string;
            studentId: string;
            title: string;
            revisionId: string;
            basedOnRevisionId: string | null;
            inputJson: string;
            scheduleJson: string;
          }
        >();
      if (!row) return null;
      return {
        plan: { id: row.planId, studentId: row.studentId, title: row.title },
        revision: {
          id: row.revisionId,
          revisionNumber: row.revisionNumber,
          state: row.state,
          startDate: row.startDate,
          endDate: row.endDate,
          totalWeeks: row.totalWeeks,
          totalSessions: row.totalSessions,
          updatedAt: row.updatedAt,
          readyAt: row.readyAt,
          approvedAt: row.approvedAt,
          deliveredAt: row.deliveredAt,
          basedOnRevisionId: row.basedOnRevisionId,
          input: periodizationInputSchema.parse(JSON.parse(row.inputJson)),
          schedule: JSON.parse(row.scheduleJson) as PeriodizationSchedule,
        },
      };
    },

    /** Creates the plan and its first draft atomically. Null when not authorized. */
    async create(
      studentId: string,
      data: { title: unknown; input: unknown },
      now = new Date(),
    ): Promise<{ planId: string; revisionId: string } | null> {
      const title = cleanTitle(data.title);
      const schedule = buildPeriodization(data.input);
      const input = periodizationInputSchema.parse(data.input);
      const planId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO training_plans
               (id, organization_id, student_id, title, created_by_user_id, created_at)
             SELECT ?1, s.organization_id, s.id, ?2, ?3, ?4
             FROM students s
             WHERE s.organization_id = ?5 AND s.id = ?6
               AND ${activeUser("?3")} AND ${technicalAccessExists("s", "?3")}`,
          )
          .bind(planId, title, userId, stamp, organizationId, studentId),
        // Inserts nothing when the plan above was refused.
        db
          .prepare(
            `INSERT INTO plan_revisions
               (id, organization_id, plan_id, revision_number, state, input_json,
                schedule_json, engine_version, start_date, end_date, total_weeks,
                total_sessions, created_by_user_id, created_at, updated_at)
             SELECT ?1, p.organization_id, p.id, 1, 'DRAFT', ?2, ?3, ?4, ?5, ?6, ?7, ?8,
               ?9, ?10, ?10
             FROM training_plans p WHERE p.organization_id = ?11 AND p.id = ?12`,
          )
          .bind(
            revisionId,
            JSON.stringify(input),
            JSON.stringify(schedule),
            ...revisionColumns(schedule),
            userId,
            stamp,
            organizationId,
            planId,
          ),
        db
          .prepare(
            `INSERT INTO training_plan_events
               (id, organization_id, plan_id, revision_id, actor_user_id, action, created_at)
             SELECT ?1, r.organization_id, r.plan_id, r.id, ?2, 'PLAN_CREATED', ?3
             FROM plan_revisions r WHERE r.organization_id = ?4 AND r.id = ?5`,
          )
          .bind(crypto.randomUUID(), userId, stamp, organizationId, revisionId),
      ]);
      return results[0].meta.changes > 0 ? { planId, revisionId } : null;
    },

    /** Replaces the content of an open draft. False for any other state or user. */
    async saveDraft(
      planId: string,
      revisionId: string,
      rawInput: unknown,
      now = new Date(),
    ): Promise<boolean> {
      const schedule = buildPeriodization(rawInput);
      const input = periodizationInputSchema.parse(rawInput);
      const stamp = now.toISOString();
      const kept = workoutSlots(schedule);
      const current = await this.findRevision(planId, revisionId);
      if (!current || current.revision.state !== "DRAFT") return false;
      // A change that removes a workout which already has exercises would throw the
      // professional's work away. Refuse it and say so: remove the exercises first.
      const used = await db
        .prepare(
          `SELECT DISTINCT phase_index AS p, workout_label AS w
           FROM prescribed_exercises WHERE organization_id = ?1 AND revision_id = ?2`,
        )
        .bind(organizationId, revisionId)
        .all<{ p: number; w: string }>();
      const valid = new Set(kept.map((slot) => `${slot.phaseIndex}|${slot.label}`));
      if (used.results.some((row) => !valid.has(`${row.p}|${row.w}`)))
        throw new Error("PRESCRIPTION_WOULD_BE_LOST");
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions
             SET input_json = ?3, schedule_json = ?4, engine_version = ?5, start_date = ?6,
               end_date = ?7, total_weeks = ?8, total_sessions = ?9, updated_at = ?10
             WHERE organization_id = ?1 AND id = ?11 AND plan_id = ?12 AND state = 'DRAFT'
               AND ${revisionGate("plan_revisions")}
               AND NOT EXISTS (
                 SELECT 1 FROM prescribed_exercises pe WHERE pe.revision_id = plan_revisions.id
                   AND NOT EXISTS (SELECT 1 FROM json_each(?13) j
                     WHERE json_extract(j.value, '$.p') = pe.phase_index
                       AND json_extract(j.value, '$.w') = pe.workout_label))`,
          )
          .bind(
            organizationId,
            userId,
            JSON.stringify(input),
            JSON.stringify(schedule),
            ...revisionColumns(schedule),
            stamp,
            revisionId,
            planId,
            JSON.stringify(kept.map((slot) => ({ p: slot.phaseIndex, w: slot.label }))),
          ),
        eventAfterChange("DRAFT_SAVED", revisionId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },

    /** DRAFT to READY: the structure is validated. It is not approval or delivery. */
    async markReady(
      planId: string,
      revisionId: string,
      now = new Date(),
    ): Promise<boolean> {
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions SET state = 'READY', ready_at = ?3, updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND plan_id = ?5 AND state = 'DRAFT'
               AND ${revisionGate("plan_revisions")}`,
          )
          .bind(organizationId, userId, stamp, revisionId, planId),
        eventAfterChange("MARKED_READY", revisionId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },

    /**
     * READY to APPROVED, an act of the professional. It needs every workout at or above its
     * target (the target can be changed in a draft, never filled in here) and the
     * professional's acknowledgement that no screening is registered for the student. That
     * acknowledgement is not a clearance: it is only recorded as what was known at the time.
     */
    async approve(
      planId: string,
      revisionId: string,
      acknowledgement: { screeningNotRecorded: boolean },
      now = new Date(),
    ): Promise<ApproveOutcome> {
      const detail = await this.findRevision(planId, revisionId);
      if (!detail || detail.revision.state !== "READY") return { status: "not_found" };
      // A READY revision is frozen, so these counts cannot change before the update below.
      const counts = await db
        .prepare(
          `SELECT phase_index AS p, workout_label AS w, COUNT(*) AS n
           FROM prescribed_exercises WHERE organization_id = ?1 AND revision_id = ?2
           GROUP BY phase_index, workout_label`,
        )
        .bind(organizationId, revisionId)
        .all<{ p: number; w: string; n: number }>();
      const byWorkout = new Map(counts.results.map((c) => [`${c.p}|${c.w}`, c.n]));
      const below = workoutSlots(detail.revision.schedule).filter(
        (slot) => (byWorkout.get(`${slot.phaseIndex}|${slot.label}`) ?? 0) < slot.target,
      ).length;
      if (below > 0) return { status: "below_target", below };
      if (!acknowledgement.screeningNotRecorded)
        return { status: "screening_acknowledgement_required" };
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions
             SET state = 'APPROVED', approved_at = ?3, approved_by_user_id = ?2,
               approval_screening = 'NOT_RECORDED', updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND plan_id = ?5 AND state = 'READY'
               AND ${revisionGate("plan_revisions")}`,
          )
          .bind(organizationId, userId, stamp, revisionId, planId),
        eventAfterChange("APPROVED", revisionId, stamp),
      ]);
      return results[0].meta.changes > 0 ? { status: "approved" } : { status: "not_found" };
    },

    /** APPROVED to DELIVERED: the student can see exactly this revision from now on. */
    async deliver(planId: string, revisionId: string, now = new Date()): Promise<boolean> {
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions
             SET state = 'DELIVERED', delivered_at = ?3, delivered_by_user_id = ?2, updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND plan_id = ?5 AND state = 'APPROVED'
               AND ${revisionGate("plan_revisions")}`,
          )
          .bind(organizationId, userId, stamp, revisionId, planId),
        eventAfterChange("DELIVERED", revisionId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },

    /**
     * Copies a non-draft revision into a new draft with a new identity. History is
     * never rewritten, and one plan has at most one open draft.
     */
    async newRevisionFrom(
      planId: string,
      sourceRevisionId: string,
      now = new Date(),
    ): Promise<NewRevisionResult> {
      const revisionId = crypto.randomUUID();
      const stamp = now.toISOString();
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO plan_revisions
                 (id, organization_id, plan_id, revision_number, state, input_json,
                  schedule_json, engine_version, start_date, end_date, total_weeks,
                  total_sessions, based_on_revision_id, created_by_user_id, created_at,
                  updated_at)
               SELECT ?3, r.organization_id, r.plan_id,
                 (SELECT COALESCE(MAX(x.revision_number), 0) + 1
                    FROM plan_revisions x WHERE x.plan_id = r.plan_id),
                 'DRAFT', r.input_json, r.schedule_json, r.engine_version, r.start_date,
                 r.end_date, r.total_weeks, r.total_sessions, r.id, ?2, ?4, ?4
               FROM plan_revisions r
               JOIN training_plans p
                 ON p.organization_id = r.organization_id AND p.id = r.plan_id
               WHERE r.organization_id = ?1 AND r.plan_id = ?5 AND r.id = ?6
                 AND r.state <> 'DRAFT' AND ${gate("p")}`,
            )
            .bind(
              organizationId,
              userId,
              revisionId,
              stamp,
              planId,
              sourceRevisionId,
            ),
          eventAfterChange("REVISION_CREATED", revisionId, stamp),
          // The prescription travels with the revision, under new IDs, so editing the
          // copy never touches the revision it came from. Inserts nothing when the
          // revision above was refused.
          db
            .prepare(
              `INSERT INTO prescribed_exercises
                 (id, organization_id, revision_id, phase_index, workout_label, position,
                  exercise_id, name, video_url, video_status, sets, reps, load_instruction,
                  cadence, rest_seconds, rest_text, rir_min, rir_max, notes, origin,
                  created_by_user_id, created_at, updated_at)
               SELECT lower(hex(randomblob(16))), src.organization_id, ?3, src.phase_index,
                 src.workout_label, src.position, src.exercise_id, src.name, src.video_url,
                 src.video_status, src.sets, src.reps, src.load_instruction, src.cadence,
                 src.rest_seconds, src.rest_text, src.rir_min, src.rir_max, src.notes,
                 src.origin, ?2, ?4, ?4
               FROM prescribed_exercises src
               WHERE src.organization_id = ?1 AND src.revision_id = ?6
                 AND EXISTS (SELECT 1 FROM plan_revisions n
                               WHERE n.organization_id = ?1 AND n.id = ?3)`,
            )
            .bind(
              organizationId,
              userId,
              revisionId,
              stamp,
              planId,
              sourceRevisionId,
            ),
        ]);
        return results[0].meta.changes > 0
          ? { status: "created", revisionId }
          : { status: "not_found" };
      } catch (error) {
        if (String(error).includes("UNIQUE")) return { status: "draft_open" };
        throw error;
      }
    },
  };
}
