import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  parsePeriodizationInput,
  type PeriodizationInput,
  type PeriodizationSchedule,
} from "@/modules/training/contracts";
import { buildPeriodization } from "@/modules/training/periodization";
import { occurrenceCounts, occurrenceKey, scheduleOccurrences } from "@/modules/prescricao/occurrences";
import { isBelowTarget, workoutSlots } from "@/modules/prescricao/summary";
import { chunkJson } from "./json-chunks";
import { latestRecordedSql, screeningStanding, unreviewedAlertSql } from "./assessments";
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
  /** Counter of content changes of the revision (0041): moves only while DRAFT, never back. */
  contentVersion: number;
  /** TEMPLATE: one dose per workout (every revision before 0041). OCCURRENCE: one dose per session of each week (motor v2). */
  prescriptionModel: PrescriptionModel;
}
export type PrescriptionModel = "TEMPLATE" | "OCCURRENCE";
/** Who delivered a revision, as the names were at the moment of the delivery (slice 0.90). Null: not delivered, or no name then. */
export interface DeliveredNames {
  deliveredByName: string | null;
  deliveredOrganizationName: string | null;
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
  revision: PlanRevisionSummary & DeliveredNames & {
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
/** A plan whose newest revision is not delivered yet (0.93, the student picker of "Novo plano"). */
export interface PlanInProgress {
  studentId: string;
  planId: string;
  title: string;
  revisionId: string;
  revisionNumber: number;
  state: PlanState;
  updatedAt: string;
}
export type ApproveOutcome =
  | { status: "approved" }
  | { status: "screening_acknowledgement_required" }
  /** The newest assessment is an alert with no recorded review: "Revisão obrigatória antes da entrega." */
  | { status: "review_required"; assessedOn: string }
  /** A new assessment was recorded while this one was being approved. Read it and try again. */
  | { status: "screening_changed" }
  | { status: "not_found" };
export type DeliverOutcome =
  | { status: "delivered" }
  | { status: "review_required"; assessedOn: string }
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
  // The student of the plan that a revision row belongs to.
  const studentOf = `(SELECT tp.student_id FROM training_plans tp
    WHERE tp.organization_id = plan_revisions.organization_id AND tp.id = plan_revisions.plan_id)`;
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

  /**
   * Statements that keep the sessions of an OCCURRENCE draft in step with a new saved structure (motor S7, design §4.7), run in
   * `saveDraft`'s batch after its event and only when that save landed (the revision now holds exactly this input, stamped
   * now). A session that disappears or changes workout is refused while it still includes any exercise
   * (OCCURRENCE_PRESCRIPTION_WOULD_BE_LOST: leave them out of that session first); otherwise its left-out doses and the
   * session go. Sessions that stay get the new dates; new sessions get every row of their workout, included, with the base dose.
   */
  async function occurrenceSync(
    revisionId: string,
    schedule: PeriodizationSchedule,
    inputJson: string,
    stamp: string,
  ): Promise<D1PreparedStatement[]> {
    const existing = await db
      .prepare(
        `SELECT o.id, o.phase_index AS phaseIndex, o.week_index AS week, o.slot_index AS slot, o.workout_label AS label,
           o.week_start AS weekStart, o.planned_date AS plannedDate,
           (SELECT COUNT(*) FROM prescribed_exercise_occurrences x
             WHERE x.organization_id = o.organization_id AND x.occurrence_id = o.id AND x.included = 1) AS included
         FROM plan_session_occurrences o WHERE o.organization_id = ?1 AND o.revision_id = ?2`,
      )
      .bind(organizationId, revisionId)
      .all<{ id: string; phaseIndex: number; week: number; slot: number; label: string; weekStart: string; plannedDate: string | null; included: number }>();
    const wanted = new Map(scheduleOccurrences(schedule).map((o) => [occurrenceKey(o), o]));
    const have = new Map(existing.results.map((o) => [occurrenceKey(o), o]));
    const gone = existing.results.filter((o) => wanted.get(occurrenceKey(o))?.label !== o.label);
    if (gone.some((o) => o.included > 0)) throw new Error("OCCURRENCE_PRESCRIPTION_WOULD_BE_LOST");
    const goneKeys = new Set(gone.map(occurrenceKey));
    const moved = existing.results.flatMap((o) => {
      const next = wanted.get(occurrenceKey(o));
      return next && next.label === o.label && (next.weekStart !== o.weekStart || next.plannedDate !== o.plannedDate)
        ? [{ id: o.id, ws: next.weekStart, pd: next.plannedDate }]
        : [];
    });
    const added = [...wanted.values()]
      .filter((o) => !have.has(occurrenceKey(o)) || goneKeys.has(occurrenceKey(o)))
      .map((o) => ({ id: crypto.randomUUID(), p: o.phaseIndex, w: o.week, s: o.slot, label: o.label, ws: o.weekStart, pd: o.plannedDate }));
    // Only when the save above landed: this revision is an OCCURRENCE draft holding exactly this input, stamped now.
    const landed = `EXISTS (SELECT 1 FROM plan_revisions g WHERE g.organization_id = ?1 AND g.id = ?2 AND g.state = 'DRAFT'
      AND g.prescription_model = 'OCCURRENCE' AND g.updated_at = ?3 AND g.input_json = ?4)`;
    // D1 wants exactly as many values as the statement's highest placeholder: ?6 (the user) only where a row is created.
    const s = (sql: string, chunk: string) =>
      db.prepare(sql).bind(...[organizationId, revisionId, stamp, inputJson, chunk, userId].slice(0, sql.includes("?6") ? 6 : 5));
    const out: D1PreparedStatement[] = [];
    for (const chunk of chunkJson(gone.map((o) => o.id)))
      out.push(
        s(`DELETE FROM prescribed_exercise_occurrences WHERE organization_id = ?1 AND revision_id = ?2 AND included = 0
             AND occurrence_id IN (SELECT value FROM json_each(?5)) AND ${landed}`, chunk),
        s(`DELETE FROM plan_session_occurrences WHERE organization_id = ?1 AND revision_id = ?2
             AND id IN (SELECT value FROM json_each(?5)) AND ${landed}`, chunk),
      );
    for (const chunk of chunkJson(moved))
      out.push(
        s(
          `UPDATE plan_session_occurrences
           SET week_start = (SELECT json_extract(j.value, '$.ws') FROM json_each(?5) j WHERE json_extract(j.value, '$.id') = plan_session_occurrences.id),
             planned_date = (SELECT json_extract(j.value, '$.pd') FROM json_each(?5) j WHERE json_extract(j.value, '$.id') = plan_session_occurrences.id),
             updated_at = ?3
           WHERE organization_id = ?1 AND revision_id = ?2 AND id IN (SELECT json_extract(j.value, '$.id') FROM json_each(?5) j)
             AND ${landed}`,
          chunk,
        ),
      );
    for (const chunk of chunkJson(added))
      out.push(
        s(
          `INSERT INTO plan_session_occurrences (id, organization_id, revision_id, phase_index, week_index, slot_index, workout_label,
             week_start, planned_date, stimulus, created_by_user_id, created_at, updated_at)
           SELECT json_extract(j.value, '$.id'), ?1, ?2, json_extract(j.value, '$.p'), json_extract(j.value, '$.w'),
             json_extract(j.value, '$.s'), json_extract(j.value, '$.label'), json_extract(j.value, '$.ws'),
             json_extract(j.value, '$.pd'), NULL, ?6, ?3, ?3
           FROM json_each(?5) j WHERE ${landed}`,
          chunk,
        ),
        s(
          `INSERT INTO prescribed_exercise_occurrences (id, organization_id, revision_id, prescribed_exercise_id, occurrence_id,
             included, sets, reps, load_instruction, cadence, rest_seconds, rest_text, rir_min, rir_max, notes, dose_json, dose_text,
             trace_json, origin, source_proposal_item_id, created_by_user_id, created_at, updated_at)
           SELECT lower(hex(randomblob(16))), ?1, ?2, pe.id, o.id, 1, pe.sets, pe.reps, pe.load_instruction, pe.cadence,
             pe.rest_seconds, pe.rest_text, pe.rir_min, pe.rir_max, pe.notes, pe.dose_json, pe.dose_text, NULL,
             CASE WHEN pe.origin IN ('PROFESSIONAL', 'SYSTEM', 'SYSTEM_EDITED', 'AI') THEN pe.origin ELSE 'PROFESSIONAL' END,
             NULL, ?6, ?3, ?3
           FROM plan_session_occurrences o
           JOIN prescribed_exercises pe ON pe.organization_id = o.organization_id AND pe.revision_id = o.revision_id
             AND pe.phase_index = o.phase_index AND pe.workout_label = o.workout_label
           WHERE o.organization_id = ?1 AND o.revision_id = ?2
             AND o.id IN (SELECT json_extract(j.value, '$.id') FROM json_each(?5) j) AND ${landed}`,
          chunk,
        ),
      );
    // content_version already moved in this batch (the structure trigger of 0041), so no explicit bump is needed here.
    return out;
  }

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
             r.approved_at AS approvedAt, r.delivered_at AS deliveredAt,
             r.content_version AS contentVersion, r.prescription_model AS prescriptionModel
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
          contentVersion: row.contentVersion,
          prescriptionModel: row.prescriptionModel,
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
             r.updated_at AS updatedAt, r.schedule_json AS scheduleJson, r.prescription_model AS prescriptionModel
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
        .all<Omit<PlanOverviewRow, "exercises" | "workouts" | "below"> & { scheduleJson: string; prescriptionModel: PrescriptionModel }>();
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
      // OCCURRENCE revisions (motor S7): a workout is below its target when any of its sessions includes fewer exercises.
      const perOccurrence = new Map<string, Array<{ phaseIndex: number; label: string; included: number }>>();
      const occurrenceIds = rows.results.filter((row) => row.prescriptionModel === "OCCURRENCE").map((row) => row.revisionId);
      if (occurrenceIds.length) {
        const sessions = await db
          .prepare(
            `SELECT o.revision_id AS revisionId, o.phase_index AS phaseIndex, o.workout_label AS label,
               (SELECT COUNT(*) FROM prescribed_exercise_occurrences x
                 WHERE x.organization_id = o.organization_id AND x.occurrence_id = o.id AND x.included = 1) AS included
             FROM plan_session_occurrences o
             WHERE o.organization_id = ?1 AND o.revision_id IN (SELECT value FROM json_each(?2))`,
          )
          .bind(organizationId, JSON.stringify(occurrenceIds))
          .all<{ revisionId: string; phaseIndex: number; label: string; included: number }>();
        for (const row of sessions.results) perOccurrence.set(row.revisionId, [...(perOccurrence.get(row.revisionId) ?? []), row]);
      }
      return rows.results.map(({ scheduleJson, prescriptionModel, ...row }) => {
        const slots = workoutSlots(JSON.parse(scheduleJson) as PeriodizationSchedule);
        const countOf = (slot: { phaseIndex: number; label: string }) =>
          byWorkout.get(`${row.revisionId}|${slot.phaseIndex}|${slot.label}`) ?? 0;
        const below =
          prescriptionModel === "OCCURRENCE"
            ? occurrenceCounts(slots, perOccurrence.get(row.revisionId) ?? []).filter((slot) => isBelowTarget(slot, slot.count)).length
            : slots.filter((slot) => isBelowTarget(slot, countOf(slot))).length;
        return {
          ...row,
          exercises: slots.reduce((total, slot) => total + countOf(slot), 0),
          workouts: slots.length,
          below,
        };
      });
    },

