import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import {
  periodizationInputSchema,
  type PeriodizationInput,
  type PeriodizationSchedule,
} from "@/modules/training/contracts";
import { buildPeriodization } from "@/modules/training/periodization";
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
             r.updated_at AS updatedAt, r.ready_at AS readyAt
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
        });
        plans.set(row.planId, plan);
      }
      return [...plans.values()];
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
      const results = await db.batch([
        db
          .prepare(
            `UPDATE plan_revisions
             SET input_json = ?3, schedule_json = ?4, engine_version = ?5, start_date = ?6,
               end_date = ?7, total_weeks = ?8, total_sessions = ?9, updated_at = ?10
             WHERE organization_id = ?1 AND id = ?11 AND plan_id = ?12 AND state = 'DRAFT'
               AND ${revisionGate("plan_revisions")}`,
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
