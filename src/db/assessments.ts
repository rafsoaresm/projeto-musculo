import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { PhotoView } from "@/modules/avaliacoes/photos";
import {
  MOVEMENT_KEYS,
  parseAssessment,
  POSTURE_KEYS,
  POSTURE_NOTES_ITEM,
  SCREENING_ITEMS,
  type MetricInput,
  type MovementGrade,
  type MovementKey,
  type PostureKey,
  type RiskStatus,
  type ScreeningKey,
} from "@/modules/avaliacoes/contracts";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/**
 * Assessments: dated records with the screening of the master document and baseline metrics.
 * Personal and health-related, so only a professional with an active technical care assignment
 * reads or writes them. A recorded assessment never changes (also enforced by triggers); a review
 * of one that required it is a separate append-only record. Saving records who and when in
 * access_audit_events, never what.
 */
export interface AssessmentSummary {
  id: string;
  studentId: string;
  assessedOn: string;
  kind: "INITIAL" | "REASSESSMENT";
  state: "DRAFT" | "RECORDED";
  riskStatus: RiskStatus;
  recordedAt: string | null;
  reviewed: boolean;
}
export interface MetricRow {
  metricType: string;
  name: string;
  valueText: string;
  valueNumber: number | null;
  unit: string | null;
  side: "LEFT" | "RIGHT" | "BOTH" | null;
  notes: string | null;
}
export interface ReviewRow {
  reviewerUserId: string;
  reviewerName: string | null;
  basis: string;
  reviewedAt: string;
}
/** The photos of an assessment as an index: which views have one. The image is never here. */
export interface PhotoIndexRow {
  view: PhotoView;
  createdAt: string;
  /** When the photo was erased on the student's request; null while it is stored. Never shown again once set. */
  erasedAt: string | null;
}
export interface MovementRow {
  test: MovementKey;
  grade: MovementGrade;
  notes: string | null;
}
export interface AssessmentDetail extends AssessmentSummary {
  previousAssessmentId: string | null;
  flags: Record<ScreeningKey, boolean>;
  screeningNotes: string | null;
  notes: string | null;
  metrics: MetricRow[];
  /** Marked postural findings and the free notes. Absent means not marked, never "normal". */
  posture: { findings: PostureKey[]; notes: string | null };
  /** Only the tests that were recorded. A test with no row was not assessed. */
  movement: MovementRow[];
  photos: PhotoIndexRow[];
  reviews: ReviewRow[];
}
export interface FindingRow {
  area: "POSTURE" | "MOVEMENT";
  item: string;
  grade: string | null;
  notes: string | null;
}
/** Marked findings in the order of the master document, and only the tests that were recorded. */
export function shapeFindings(rows: FindingRow[]): Pick<AssessmentDetail, "posture" | "movement"> {
  return {
    posture: {
      findings: POSTURE_KEYS.filter((key) => rows.some((f) => f.area === "POSTURE" && f.item === key)),
      notes: rows.find((f) => f.area === "POSTURE" && f.item === POSTURE_NOTES_ITEM)?.notes ?? null,
    },
    movement: MOVEMENT_KEYS.flatMap((test) => {
      const found = rows.find((f) => f.area === "MOVEMENT" && f.item === test);
      return found ? [{ test, grade: found.grade as MovementGrade, notes: found.notes }] : [];
    }),
  };
}

/** A recorded assessment as the evolution view reads it: no reviews, no drafts. */
export type AssessmentSnapshot = Pick<
  AssessmentDetail,
  "id" | "assessedOn" | "kind" | "riskStatus" | "reviewed" | "flags" | "posture" | "movement" | "metrics" | "photos"
>;

/**
 * SQL scalar: id of the newest recorded assessment of a student (by assessment date, then by
 * when it was recorded). Arguments are SQL expressions for the organization and the student.
 */
export const latestRecordedSql = (organization: string, student: string) =>
  `(SELECT x.id FROM assessments x
    WHERE x.organization_id = ${organization} AND x.student_id = ${student} AND x.state = 'RECORDED'
    ORDER BY x.assessed_on DESC, x.recorded_at DESC LIMIT 1)`;

