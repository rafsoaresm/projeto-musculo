import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { assessmentsFor, type StartOutcome } from "@/db/assessments";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "@/db/students";
import { parseAssessment, POSTURE_NOTES_ITEM, SCREENING_ITEMS, type MetricInput, type RiskStatus, type ScreeningKey } from "@/modules/avaliacoes/contracts";

/**
 * TEST FIXTURE ONLY. The earlier format of the assessment (format_version NULL: the six-item screening, metrics, posture and movement) can no
 * longer be started, filled or recorded by the application (user's decision of 03/11/2026: only the Avaliação Física). Its recorded rows stay
 * in production as data: they are read in the history, an unreviewed alert among them still holds a plan approval, and their photos can still
 * be erased. The tests below need such rows, so this module writes them exactly as the application wrote them until 0.73 (the code moved here
 * from `src/db/assessments.ts` unchanged). Nothing under `src/` imports it.
 */
export type RecordOutcome =
  | { status: "recorded"; riskStatus: RiskStatus }
  | { status: "confirmation_required" }
  | { status: "screening_incomplete"; missing: ScreeningKey[] }
  | { status: "not_found" };

export function legacyAssessments(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  const repo = assessmentsFor(db, context);
  const reachAssessment = (alias: string) => `EXISTS (SELECT 1 FROM students s
    WHERE s.organization_id = ${alias}.organization_id AND s.id = ${alias}.student_id
      AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")})`;
  const audit = (action: string, subject: string, stamp: string): D1PreparedStatement =>
    db
      .prepare(
        `INSERT INTO access_audit_events (id, organization_id, actor_user_id, action, subject_id, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT changes()) > 0`,
      )
      .bind(crypto.randomUUID(), organizationId, userId, action, subject, stamp);
  const api = {
    /**
     * Opens a draft dated today. One open draft per student: asking again returns it. `format: 2` opens one of the new format (handoff V2): its
     * modules are sections, and it keeps a snapshot of the student's data as they are now (birth date, height, weight, goal; never the gender,
     * which the equation of a protocol does not take from the profile: decision of the user, 02/11/2026).
     */
    async startDraft(studentId: string, now = new Date()): Promise<StartOutcome> {
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      try {
        const result = await db
          .prepare(
            `INSERT INTO assessments
               (id, organization_id, student_id, assessed_on, kind, previous_assessment_id, state,
                risk_status, created_by_user_id, created_at, updated_at, screening_answered, format_version, student_snapshot)
             SELECT ?4, s.organization_id, s.id, ?5,
               CASE WHEN EXISTS (SELECT 1 FROM assessments p
                                   WHERE p.student_id = s.id AND p.state = 'RECORDED')
                    THEN 'REASSESSMENT' ELSE 'INITIAL' END,
               (SELECT p.id FROM assessments p WHERE p.student_id = s.id AND p.state = 'RECORDED'
                  ORDER BY p.assessed_on DESC, p.recorded_at DESC LIMIT 1),
               'DRAFT', 'CLEAR', ?2, ?6, ?6, '[]', ?7,
               CASE WHEN ?7 = 2 THEN (SELECT json_object('birthDate', p.birth_date, 'heightCm', p.height_cm, 'weightKg', p.weight_kg, 'goal', p.goal)
                 FROM student_profiles p WHERE p.organization_id = s.organization_id AND p.student_id = s.id) END
             FROM students s
             WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")}
               AND ${technicalAccessExists("s", "?2")}`,
          )
          .bind(organizationId, userId, studentId, id, stamp.slice(0, 10), stamp, null)
          .run();
        return result.meta.changes > 0 ? { status: "started", id } : { status: "not_found" };
      } catch (error) {
        if (!String(error).includes("UNIQUE")) throw error;
        const open = (await repo.listForStudent(studentId)).find((a) => a.state === "DRAFT");
        if (!open) return { status: "not_found" };
        const format = await db.prepare("SELECT format_version AS f FROM assessments WHERE organization_id = ?1 AND id = ?2").bind(organizationId, open.id).first<{ f: number | null }>();
        return { status: "draft_open", id: open.id, formatVersion: format?.f ?? null };
      }
    },

    /**
     * Replaces the content of an open draft: screening, metrics, posture and movement. What is
     * not sent is not kept. A movement test marked "not assessed" without notes is simply left out.
     */
    async saveDraft(assessmentId: string, raw: unknown, now = new Date()): Promise<boolean> {
      const input = parseAssessment(raw, now);
      const stamp = now.toISOString();
      const open = `EXISTS (SELECT 1 FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3
        AND a.state = 'DRAFT' AND a.format_version IS NULL AND ${reachAssessment("a")})`;
      const findingRows: Array<{ area: "POSTURE" | "MOVEMENT"; item: string; grade: string | null; notes: string | null }> = [
        ...input.posture.findings.map((item) => ({ area: "POSTURE" as const, item, grade: null, notes: null })),
        ...(input.posture.notes
          ? [{ area: "POSTURE" as const, item: POSTURE_NOTES_ITEM, grade: null, notes: input.posture.notes }]
          : []),
        ...input.movement
          .filter((row) => row.grade !== "NOT_ASSESSED" || row.notes)
          .map((row) => ({ area: "MOVEMENT" as const, item: row.test, grade: row.grade, notes: row.notes })),
      ];
      const flagColumns = SCREENING_ITEMS.map((item, index) => `${item.column} = ?${index + 6}`);
      const results = await db.batch([
        db
          .prepare(
            `UPDATE assessments
             SET assessed_on = ?4, risk_status = ?5, ${flagColumns.join(", ")},
               screening_notes = ?12, notes = ?13, updated_at = ?14,
               screening_answered = CASE WHEN screening_answered IS NULL THEN NULL ELSE ?15 END
             WHERE organization_id = ?1 AND id = ?3 AND state = 'DRAFT' AND format_version IS NULL AND ${reachAssessment("assessments")}`,
          )
          .bind(
            organizationId, userId, assessmentId, input.assessedOn, input.riskStatus,
            ...SCREENING_ITEMS.map((item) => (input[item.key] ? 1 : 0)),
            input.screeningNotes, input.notes, stamp, JSON.stringify(input.answered),
          ),
        db
          .prepare(`DELETE FROM assessment_metrics WHERE organization_id = ?1 AND assessment_id = ?3 AND ${open}`)
          .bind(organizationId, userId, assessmentId),
        ...input.metrics.map((metric: MetricInput, index: number) =>
          db
            .prepare(
              `INSERT INTO assessment_metrics
                 (id, organization_id, assessment_id, metric_type, name, value_text, value_number,
                  unit, side, notes, position)
               SELECT ?4, ?1, ?3, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
               WHERE ${open}`,
            )
            .bind(
              organizationId, userId, assessmentId, crypto.randomUUID(), metric.metricType,
              metric.name, metric.valueText, metric.valueNumber, metric.unit, metric.side,
              metric.notes, index + 1,
            ),
        ),
        db
          .prepare(`DELETE FROM assessment_findings WHERE organization_id = ?1 AND assessment_id = ?3 AND ${open}`)
          .bind(organizationId, userId, assessmentId),
        ...findingRows.map((row) =>
          db
            .prepare(
              `INSERT INTO assessment_findings (id, organization_id, assessment_id, area, item, grade, notes)
               SELECT ?4, ?1, ?3, ?5, ?6, ?7, ?8
               WHERE ${open}`,
            )
            .bind(organizationId, userId, assessmentId, crypto.randomUUID(), row.area, row.item, row.grade, row.notes),
        ),
      ]);
      return results[0].meta.changes > 0;
    },

    /**
     * Closes the draft for good. With no item marked it asks the professional to confirm that
     * the six items were asked: an untouched form must not turn into "no alert".
     */
    async record(
      assessmentId: string,
      confirmation: { screeningAsked: boolean },
      now = new Date(),
    ): Promise<RecordOutcome> {
      const current = await repo.get(assessmentId);
      if (!current || current.state !== "DRAFT") return { status: "not_found" };
      // A draft of the new format (handoff V2) is finished by its own flow, never recorded through the earlier form.
      const format = await db.prepare("SELECT format_version AS f FROM assessments WHERE organization_id = ?1 AND id = ?2").bind(organizationId, assessmentId).first<{ f: number | null }>();
      if (format?.f != null) return { status: "not_found" };
      if (!current.earlierFormat) {
        // Decision D4: every question has a Yes or a No before the assessment is recorded.
        const missing = SCREENING_ITEMS.filter((item) => current.flags[item.key] === null).map((item) => item.key);
        if (missing.length > 0) return { status: "screening_incomplete", missing };
      } else if (current.riskStatus === "CLEAR" && !confirmation.screeningAsked) return { status: "confirmation_required" };
      const stamp = now.toISOString();
      const results = await db.batch([
        // A body fat typed in the earlier format is kept as a result whose method nobody knows (migration 0033): never compared with a
        // computed one as if it were the same thing.
        db
          .prepare(
            `INSERT INTO assessment_results (id, assessment_id, organization_id, code, value, unit, method, formula_version, inputs, flags, created_at)
             SELECT ?5, a.id, a.organization_id, 'body_fat_percent', m.value_number, '%', 'legacy_formula_unknown', NULL, NULL,
               json_array('legacy_formula_unknown'), ?3
             FROM assessments a JOIN assessment_metrics m ON m.assessment_id = a.id
             WHERE a.organization_id = ?1 AND a.id = ?4 AND a.state = 'DRAFT' AND a.format_version IS NULL
               AND m.metric_type = 'BODY_FAT' AND m.value_number IS NOT NULL AND ${reachAssessment("a")}
               AND NOT EXISTS (SELECT 1 FROM assessment_results r WHERE r.assessment_id = a.id AND r.code = 'body_fat_percent')
             ORDER BY m.position LIMIT 1`,
          )
          .bind(organizationId, userId, stamp, assessmentId, crypto.randomUUID()),
        db
          .prepare(
            `UPDATE assessments SET state = 'RECORDED', recorded_at = ?3, recorded_by_user_id = ?2,
               updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND state = 'DRAFT' AND format_version IS NULL AND ${reachAssessment("assessments")}`,
          )
          .bind(organizationId, userId, stamp, assessmentId),
        audit("ASSESSMENT_RECORDED", assessmentId, stamp),
      ]);
      // results[0] is the earlier format's body fat (written or not); results[1] is the state.
      return results[1].meta.changes > 0
        ? { status: "recorded", riskStatus: current.riskStatus }
        : { status: "not_found" };
    },

  };
  return api;
}

/** The repository with the earlier format's writes on top, for the tests that build their data with them. */
export const withLegacy = (db: D1Database, context: AuthenticatedContext | null) => ({ ...assessmentsFor(db, context), ...legacyAssessments(db, context) });