    /**
     * Plans still in progress (newest revision not delivered nor archived) of the students this user reaches through an
     * active technical assignment, newest change first. Used by the student picker of "Novo plano" (0.93), which only
     * informs: a student may have more than one plan, so nothing here blocks a new one.
     */
    async inProgress(): Promise<PlanInProgress[]> {
      const rows = await db
        .prepare(
          `SELECT s.id AS studentId, p.id AS planId, p.title, r.id AS revisionId,
             r.revision_number AS revisionNumber, r.state, r.updated_at AS updatedAt
           FROM training_plans p
           JOIN students s ON s.organization_id = p.organization_id AND s.id = p.student_id
           JOIN plan_revisions r ON r.organization_id = p.organization_id AND r.plan_id = p.id
           WHERE p.organization_id = ?1 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}
             AND r.revision_number =
               (SELECT MAX(x.revision_number) FROM plan_revisions x
                WHERE x.organization_id = p.organization_id AND x.plan_id = p.id)
             AND r.state IN ('DRAFT','REVIEW_REQUIRED','READY','APPROVED')
           ORDER BY r.updated_at DESC, p.id`,
        )
        .bind(organizationId, userId)
        .all<PlanInProgress>();
      return rows.results;
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
             r.delivered_by_name AS deliveredByName, r.delivered_organization_name AS deliveredOrganizationName,
             r.based_on_revision_id AS basedOnRevisionId,
             r.content_version AS contentVersion, r.prescription_model AS prescriptionModel,
             r.input_json AS inputJson, r.schedule_json AS scheduleJson
           FROM training_plans p
           JOIN plan_revisions r
             ON r.organization_id = p.organization_id AND r.plan_id = p.id
           WHERE p.organization_id = ?1 AND p.id = ?3 AND r.id = ?4 AND ${gate("p")}`,
        )
        .bind(organizationId, userId, planId, revisionId)
        .first<
          Omit<PlanRevisionSummary, "id"> & DeliveredNames & {
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
          deliveredByName: row.deliveredByName,
          deliveredOrganizationName: row.deliveredOrganizationName,
          contentVersion: row.contentVersion,
          prescriptionModel: row.prescriptionModel,
          basedOnRevisionId: row.basedOnRevisionId,
          input: parsePeriodizationInput(JSON.parse(row.inputJson)),
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
      const input = parsePeriodizationInput(data.input);
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
      const input = parsePeriodizationInput(rawInput);
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
      const occurrenceStatements =
        current.revision.prescriptionModel === "OCCURRENCE"
          ? await occurrenceSync(revisionId, schedule, JSON.stringify(input), stamp)
          : [];
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
        ...occurrenceStatements,
      ]).catch((error: unknown) => {
        // A session that still includes exercises cannot go (0041 children first): someone included one meanwhile.
        if (String(error).includes("OCCURRENCE_ITEMS_FIRST")) throw new Error("OCCURRENCE_PRESCRIPTION_WOULD_BE_LOST");
        throw error;
      });
      return results[0].meta.changes > 0;
    },


    /**
     * DRAFT to READY: the structure is validated. It is not approval or delivery. An automatic proposal still open on the draft is
     * closed as SUPERSEDED in the same batch (nothing of it is applied), with its decision and event: a READY revision is never edited.
     */
    async markReady(
      planId: string,
      revisionId: string,
      now = new Date(),
    ): Promise<boolean> {
      const stamp = now.toISOString();
      const writeId = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions SET state = 'READY', ready_at = ?3, updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND plan_id = ?5 AND state = 'DRAFT'
               AND ${revisionGate("plan_revisions")}`,
          )
          .bind(organizationId, userId, stamp, revisionId, planId),
        eventAfterChange("MARKED_READY", revisionId, stamp),
        // Only when the statement above made this revision READY (same batch, same transaction).
        db
          .prepare(
            `UPDATE prescription_proposals
             SET state = 'SUPERSEDED', version = version + 1, last_write_id = ?3, closed_at = ?4,
               closed_by_user_id = ?2, updated_at = ?4
             WHERE organization_id = ?1 AND revision_id = ?5 AND plan_id = ?6 AND state = 'OPEN'
               AND EXISTS (SELECT 1 FROM plan_revisions r
                 WHERE r.organization_id = ?1 AND r.id = ?5 AND r.plan_id = ?6 AND r.state = 'READY' AND r.ready_at = ?4)`,
          )
          .bind(organizationId, userId, writeId, stamp, revisionId, planId),
        eventAfterChange("PROPOSAL_SUPERSEDED", revisionId, stamp),
        db
          .prepare(
            `INSERT INTO proposal_decisions
               (id, organization_id, proposal_id, actor_user_id, action, write_id, target_json,
                proposal_version_after, created_at)
             SELECT ?3, p.organization_id, p.id, ?2, 'SUPERSEDED', ?4, '{}', p.version, ?5
             FROM prescription_proposals p
             WHERE p.organization_id = ?1 AND p.revision_id = ?6 AND p.state = 'SUPERSEDED'
               AND p.last_write_id = ?4`,
          )
          .bind(organizationId, userId, crypto.randomUUID(), writeId, stamp, revisionId),
      ]);
      return results[0].meta.changes > 0;
    },

    /**
     * READY to APPROVED, an act of the professional. A workout below its target is a warning the professional sees, not an impediment
     * (handoff V4, A12, decided by the user on 01/11/2026): nothing is filled in to reach it. It needs a screening standing: a clear assessment, an alert with the professional's recorded review, or the
     * professional's acknowledgement that no assessment is registered for the student. An alert
     * without a review blocks approval. None of these is a clinical clearance: it is only
     * recorded, with the assessment behind it, as what was known at the time.
     */
    async approve(
      planId: string,
      revisionId: string,
      acknowledgement: { screeningNotRecorded: boolean },
      now = new Date(),
    ): Promise<ApproveOutcome> {
      const detail = await this.findRevision(planId, revisionId);
      if (!detail || detail.revision.state !== "READY") return { status: "not_found" };
      const standing = await screeningStanding(db, organizationId, detail.plan.studentId);
      if (standing?.risk === "REVIEW_REQUIRED" && !standing.reviewed)
        return { status: "review_required", assessedOn: standing.assessedOn };
      if (!standing && !acknowledgement.screeningNotRecorded)
        return { status: "screening_acknowledgement_required" };
      const screening = !standing
        ? "NOT_RECORDED"
        : standing.risk === "CLEAR"
          ? "CLEAR"
          : "REVIEW_REQUIRED_REVIEWED";
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions
             SET state = 'APPROVED', approved_at = ?3, approved_by_user_id = ?2,
               approval_screening = ?6, approval_assessment_id = ?7, updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND plan_id = ?5 AND state = 'READY'
               AND ${revisionGate("plan_revisions")}
               AND ${latestRecordedSql("plan_revisions.organization_id", studentOf)} IS ?7`,
          )
          .bind(organizationId, userId, stamp, revisionId, planId, screening, standing?.assessmentId ?? null),
        eventAfterChange("APPROVED", revisionId, stamp),
      ]);
      if (results[0].meta.changes > 0) return { status: "approved" };
      // Nothing changed: either the screening moved under us or the revision is not ours any more.
      const still = await this.findRevision(planId, revisionId);
      return still?.revision.state === "READY"
        ? { status: "screening_changed" }
        : { status: "not_found" };
    },

    /**
     * APPROVED to DELIVERED: the student can see exactly this revision from now on. Delivery is
     * refused while the student's newest assessment is an alert nobody has reviewed, also when
     * that assessment was recorded after the approval. The names of who delivered (the professional and the workspace, as they are now) are
     * written with it by the database (migration 0039) and never change afterwards.
     */
    async deliver(planId: string, revisionId: string, now = new Date()): Promise<DeliverOutcome> {
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions
             SET state = 'DELIVERED', delivered_at = ?3, delivered_by_user_id = ?2, updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND plan_id = ?5 AND state = 'APPROVED'
               AND ${revisionGate("plan_revisions")}
               AND NOT ${unreviewedAlertSql("plan_revisions.organization_id", studentOf)}`,
          )
          .bind(organizationId, userId, stamp, revisionId, planId),
        eventAfterChange("DELIVERED", revisionId, stamp),
      ]);
      if (results[0].meta.changes > 0) return { status: "delivered" };
      const detail = await this.findRevision(planId, revisionId);
      if (detail?.revision.state === "APPROVED") {
        const standing = await screeningStanding(db, organizationId, detail.plan.studentId);
        if (standing?.risk === "REVIEW_REQUIRED" && !standing.reviewed)
          return { status: "review_required", assessedOn: standing.assessedOn };
      }
      return { status: "not_found" };
    },

    /**
     * Copies a non-draft revision into a new draft with a new identity. History is
     * never rewritten, and one plan has at most one open draft. The prescription travels
     * with it under new ids made here (not in SQL), each row keeping where it came from
     * (copied_from_id), its origin and its provenance (application, engine slot,
     * substitution remapped to the copy). An OCCURRENCE revision also copies its session
     * occurrences and the dose of each exercise in each of them. No proposal is copied.
     */
    async newRevisionFrom(
      planId: string,
      sourceRevisionId: string,
      now = new Date(),
    ): Promise<NewRevisionResult> {
      const revisionId = crypto.randomUUID();
      const stamp = now.toISOString();
      // The source is past DRAFT, so its rows are frozen (0007): what is read here is what the batch copies.
      const source = await db
        .prepare(
          `SELECT pe.id AS id, pe.substitutes_prescribed_exercise_id AS substitutes
           FROM prescribed_exercises pe
           JOIN plan_revisions r ON r.organization_id = pe.organization_id AND r.id = pe.revision_id
           JOIN training_plans p ON p.organization_id = r.organization_id AND p.id = r.plan_id
           WHERE pe.organization_id = ?1 AND r.plan_id = ?3 AND r.id = ?4 AND r.state <> 'DRAFT'
             AND ${gate("p")}
           ORDER BY pe.phase_index, pe.workout_label, pe.position, pe.id`,
        )
        .bind(organizationId, userId, planId, sourceRevisionId)
        .all<{ id: string; substitutes: string | null }>();
      const newIds = new Map(source.results.map((row) => [row.id, crypto.randomUUID()]));
      const copies = source.results.map((row) => ({
        n: newIds.get(row.id),
        s: row.id,
        // A substitution of a row of the same revision points at that row's copy; anything else is not carried.
        x: row.substitutes ? (newIds.get(row.substitutes) ?? null) : null,
      }));
      const created = `EXISTS (SELECT 1 FROM plan_revisions n WHERE n.organization_id = ?1 AND n.id = ?3 AND n.state = 'DRAFT')`;
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO plan_revisions
                 (id, organization_id, plan_id, revision_number, state, input_json,
                  schedule_json, engine_version, start_date, end_date, total_weeks,
                  total_sessions, based_on_revision_id, prescription_model, created_by_user_id,
                  created_at, updated_at)
               SELECT ?3, r.organization_id, r.plan_id,
                 (SELECT COALESCE(MAX(x.revision_number), 0) + 1
                    FROM plan_revisions x WHERE x.plan_id = r.plan_id),
                 'DRAFT', r.input_json, r.schedule_json, r.engine_version, r.start_date,
                 r.end_date, r.total_weeks, r.total_sessions, r.id, r.prescription_model, ?2, ?4, ?4
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
          // Inserts nothing when the revision above was refused.
          db
            .prepare(
              `INSERT INTO prescribed_exercises
                 (id, organization_id, revision_id, phase_index, workout_label, position,
                  exercise_id, name, video_url, video_status, sets, reps, load_instruction,
                  cadence, rest_seconds, rest_text, rir_min, rir_max, notes, origin,
                  dose_json, dose_text, application_id, source_slot_key, copied_from_id,
                  substitutes_prescribed_exercise_id, created_by_user_id, created_at, updated_at)
               SELECT json_extract(j.value, '$.n'), src.organization_id, ?3, src.phase_index,
                 src.workout_label, src.position, src.exercise_id, src.name, src.video_url,
                 src.video_status, src.sets, src.reps, src.load_instruction, src.cadence,
                 src.rest_seconds, src.rest_text, src.rir_min, src.rir_max, src.notes,
                 src.origin, src.dose_json, src.dose_text, src.application_id, src.source_slot_key,
                 src.id, json_extract(j.value, '$.x'), ?2, ?4, ?4
               FROM json_each(?7) j
               JOIN prescribed_exercises src ON src.id = json_extract(j.value, '$.s')
               WHERE src.organization_id = ?1 AND src.revision_id = ?6 AND ${created}`,
            )
            .bind(
              organizationId,
              userId,
              revisionId,
              stamp,
              planId,
              sourceRevisionId,
              JSON.stringify(copies),
            ),
          // The schedule is copied unchanged, so each occurrence keeps its week, slot and dates.
          db
            .prepare(
              `INSERT INTO plan_session_occurrences
                 (id, organization_id, revision_id, phase_index, week_index, slot_index, workout_label,
                  week_start, planned_date, stimulus, created_by_user_id, created_at, updated_at)
               SELECT lower(hex(randomblob(16))), o.organization_id, ?3, o.phase_index, o.week_index,
                 o.slot_index, o.workout_label, o.week_start, o.planned_date, o.stimulus, ?2, ?4, ?4
               FROM plan_session_occurrences o
               WHERE o.organization_id = ?1 AND o.revision_id = ?5 AND ${created}`,
            )
            .bind(organizationId, userId, revisionId, stamp, sourceRevisionId),
          db
            .prepare(
              `INSERT INTO prescribed_exercise_occurrences
                 (id, organization_id, revision_id, prescribed_exercise_id, occurrence_id, included,
                  sets, reps, load_instruction, cadence, rest_seconds, rest_text, rir_min, rir_max, notes,
                  dose_json, dose_text, trace_json, origin, source_proposal_item_id,
                  created_by_user_id, created_at, updated_at)
               SELECT lower(hex(randomblob(16))), x.organization_id, ?3, pe.id, no.id, x.included,
                 x.sets, x.reps, x.load_instruction, x.cadence, x.rest_seconds, x.rest_text, x.rir_min,
                 x.rir_max, x.notes, x.dose_json, x.dose_text, x.trace_json, x.origin,
                 x.source_proposal_item_id, ?2, ?4, ?4
               FROM prescribed_exercise_occurrences x
               JOIN plan_session_occurrences oo ON oo.organization_id = x.organization_id AND oo.id = x.occurrence_id
               JOIN prescribed_exercises pe
                 ON pe.organization_id = ?1 AND pe.revision_id = ?3 AND pe.copied_from_id = x.prescribed_exercise_id
               JOIN plan_session_occurrences no
                 ON no.organization_id = ?1 AND no.revision_id = ?3 AND no.phase_index = oo.phase_index
                   AND no.week_index = oo.week_index AND no.slot_index = oo.slot_index
               WHERE x.organization_id = ?1 AND x.revision_id = ?5 AND ${created}`,
            )
            .bind(organizationId, userId, revisionId, stamp, sourceRevisionId),
          // The occurrence tables have no bump triggers (0041): one explicit bump for the batch.
          db
            .prepare(
              `UPDATE plan_revisions SET content_version = content_version + 1
               WHERE organization_id = ?1 AND id = ?3 AND state = 'DRAFT'
                 AND EXISTS (SELECT 1 FROM plan_session_occurrences o WHERE o.revision_id = ?3)`,
            )
            .bind(organizationId, userId, revisionId),
        ]);
        return results[0].meta.changes > 0
          ? { status: "created", revisionId }
          : { status: "not_found" };
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed: plan_revisions.plan_id")) return { status: "draft_open" };
        throw error;
      }
    },
  };
}