/** SQL predicate: that newest assessment is an alert that nobody has reviewed yet. */
export const unreviewedAlertSql = (organization: string, student: string) =>
  `EXISTS (SELECT 1 FROM assessments al
    WHERE al.id = ${latestRecordedSql(organization, student)} AND al.risk_status = 'REVIEW_REQUIRED'
      AND NOT EXISTS (SELECT 1 FROM assessment_reviews rv WHERE rv.assessment_id = al.id))`;

/** What the newest recorded assessment of a student says about screening. */
export interface ScreeningStanding {
  assessmentId: string;
  assessedOn: string;
  risk: RiskStatus;
  reviewed: boolean;
  reviewedAt: string | null;
}
export interface StudentAssessmentRow {
  studentId: string;
  studentName: string;
  assessmentId: string | null;
  assessedOn: string | null;
  riskStatus: RiskStatus | null;
  reviewed: boolean;
  draftId: string | null;
}
export type StartOutcome =
  | { status: "started"; id: string }
  | { status: "draft_open"; id: string }
  | { status: "not_found" };
export type RecordOutcome =
  | { status: "recorded"; riskStatus: RiskStatus }
  | { status: "confirmation_required" }
  | { status: "not_found" };

/** The newest recorded assessment of a student and whether an alert was reviewed. No access check. */
export async function screeningStanding(
  db: D1Database,
  organizationId: string,
  studentId: string,
): Promise<ScreeningStanding | null> {
  const row = await db
    .prepare(
      `SELECT a.id AS assessmentId, a.assessed_on AS assessedOn, a.risk_status AS risk,
         (SELECT MAX(r.reviewed_at) FROM assessment_reviews r WHERE r.assessment_id = a.id) AS reviewedAt
       FROM assessments a
       WHERE a.id = ${latestRecordedSql("?1", "?2")}`,
    )
    .bind(organizationId, studentId)
    .first<{ assessmentId: string; assessedOn: string; risk: RiskStatus; reviewedAt: string | null }>();
  return row
    ? { ...row, reviewed: row.reviewedAt !== null }
    : null;
}

export function assessmentsFor(db: D1Database, context: AuthenticatedContext | null) {
  const { userId, organizationId } = assertContext(context);
  // ?1 organization and ?2 acting user, always. ?3 is a student or an assessment id.
  const reachStudent = `EXISTS (SELECT 1 FROM students s
    WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")}
      AND ${technicalAccessExists("s", "?2")})`;
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
  const summaryColumns = `a.id, a.student_id AS studentId, a.assessed_on AS assessedOn, a.kind,
    a.state, a.risk_status AS riskStatus, a.recorded_at AS recordedAt,
    EXISTS (SELECT 1 FROM assessment_reviews r WHERE r.assessment_id = a.id) AS reviewed`;
  const asSummary = <T extends { reviewed: unknown }>(row: T) => ({
    ...row,
    reviewed: Boolean(row.reviewed),
  });

  const api = {
    async listForStudent(studentId: string): Promise<AssessmentSummary[]> {
      const result = await db
        .prepare(
          `SELECT ${summaryColumns} FROM assessments a
           WHERE a.organization_id = ?1 AND a.student_id = ?3 AND ${reachStudent}
           ORDER BY a.assessed_on DESC, a.created_at DESC`,
        )
        .bind(organizationId, userId, studentId)
        .all<AssessmentSummary>();
      return result.results.map(asSummary);
    },

    async get(assessmentId: string): Promise<AssessmentDetail | null> {
      const row = await db
        .prepare(
          `SELECT ${summaryColumns}, a.previous_assessment_id AS previousAssessmentId,
             ${SCREENING_ITEMS.map((item) => `a.${item.column} AS ${item.key}`).join(", ")},
             a.screening_notes AS screeningNotes, a.notes
           FROM assessments a
           WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`,
        )
        .bind(organizationId, userId, assessmentId)
        .first<AssessmentSummary & Record<ScreeningKey, number> & {
          previousAssessmentId: string | null;
          screeningNotes: string | null;
          notes: string | null;
        }>();
      if (!row) return null;
      const [metrics, findings, photoRows, reviews] = await Promise.all([
        db
          .prepare(
            `SELECT m.metric_type AS metricType, m.name, m.value_text AS valueText,
               m.value_number AS valueNumber, m.unit, m.side, m.notes
             FROM assessment_metrics m
             WHERE m.organization_id = ?1 AND m.assessment_id = ?2 ORDER BY m.position`,
          )
          .bind(organizationId, assessmentId)
          .all<MetricRow>(),
        db
          .prepare(
            `SELECT f.area, f.item, f.grade, f.notes FROM assessment_findings f
             WHERE f.organization_id = ?1 AND f.assessment_id = ?2 ORDER BY f.rowid`,
          )
          .bind(organizationId, assessmentId)
          .all<FindingRow>(),
        db
          .prepare(
            `SELECT p.view, p.created_at AS createdAt, e.erased_at AS erasedAt FROM assessment_photos p
             LEFT JOIN photo_erasures e ON e.photo_id = p.id
             WHERE p.organization_id = ?1 AND p.assessment_id = ?2
             ORDER BY CASE p.view WHEN 'ANTERIOR' THEN 1 WHEN 'LATERAL_LEFT' THEN 2
               WHEN 'LATERAL_RIGHT' THEN 3 ELSE 4 END`,
          )
          .bind(organizationId, assessmentId)
          .all<PhotoIndexRow>(),
        db
          .prepare(
            `SELECT r.reviewer_user_id AS reviewerUserId, p.display_name AS reviewerName,
               r.basis, r.reviewed_at AS reviewedAt
             FROM assessment_reviews r
             LEFT JOIN professionals p
               ON p.organization_id = r.organization_id AND p.user_id = r.reviewer_user_id
             WHERE r.organization_id = ?1 AND r.assessment_id = ?2 ORDER BY r.reviewed_at, r.rowid`,
          )
          .bind(organizationId, assessmentId)
          .all<ReviewRow>(),
      ]);
      const flags = Object.fromEntries(
        SCREENING_ITEMS.map((item) => [item.key, Boolean(row[item.key])]),
      ) as Record<ScreeningKey, boolean>;
      return {
        id: row.id,
        studentId: row.studentId,
        assessedOn: row.assessedOn,
        kind: row.kind,
        state: row.state,
        riskStatus: row.riskStatus,
        recordedAt: row.recordedAt,
        reviewed: Boolean(row.reviewed),
        previousAssessmentId: row.previousAssessmentId,
        flags,
        screeningNotes: row.screeningNotes,
        notes: row.notes,
        metrics: metrics.results,
        ...shapeFindings(findings.results),
        photos: photoRows.results,
        reviews: reviews.results,
      };
    },

    /**
     * The recorded assessments of a student, oldest first, with everything the evolution view
     * compares. Only the newest `limit` are read. Drafts never appear.
     */
    async history(studentId: string, limit = 24): Promise<AssessmentSnapshot[]> {
      const rows = (
        await db
          .prepare(
            `SELECT ${summaryColumns},
               ${SCREENING_ITEMS.map((item) => `a.${item.column} AS ${item.key}`).join(", ")}
             FROM assessments a
             WHERE a.organization_id = ?1 AND a.student_id = ?3 AND a.state = 'RECORDED'
               AND ${reachStudent}
             ORDER BY a.assessed_on DESC, a.recorded_at DESC LIMIT ?4`,
          )
          .bind(organizationId, userId, studentId, Math.max(1, Math.min(limit, 100)))
          .all<AssessmentSummary & Record<ScreeningKey, number>>()
      ).results.reverse();
      if (rows.length === 0) return [];
      // The ids below came from the gated query above.
      const ids = JSON.stringify(rows.map((row) => row.id));
      const [metrics, findings, photoRows] = await Promise.all([
        db
          .prepare(
            `SELECT m.assessment_id AS assessmentId, m.metric_type AS metricType, m.name,
               m.value_text AS valueText, m.value_number AS valueNumber, m.unit, m.side, m.notes
             FROM assessment_metrics m
             WHERE m.organization_id = ?1 AND m.assessment_id IN (SELECT value FROM json_each(?2))
             ORDER BY m.assessment_id, m.position`,
          )
          .bind(organizationId, ids)
          .all<MetricRow & { assessmentId: string }>(),
        db
          .prepare(
            `SELECT f.assessment_id AS assessmentId, f.area, f.item, f.grade, f.notes
             FROM assessment_findings f
             WHERE f.organization_id = ?1 AND f.assessment_id IN (SELECT value FROM json_each(?2))
             ORDER BY f.rowid`,
          )
          .bind(organizationId, ids)
          .all<FindingRow & { assessmentId: string }>(),
        db
          .prepare(
            `SELECT p.assessment_id AS assessmentId, p.view, p.created_at AS createdAt, e.erased_at AS erasedAt
             FROM assessment_photos p
             LEFT JOIN photo_erasures e ON e.photo_id = p.id
             WHERE p.organization_id = ?1 AND p.assessment_id IN (SELECT value FROM json_each(?2))
             ORDER BY CASE p.view WHEN 'ANTERIOR' THEN 1 WHEN 'LATERAL_LEFT' THEN 2
               WHEN 'LATERAL_RIGHT' THEN 3 ELSE 4 END`,
          )
          .bind(organizationId, ids)
          .all<PhotoIndexRow & { assessmentId: string }>(),
      ]);
      return rows.map((row) => ({
        id: row.id,
        assessedOn: row.assessedOn,
        kind: row.kind,
        riskStatus: row.riskStatus,
        reviewed: Boolean(row.reviewed),
        flags: Object.fromEntries(
          SCREENING_ITEMS.map((item) => [item.key, Boolean(row[item.key])]),
        ) as Record<ScreeningKey, boolean>,
        metrics: metrics.results
          .filter((metric) => metric.assessmentId === row.id)
          .map((metric) => ({
            metricType: metric.metricType,
            name: metric.name,
            valueText: metric.valueText,
            valueNumber: metric.valueNumber,
            unit: metric.unit,
            side: metric.side,
            notes: metric.notes,
          })),
        ...shapeFindings(findings.results.filter((finding) => finding.assessmentId === row.id)),
        photos: photoRows.results
          .filter((photo) => photo.assessmentId === row.id)
          .map((photo) => ({ view: photo.view, createdAt: photo.createdAt, erasedAt: photo.erasedAt })),
      }));
    },

    /** Opens a draft dated today. One open draft per student: asking again returns it. */
    async startDraft(studentId: string, now = new Date()): Promise<StartOutcome> {
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      try {
        const result = await db
          .prepare(
            `INSERT INTO assessments
               (id, organization_id, student_id, assessed_on, kind, previous_assessment_id, state,
                risk_status, created_by_user_id, created_at, updated_at)
             SELECT ?4, s.organization_id, s.id, ?5,
               CASE WHEN EXISTS (SELECT 1 FROM assessments p
                                   WHERE p.student_id = s.id AND p.state = 'RECORDED')
                    THEN 'REASSESSMENT' ELSE 'INITIAL' END,
               (SELECT p.id FROM assessments p WHERE p.student_id = s.id AND p.state = 'RECORDED'
                  ORDER BY p.assessed_on DESC, p.recorded_at DESC LIMIT 1),
               'DRAFT', 'CLEAR', ?2, ?6, ?6
             FROM students s
             WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")}
               AND ${technicalAccessExists("s", "?2")}`,
          )
          .bind(organizationId, userId, studentId, id, stamp.slice(0, 10), stamp)
          .run();
        return result.meta.changes > 0 ? { status: "started", id } : { status: "not_found" };
      } catch (error) {
        if (!String(error).includes("UNIQUE")) throw error;
        const open = (await api.listForStudent(studentId)).find((a) => a.state === "DRAFT");
        return open ? { status: "draft_open", id: open.id } : { status: "not_found" };
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
        AND a.state = 'DRAFT' AND ${reachAssessment("a")})`;
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
               screening_notes = ?12, notes = ?13, updated_at = ?14
             WHERE organization_id = ?1 AND id = ?3 AND state = 'DRAFT' AND ${reachAssessment("assessments")}`,
          )
          .bind(
            organizationId, userId, assessmentId, input.assessedOn, input.riskStatus,
            ...SCREENING_ITEMS.map((item) => (input[item.key] ? 1 : 0)),
            input.screeningNotes, input.notes, stamp,
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
      const current = await api.get(assessmentId);
      if (!current || current.state !== "DRAFT") return { status: "not_found" };
      if (current.riskStatus === "CLEAR" && !confirmation.screeningAsked)
        return { status: "confirmation_required" };
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE assessments SET state = 'RECORDED', recorded_at = ?3, recorded_by_user_id = ?2,
               updated_at = ?3
             WHERE organization_id = ?1 AND id = ?4 AND state = 'DRAFT' AND ${reachAssessment("assessments")}`,
          )
          .bind(organizationId, userId, stamp, assessmentId),
        audit("ASSESSMENT_RECORDED", assessmentId, stamp),
      ]);
      return results[0].meta.changes > 0
        ? { status: "recorded", riskStatus: current.riskStatus }
        : { status: "not_found" };
    },

    /** The professional's documented review of an alert. It never changes the risk status. */
    async addReview(assessmentId: string, basis: unknown, now = new Date()): Promise<boolean> {
      const text = typeof basis === "string" ? basis.trim() : "";
      if (text.length < 1 || text.length > 1000) throw new Error("REVIEW_BASIS_INVALID");
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `INSERT INTO assessment_reviews
               (id, organization_id, assessment_id, reviewer_user_id, basis, reviewed_at)
             SELECT ?4, a.organization_id, a.id, ?2, ?5, ?6
             FROM assessments a
             WHERE a.organization_id = ?1 AND a.id = ?3 AND a.state = 'RECORDED'
               AND a.risk_status = 'REVIEW_REQUIRED' AND ${reachAssessment("a")}`,
          )
          .bind(organizationId, userId, assessmentId, crypto.randomUUID(), text, stamp),
        audit("ASSESSMENT_REVIEWED", assessmentId, stamp),
      ]);
      return results[0].meta.changes > 0;
    },

    /** Screening standing of one student this user reaches. Null when none or not reachable. */
    async standing(studentId: string): Promise<ScreeningStanding | null> {
      const reachable = await db
        .prepare(`SELECT 1 AS ok WHERE ${reachStudent}`)
        .bind(organizationId, userId, studentId)
        .first();
      return reachable ? screeningStanding(db, organizationId, studentId) : null;
    },

    /** Every student the user reaches, with the newest recorded assessment and any open draft. */
    async overview(): Promise<StudentAssessmentRow[]> {
      const result = await db
        .prepare(
          `WITH latest AS (
             SELECT a.* FROM assessments a
             WHERE a.organization_id = ?1 AND a.state = 'RECORDED' AND NOT EXISTS (
               SELECT 1 FROM assessments b WHERE b.student_id = a.student_id AND b.state = 'RECORDED'
                 AND (b.assessed_on > a.assessed_on
                      OR (b.assessed_on = a.assessed_on AND b.recorded_at > a.recorded_at)))
           )
           SELECT s.id AS studentId, s.display_name AS studentName, l.id AS assessmentId,
             l.assessed_on AS assessedOn, l.risk_status AS riskStatus,
             EXISTS (SELECT 1 FROM assessment_reviews r WHERE r.assessment_id = l.id) AS reviewed,
             (SELECT d.id FROM assessments d WHERE d.student_id = s.id AND d.state = 'DRAFT') AS draftId
           FROM students s LEFT JOIN latest l ON l.student_id = s.id
           WHERE s.organization_id = ?1 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}
           ORDER BY CASE WHEN l.risk_status = 'REVIEW_REQUIRED'
                          AND NOT EXISTS (SELECT 1 FROM assessment_reviews r WHERE r.assessment_id = l.id)
                         THEN 0 ELSE 1 END,
             s.display_name`,
        )
        .bind(organizationId, userId)
        .all<StudentAssessmentRow>();
      return result.results.map(asSummary);
    },
  };
  return api;
}
