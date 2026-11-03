import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { PhotoView } from "@/modules/avaliacoes/photos";
import {
  MOVEMENT_KEYS,
  POSTURE_KEYS,
  POSTURE_NOTES_ITEM,
  SCREENING_ITEMS,
  type MovementGrade,
  type MovementKey,
  type PostureKey,
  type RiskStatus,
  type ScreeningKey,
} from "@/modules/avaliacoes/contracts";
import { SECTION_STATUSES, isModule, type AssessmentModule, type SectionStatus } from "@/modules/avaliacoes/catalog";
import { COMPOSITION_MODULE, compositionSchema } from "@/modules/avaliacoes/v2/composition";
import { PROFILE_MODULE, SCREENING_MODULE, profileSchema, screeningSchema } from "@/modules/avaliacoes/v2/screening";
import { POSTURE_MODULE, postureSchema } from "@/modules/avaliacoes/v2/posture";
import { MOVEMENT_MODULE, movementSchema } from "@/modules/avaliacoes/v2/flexitest";
import { TESTS_MODULE, testsSchema } from "@/modules/avaliacoes/v2/physical-tests";
import { CONCLUSION_MODULE, conclusionSchema } from "@/modules/avaliacoes/v2/conclusion";
import { recordedScreening, reviewDraft } from "@/modules/avaliacoes/v2/review";
import { excludedWithData, readEnabledParts, type EnabledParts, type TemplatePart } from "@/modules/avaliacoes/v2/template";
import { activeUser, assertContext, technicalAccessExists, type AuthenticatedContext } from "./students";

/** One module of an assessment of the new format, as stored (its payload is checked by the module's schema where it is read). */
export interface SectionRow {
  module: AssessmentModule;
  status: SectionStatus;
  payload: unknown;
  updatedAt: string;
}
export type SaveSectionOutcome =
  | { status: "saved"; revision: number }
  | { status: "conflict"; revision: number }
  | { status: "not_found" }
  | { status: "invalid" }
  /** The payload holds something in a part that the draft's model leaves out (slice 0.85): refused, nothing is written. */
  | { status: "excluded"; parts: TemplatePart[] };
/** The model a draft of the new format started with (slice 0.85); null for "Todos os módulos" and every assessment made before. */
export interface AssessmentTemplateRef {
  id: string;
  version: number;
  /** The name of that version (a later rename does not change what this assessment says). */
  name: string;
}
/** The largest payload of a module (the database refuses more than 64 000 characters). */
export const MAX_SECTION_CHARS = 60_000;

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
  /** 2 for the Avaliação Física; null for the earlier format, which stays readable but can no longer be started (decision of 03/11/2026). */
  formatVersion: number | null;
  /** An amendment (retificação) points to the recorded assessment it corrects; null otherwise. */
  amendsAssessmentId: string | null;
  /** The recorded amendment that corrects this assessment (the newest), if any: this one stays, read as "Retificada". */
  amendedById: string | null;
  /** The main results recorded (body fat with its method, BMI), for the history; none for a draft. */
  results: ResultRow[];
}
/** One row of assessment_results: a value computed when the assessment was finalized, with its method, formula version, inputs and flags. */
export interface ResultRow {
  code: string;
  value: number | null;
  unit: string | null;
  method: string;
  formulaVersion: string | null;
  inputs: Record<string, unknown> | null;
  flags: string[];
}
export type FinalizeOutcome =
  | { status: "recorded" }
  /** What still blocks the finalize, in words (the triagem). */
  | { status: "pending"; pending: string[] }
  /** The draft changed since the screen read it (another tab, another person). */
  | { status: "conflict" }
  /** A stored module does not pass its schema. */
  | { status: "invalid" }
  | { status: "not_found" };
export type AmendOutcome =
  | { status: "started"; id: string }
  | { status: "draft_open"; id: string }
  | { status: "already_amended"; id: string }
  | { status: "invalid_reason" }
  | { status: "not_found" };
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
  /** When the photo was erased (with or without a request of the student); null while it is stored. Never shown again once set. */
  erasedAt: string | null;
}
export interface MovementRow {
  test: MovementKey;
  grade: MovementGrade;
  notes: string | null;
}
/** The keys of the answered questions, or null for an assessment of the earlier format (made before migration 0031). */
function answeredOf(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  try {
    const list = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(list) ? list.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

export interface AssessmentDetail extends AssessmentSummary {
  previousAssessmentId: string | null;
  /** Why this amendment was made (only for an amendment). */
  amendReason: string | null;
  /**
   * The name of the professional who recorded it, as it was at the moment of the record (slice 0.90); null when not recorded yet or when they had
   * no professional record then.
   */
  recordedByName: string | null;
  /** The name of the workspace at the moment of the record (slice 0.90); null while it is a draft. */
  recordedOrganizationName: string | null;
  /** Yes, No, or null for a question not answered (in a draft) or not recorded as an answer (in the earlier format). */
  flags: Record<ScreeningKey, boolean | null>;
  /** The assessment was made before every question had to be answered (decision D4): only a "yes" of it is a recorded answer. */
  earlierFormat: boolean;
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
  "id" | "assessedOn" | "recordedAt" | "kind" | "formatVersion" | "riskStatus" | "reviewed" | "flags" | "posture" | "movement" | "metrics" | "photos" | "results"
>;

/**
 * SQL scalar: id of the newest recorded assessment of a student (by assessment date, then by
 * when it was recorded). Arguments are SQL expressions for the organization and the student.
 */
export const latestRecordedSql = (organization: string, student: string) =>
  `(SELECT x.id FROM assessments x
    WHERE x.organization_id = ${organization} AND x.student_id = ${student} AND x.state = 'RECORDED'
    ORDER BY x.assessed_on DESC, x.recorded_at DESC LIMIT 1)`;

/** SQL scalar: a value of the recorded screening of an assessment of the new format (null for the earlier format or a draft without it). */
const screeningValueSql = (alias: string, path: string) =>
  `(SELECT json_extract(ps.payload, '${path}') FROM assessment_sections ps WHERE ps.assessment_id = ${alias}.id AND ps.module = 'screening')`;

/** SQL boolean: any PAR-Q answer of the screening of the assessment is "Sim" (read from the answers, so a record without the derived flag is not read as clear). */
const parqYesSql = (alias: string) =>
  `EXISTS (SELECT 1 FROM assessment_sections py, json_each(py.payload, '$.parq.answers') pj
    WHERE py.assessment_id = ${alias}.id AND py.module = 'screening' AND pj.value = 'yes')`;

/**
 * SQL scalar: the risk of an assessment, 'CLEAR' or 'REVIEW_REQUIRED'. For the earlier format it is the column (tied by 0009 to its six questions).
 * For the Avaliação Física it is the PAR-Q: any "Sim" (parq.riskFlag, written at finalize into the frozen screening, or any answer "yes" when the
 * flag is missing, as in an imported or damaged record) is an alert. The column of
 * such an assessment stays 'CLEAR', because the CHECK of 0009 ties it to the six questions of the earlier format, which this format does not ask:
 * every reader goes through this expression instead.
 */
export const riskSql = (alias: string) =>
  `(CASE WHEN ${alias}.format_version = 2 THEN
      CASE WHEN ${alias}.state = 'RECORDED' AND (${screeningValueSql(alias, "$.parq.riskFlag")} = 1 OR ${parqYesSql(alias)}) THEN 'REVIEW_REQUIRED' ELSE 'CLEAR' END
    ELSE ${alias}.risk_status END)`;

/**
 * SQL boolean: the alert of the assessment has the professional's recorded answer. For the earlier format, a review (assessment_reviews); for the
 * Avaliação Física, the decision on the PAR-Q with who and when, recorded at finalize.
 */
export const reviewedSql = (alias: string) =>
  `(CASE WHEN ${alias}.format_version = 2 THEN ${screeningValueSql(alias, "$.parq.professionalReview.reviewedAt")} IS NOT NULL
    ELSE EXISTS (SELECT 1 FROM assessment_reviews rv WHERE rv.assessment_id = ${alias}.id) END)`;

/** SQL predicate: that newest assessment is an alert that nobody has reviewed yet (earlier format) or decided on (PAR-Q "Sim" of the new one). */
export const unreviewedAlertSql = (organization: string, student: string) =>
  `EXISTS (SELECT 1 FROM assessments al
    WHERE al.id = ${latestRecordedSql(organization, student)} AND ${riskSql("al")} = 'REVIEW_REQUIRED' AND NOT ${reviewedSql("al")})`;

/** What the newest recorded assessment of a student says about screening. */
export interface ScreeningStanding {
  assessmentId: string;
  assessedOn: string;
  /** 2: the screening is the PAR-Q of the Avaliação Física, and "reviewed" is the professional's recorded decision; null: the earlier format. */
  formatVersion: number | null;
  risk: RiskStatus;
  reviewed: boolean;
  reviewedAt: string | null;
}
export interface StudentAssessmentRow {
  studentId: string;
  studentName: string;
  assessmentId: string | null;
  assessedOn: string | null;
  /** Of the newest recorded assessment (null when there is none); with `formatVersion` it names it on the screens. */
  kind: "INITIAL" | "REASSESSMENT" | null;
  formatVersion: number | null;
  riskStatus: RiskStatus | null;
  reviewed: boolean;
  draftId: string | null;
  /** Of the open draft: null is the earlier format, which can only be discarded. */
  draftFormatVersion: number | null;
}
export type DiscardOutcome = { status: "discarded" } | { status: "photos_left" } | { status: "not_found" };
export type StartOutcome =
  | { status: "started"; id: string }
  /** The student already has an open draft (one per student); `formatVersion` says which format it is (null: the earlier format, which can only be discarded). */
  | { status: "draft_open"; id: string; formatVersion: number | null }
  /** The model asked for is not one of the organization's, or is archived. */
  | { status: "template_not_found" }
  /** The model has a newer version than the one the screen offered (a colleague saved it meanwhile): nothing was started. */
  | { status: "template_changed"; version: number }
  /** The student already has an open draft made with another model (or without one) than the one asked for: nothing was started. */
  | { status: "draft_open_other_model"; id: string }
  | { status: "not_found" };
/** The newest recorded assessment of a student and whether an alert was reviewed. No access check. */
export async function screeningStanding(
  db: D1Database,
  organizationId: string,
  studentId: string,
): Promise<ScreeningStanding | null> {
  const row = await db
    .prepare(
      `SELECT a.id AS assessmentId, a.assessed_on AS assessedOn, a.format_version AS formatVersion, ${riskSql("a")} AS risk,
         CASE WHEN a.format_version = 2 THEN ${screeningValueSql("a", "$.parq.professionalReview.reviewedAt")}
           ELSE (SELECT MAX(r.reviewed_at) FROM assessment_reviews r WHERE r.assessment_id = a.id) END AS reviewedAt
       FROM assessments a
       WHERE a.id = ${latestRecordedSql("?1", "?2")}`,
    )
    .bind(organizationId, studentId)
    .first<{ assessmentId: string; assessedOn: string; formatVersion: number | null; risk: RiskStatus; reviewedAt: string | null }>();
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
    a.state, ${riskSql("a")} AS riskStatus, a.recorded_at AS recordedAt, a.format_version AS formatVersion,
    ${reviewedSql("a")} AS reviewed, a.amends_assessment_id AS amendsAssessmentId,
    (SELECT n.id FROM assessments n WHERE n.amends_assessment_id = a.id AND n.state = 'RECORDED' ORDER BY n.recorded_at DESC LIMIT 1) AS amendedById`;
  const asSummary = <T extends { reviewed: unknown }>(row: T) => ({
    ...row,
    reviewed: Boolean(row.reviewed),
  });
  const parseJson = <T,>(raw: string | null, fallback: T): T => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  type RawResult = { assessmentId: string; code: string; value: number | null; unit: string | null; method: string; formulaVersion: string | null; inputs: string | null; flags: string | null };
  const asResult = (row: RawResult): ResultRow => ({
    code: row.code,
    value: row.value,
    unit: row.unit,
    method: row.method,
    formulaVersion: row.formulaVersion,
    inputs: parseJson<Record<string, unknown> | null>(row.inputs, null),
    flags: parseJson<unknown>(row.flags, []) instanceof Array ? (parseJson<unknown[]>(row.flags, []).filter((flag) => typeof flag === "string") as string[]) : [],
  });
  /** The results of some assessments whose ids came from a gated query (organization and access already checked). */
  const resultsOf = async (ids: string[], codes: readonly string[] | null): Promise<RawResult[]> => {
    if (ids.length === 0) return [];
    const rows = await db
      .prepare(
        `SELECT r.assessment_id AS assessmentId, r.code, r.value, r.unit, r.method, r.formula_version AS formulaVersion, r.inputs, r.flags
         FROM assessment_results r
         WHERE r.organization_id = ?1 AND r.assessment_id IN (SELECT value FROM json_each(?2))
           AND (?3 IS NULL OR r.code IN (SELECT value FROM json_each(?3)))
         ORDER BY r.rowid`,
      )
      .bind(organizationId, JSON.stringify(ids), codes === null ? null : JSON.stringify(codes))
      .all<RawResult>();
    return rows.results;
  };

  const api = {
    async listForStudent(studentId: string): Promise<AssessmentSummary[]> {
      const result = await db
        .prepare(
          `SELECT ${summaryColumns} FROM assessments a
           WHERE a.organization_id = ?1 AND a.student_id = ?3 AND ${reachStudent}
           ORDER BY a.assessed_on DESC, a.created_at DESC`,
        )
        .bind(organizationId, userId, studentId)
        .all<Omit<AssessmentSummary, "results">>();
      const results = await resultsOf(
        result.results.filter((row) => row.state === "RECORDED").map((row) => row.id),
        ["body_fat_percent", "bmi"],
      );
      return result.results.map((row) => ({ ...asSummary(row), results: results.filter((item) => item.assessmentId === row.id).map(asResult) }));
    },

    /** Everything computed when an assessment was finalized (and, for the earlier format, the body fat typed then), in the order written. */
    async results(assessmentId: string): Promise<ResultRow[]> {
      const reachable = await db
        .prepare(`SELECT a.id FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`)
        .bind(organizationId, userId, assessmentId)
        .first<{ id: string }>();
      if (!reachable) return [];
      return (await resultsOf([reachable.id], null)).map(asResult);
    },

    /** The display name of a professional of this organization, by user (who recorded, who decided). Null when unknown. */
    async professionalName(memberUserId: string): Promise<string | null> {
      const row = await db
        .prepare(`SELECT p.display_name AS name FROM professionals p WHERE p.organization_id = ?1 AND p.user_id = ?2`)
        .bind(organizationId, memberUserId)
        .first<{ name: string | null }>();
      return row?.name ?? null;
    },

    /**
     * The reference of the equation chosen in the student's newest recorded Avaliação Física, so a reassessment can suggest it (decision 2 of the
     * user, 02/11/2026): it is offered on the screen, never copied into the draft. Null when there is none or that newest one made no choice (no
     * Medidas): an older choice is never offered in its place.
     */
    async previousEquation(draftId: string): Promise<"male" | "female" | null> {
      const row = await db
        .prepare(
          `SELECT json_extract(s.payload, '$.equation') AS equation
           FROM assessments d
           JOIN assessments p ON p.organization_id = d.organization_id AND p.student_id = d.student_id AND p.state = 'RECORDED' AND p.format_version = 2
           LEFT JOIN assessment_sections s ON s.assessment_id = p.id AND s.module = 'composition'
           WHERE d.organization_id = ?1 AND d.id = ?3 AND ${reachAssessment("d")}
           ORDER BY p.assessed_on DESC, p.recorded_at DESC LIMIT 1`,
        )
        .bind(organizationId, userId, draftId)
        .first<{ equation: unknown }>();
      return row?.equation === "male" || row?.equation === "female" ? row.equation : null;
    },

    async get(assessmentId: string): Promise<AssessmentDetail | null> {
      const row = await db
        .prepare(
          `SELECT ${summaryColumns}, a.previous_assessment_id AS previousAssessmentId,
             ${SCREENING_ITEMS.map((item) => `a.${item.column} AS ${item.key}`).join(", ")},
             a.screening_notes AS screeningNotes, a.notes, a.screening_answered AS screeningAnswered, a.amend_reason AS amendReason,
             a.recorded_by_name AS recordedByName, a.recorded_organization_name AS recordedOrganizationName
           FROM assessments a
           WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`,
        )
        .bind(organizationId, userId, assessmentId)
        .first<Omit<AssessmentSummary, "results"> & Record<ScreeningKey, number> & {
          amendReason: string | null;
          recordedByName: string | null;
          recordedOrganizationName: string | null;
          previousAssessmentId: string | null;
          screeningNotes: string | null;
          notes: string | null;
          screeningAnswered: string | null;
        }>();
      if (!row) return null;
      const [metrics, findings, photoRows, reviews, results] = await Promise.all([
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
        resultsOf([assessmentId], null),
      ]);
      const answered = answeredOf(row.screeningAnswered);
      // Earlier format (no list): a "yes" is an answer; a 0 may be a "no" or a question never asked, so it is shown as not answered.
      const flags = Object.fromEntries(
        SCREENING_ITEMS.map((item) => [item.key, row[item.key] ? true : answered?.has(item.key) ? false : null]),
      ) as Record<ScreeningKey, boolean | null>;
      return {
        id: row.id,
        studentId: row.studentId,
        assessedOn: row.assessedOn,
        kind: row.kind,
        state: row.state,
        riskStatus: row.riskStatus,
        recordedAt: row.recordedAt,
        reviewed: Boolean(row.reviewed),
        formatVersion: row.formatVersion,
        amendsAssessmentId: row.amendsAssessmentId,
        amendedById: row.amendedById,
        amendReason: row.amendReason,
        recordedByName: row.recordedByName,
        recordedOrganizationName: row.recordedOrganizationName,
        results: results.map(asResult),
        previousAssessmentId: row.previousAssessmentId,
        flags,
        earlierFormat: answered === null,
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
     * compares (the results with their method and formula version included). Only the newest `limit` are read. Drafts never appear.
     */
    async history(studentId: string, limit = 24): Promise<AssessmentSnapshot[]> {
      const rows = (
        await db
          .prepare(
            `SELECT ${summaryColumns},
               ${SCREENING_ITEMS.map((item) => `a.${item.column} AS ${item.key}`).join(", ")}
             FROM assessments a
             WHERE a.organization_id = ?1 AND a.student_id = ?3 AND a.state = 'RECORDED'
               AND NOT EXISTS (SELECT 1 FROM assessments n WHERE n.amends_assessment_id = a.id AND n.state = 'RECORDED')
               AND ${reachStudent}
             ORDER BY a.assessed_on DESC, a.recorded_at DESC LIMIT ?4`,
          )
          .bind(organizationId, userId, studentId, Math.max(1, Math.min(limit, 100)))
          .all<Omit<AssessmentSummary, "results"> & Record<ScreeningKey, number>>()
      ).results.reverse();
      if (rows.length === 0) return [];
      // The ids below came from the gated query above.
      const ids = JSON.stringify(rows.map((row) => row.id));
      const [metrics, findings, photoRows, results] = await Promise.all([
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
        // Every result written when each was finalized (and the body fat of the earlier format, method unknown), for the comparable series.
        resultsOf(rows.map((row) => row.id), null),
      ]);
      return rows.map((row) => ({
        id: row.id,
        assessedOn: row.assessedOn,
        recordedAt: row.recordedAt,
        kind: row.kind,
        formatVersion: row.formatVersion,
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
        results: results.filter((result) => result.assessmentId === row.id).map(asResult),
      }));
    },

    /**
     * Opens a draft of the Avaliação Física dated today (the only format that can be started: user's decision of 03/11/2026). One open draft
     * per student: asking again returns it, whatever its format (an open draft of the earlier format can only be discarded). Its modules are
     * sections, and it keeps a snapshot of the student's data as they are now (birth date, height, weight, goal; never the gender, which the
     * equation of a protocol does not take from the profile: decision of the user, 02/11/2026). With a model of the organization (slice 0.85),
     * the draft keeps its newest version and the list of parts that are on; without one, every part is on, as before.
     */
    async startDraft(studentId: string, now = new Date(), options: { templateId?: string | null; templateVersion?: number | null } = {}): Promise<StartOutcome> {
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const templateId = options.templateId ?? null;
      // A model (slice 0.85): its newest version, of this organization and not archived; the draft keeps that version and a copy of its list.
      let template: { version: number; enabled: string } | null = null;
      if (templateId !== null) {
        template = await db
          .prepare(
            `SELECT v.version, v.enabled_modules AS enabled FROM assessment_form_templates t
             JOIN assessment_form_template_versions v ON v.template_id = t.id AND v.organization_id = t.organization_id
             WHERE t.organization_id = ?1 AND t.id = ?2 AND t.archived_at IS NULL
             ORDER BY v.version DESC LIMIT 1`,
          )
          .bind(organizationId, templateId)
          .first<{ version: number; enabled: string }>();
        if (!template) return { status: "template_not_found" };
        // The version the screen named, when it named one: a newer one has another list of parts, so the professional sees it before starting.
        if (typeof options.templateVersion === "number" && template.version !== options.templateVersion) return { status: "template_changed", version: template.version };
      }
      try {
        const result = await db
          .prepare(
            `INSERT INTO assessments
               (id, organization_id, student_id, assessed_on, kind, previous_assessment_id, state,
                risk_status, created_by_user_id, created_at, updated_at, screening_answered, format_version, student_snapshot,
                template_id, template_version, enabled_modules)
             SELECT ?4, s.organization_id, s.id, ?5,
               CASE WHEN EXISTS (SELECT 1 FROM assessments p
                                   WHERE p.student_id = s.id AND p.state = 'RECORDED')
                    THEN 'REASSESSMENT' ELSE 'INITIAL' END,
               (SELECT p.id FROM assessments p WHERE p.student_id = s.id AND p.state = 'RECORDED'
                  ORDER BY p.assessed_on DESC, p.recorded_at DESC LIMIT 1),
               'DRAFT', 'CLEAR', ?2, ?6, ?6, '[]', 2,
               (SELECT json_object('birthDate', p.birth_date, 'heightCm', p.height_cm, 'weightKg', p.weight_kg, 'goal', p.goal)
                 FROM student_profiles p WHERE p.organization_id = s.organization_id AND p.student_id = s.id),
               ?7, ?8, ?9
             FROM students s
             WHERE s.organization_id = ?1 AND s.id = ?3 AND ${activeUser("?2")}
               AND ${technicalAccessExists("s", "?2")}`,
          )
          .bind(organizationId, userId, studentId, id, stamp.slice(0, 10), stamp, templateId, template?.version ?? null, template?.enabled ?? null)
          .run();
        return result.meta.changes > 0 ? { status: "started", id } : { status: "not_found" };
      } catch (error) {
        if (!String(error).includes("UNIQUE")) throw error;
        const open = (await api.listForStudent(studentId)).find((a) => a.state === "DRAFT");
        if (!open) return { status: "not_found" };
        // The open draft keeps its model: asking for another one (or for none) must not silently land in it.
        const model = await db
          .prepare(`SELECT template_id AS templateId FROM assessments WHERE organization_id = ?1 AND id = ?2`)
          .bind(organizationId, open.id)
          .first<{ templateId: string | null }>();
        if ((model?.templateId ?? null) !== templateId) return { status: "draft_open_other_model", id: open.id };
        return { status: "draft_open", id: open.id, formatVersion: open.formatVersion };
      }
    },

    /**
     * The modules of an assessment of the new format, each with its state and its data (handoff V2), and the revision a save must be based on.
     * Null when the assessment is not reachable.
     */
    async sections(assessmentId: string): Promise<{
      revision: number;
      formatVersion: number | null;
      sections: SectionRow[];
      /** The model the draft started with, or null (every part on). */
      template: AssessmentTemplateRef | null;
      /** The optional parts that are on (null: all of them). */
      enabled: EnabledParts;
    } | null> {
      const head = await db
        .prepare(
          `SELECT a.revision, a.format_version AS formatVersion, a.template_id AS templateId, a.template_version AS templateVersion,
             a.enabled_modules AS enabled,
             (SELECT v.name FROM assessment_form_template_versions v
               WHERE v.template_id = a.template_id AND v.version = a.template_version AND v.organization_id = a.organization_id) AS templateName
           FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`,
        )
        .bind(organizationId, userId, assessmentId)
        .first<{ revision: number; formatVersion: number | null; templateId: string | null; templateVersion: number | null; enabled: string | null; templateName: string | null }>();
      if (!head) return null;
      const rows = await db
        .prepare(
          `SELECT module, status, payload, updated_at AS updatedAt FROM assessment_sections
           WHERE organization_id = ?1 AND assessment_id = ?2 ORDER BY module`,
        )
        .bind(organizationId, assessmentId)
        .all<{ module: string; status: SectionStatus; payload: string; updatedAt: string }>();
      return {
        revision: head.revision,
        formatVersion: head.formatVersion,
        template:
          head.templateId !== null && head.templateVersion !== null
            ? { id: head.templateId, version: head.templateVersion, name: head.templateName ?? "Modelo" }
            : null,
        enabled: readEnabledParts(head.enabled),
        sections: rows.results.flatMap((row) => (isModule(row.module) ? [{ module: row.module, status: row.status, payload: JSON.parse(row.payload) as unknown, updatedAt: row.updatedAt }] : [])),
      };
    },

    /**
     * The student's data as the assessment of the new format took them when it started (birth date, height, weight, goal), so a later change
     * of the profile does not change this assessment. Null when the assessment is not reachable or has no snapshot (the earlier format).
     */
    async studentSnapshot(assessmentId: string): Promise<{ birthDate: string | null; heightCm: number | null; weightKg: number | null; goal: string | null } | null> {
      const row = await db
        .prepare(`SELECT a.student_snapshot AS snapshot FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`)
        .bind(organizationId, userId, assessmentId)
        .first<{ snapshot: string | null }>();
      if (!row?.snapshot) return null;
      const raw = JSON.parse(row.snapshot) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
      return { birthDate: text(raw.birthDate), heightCm: number(raw.heightCm), weightKg: number(raw.weightKg), goal: text(raw.goal) };
    },

    /**
     * Discards an open draft, of either format: its sections, computed results, metrics and findings and the draft itself go, in one batch,
     * and the student can start another assessment (one draft per student). An open draft of the earlier format can no longer be filled
     * (decision of 03/11/2026), so this is how nobody stays stuck with one. A draft that still has postural photos is not discarded here: the
     * photos live in the private storage too, so the caller removes them first (`photos_left`). A recorded assessment is never deleted (also
     * a trigger of 0009); only by a professional who reaches the student.
     */
    async discardDraft(assessmentId: string, now = new Date()): Promise<DiscardOutcome> {
      const open = `EXISTS (SELECT 1 FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND a.state = 'DRAFT'
        AND NOT EXISTS (SELECT 1 FROM assessment_photos p WHERE p.organization_id = a.organization_id AND p.assessment_id = a.id)
        AND ${reachAssessment("a")})`;
      const results = await db.batch([
        // A photo erased on a request of the student leaves its erasure row, which references the draft; the photo's own row of a draft is
        // already gone (data-requests), so the erasure of a photo of a draft that is discarded goes with it. The request keeps its answer
        // (the count is written in its outcome when it is fulfilled).
        db.prepare(`DELETE FROM photo_erasures WHERE organization_id = ?1 AND assessment_id = ?3 AND ${open}`).bind(organizationId, userId, assessmentId),
        db.prepare(`DELETE FROM assessment_sections WHERE organization_id = ?1 AND assessment_id = ?3 AND ${open}`).bind(organizationId, userId, assessmentId),
        db.prepare(`DELETE FROM assessment_results WHERE organization_id = ?1 AND assessment_id = ?3 AND ${open}`).bind(organizationId, userId, assessmentId),
        db.prepare(`DELETE FROM assessment_metrics WHERE organization_id = ?1 AND assessment_id = ?3 AND ${open}`).bind(organizationId, userId, assessmentId),
        db.prepare(`DELETE FROM assessment_findings WHERE organization_id = ?1 AND assessment_id = ?3 AND ${open}`).bind(organizationId, userId, assessmentId),
        db
          .prepare(
            `DELETE FROM assessments WHERE organization_id = ?1 AND id = ?3 AND state = 'DRAFT'
               AND NOT EXISTS (SELECT 1 FROM assessment_photos p WHERE p.organization_id = assessments.organization_id AND p.assessment_id = assessments.id)
               AND ${reachAssessment("assessments")}`,
          )
          .bind(organizationId, userId, assessmentId),
        audit("ASSESSMENT_DRAFT_DISCARDED", assessmentId, now.toISOString()),
      ]);
      if (results[5].meta.changes > 0) return { status: "discarded" };
      const left = await db
        .prepare(
          `SELECT 1 AS ok FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND a.state = 'DRAFT' AND ${reachAssessment("a")}
             AND EXISTS (SELECT 1 FROM assessment_photos p WHERE p.organization_id = a.organization_id AND p.assessment_id = a.id)`,
        )
        .bind(organizationId, userId, assessmentId)
        .first();
      return left ? { status: "photos_left" } : { status: "not_found" };
    },

    /**
     * Saves one module of an open draft of the new format, based on the revision the screen read: a save from an older revision (another tab,
     * another person) is refused as a conflict and changes nothing, never the last one silently winning. The payload is checked by the
     * module's own schema before it gets here (`validate`); here only its size.
     */
    async saveSection(
      assessmentId: string,
      input: { module: AssessmentModule; status: SectionStatus; payload: unknown; revision: number },
      now = new Date(),
    ): Promise<SaveSectionOutcome> {
      if (!isModule(input.module) || !(SECTION_STATUSES as readonly string[]).includes(input.status) || !Number.isInteger(input.revision)) return { status: "invalid" };
      const payload = JSON.stringify(input.payload ?? {});
      if (payload.length > MAX_SECTION_CHARS) return { status: "invalid" };
      // A part the draft's model leaves out holds nothing (the list never changes after the draft is created: trigger of 0036).
      const model = await db
        .prepare(`SELECT a.enabled_modules AS enabled FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`)
        .bind(organizationId, userId, assessmentId)
        .first<{ enabled: string | null }>();
      if (model) {
        const excluded = excludedWithData(input.module, input.payload ?? {}, readEnabledParts(model.enabled));
        if (excluded.length > 0) return { status: "excluded", parts: excluded };
      }
      const stamp = now.toISOString();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE assessments SET revision = revision + 1, updated_at = ?5
             WHERE organization_id = ?1 AND id = ?3 AND state = 'DRAFT' AND format_version = 2 AND revision = ?4 AND ${reachAssessment("assessments")}`,
          )
          .bind(organizationId, userId, assessmentId, input.revision, stamp),
        db
          .prepare(
            `INSERT INTO assessment_sections (assessment_id, organization_id, module, status, payload, updated_at, updated_by_user_id)
             SELECT ?3, ?1, ?4, ?5, ?6, ?7, ?2 WHERE (SELECT changes()) > 0
             ON CONFLICT (assessment_id, module) DO UPDATE SET status = excluded.status, payload = excluded.payload,
               updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id`,
          )
          .bind(organizationId, userId, assessmentId, input.module, input.status, payload, stamp),
      ]);
      if (results[0].meta.changes > 0) return { status: "saved", revision: input.revision + 1 };
      const current = await db
        .prepare(`SELECT a.state, a.format_version AS formatVersion, a.revision FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`)
        .bind(organizationId, userId, assessmentId)
        .first<{ state: string; formatVersion: number | null; revision: number }>();
      if (!current || current.state !== "DRAFT" || current.formatVersion !== 2) return { status: "not_found" };
      return { status: "conflict", revision: current.revision };
    },

    /**
     * Finalizes an open draft of the Avaliação Física, based on the revision the screen read, in one batch: every stored module is checked by its
     * schema; the triagem must be complete (every PAR-Q question answered and, with any "Sim", the professional's decision with a note — for an
     * amendment with a new "Sim", that decision looked at again); the results that can be computed are written with the versioned formulas
     * (`reviewDraft`, the same the "Revisão" step shows; one that cannot be computed is not written); the screening is written with the derived
     * flag of any "Sim" and who recorded the decision and when; the modules become DONE and the assessment RECORDED. From then on the triggers of
     * 0009 and 0033 freeze all of it. Nothing here approves anything: the plan gate reads what was recorded.
     */
    async finalize(assessmentId: string, expectedRevision: number, now = new Date()): Promise<FinalizeOutcome> {
      if (!Number.isInteger(expectedRevision)) return { status: "conflict" };
      const head = await db
        .prepare(
          `SELECT a.state, a.format_version AS formatVersion, a.revision, a.assessed_on AS assessedOn, a.student_snapshot AS snapshot,
             a.amends_assessment_id AS amendsId, a.enabled_modules AS enabled
           FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`,
        )
        .bind(organizationId, userId, assessmentId)
        .first<{ state: string; formatVersion: number | null; revision: number; assessedOn: string; snapshot: string | null; amendsId: string | null; enabled: string | null }>();
      if (!head || head.state !== "DRAFT" || head.formatVersion !== 2) return { status: "not_found" };
      if (head.revision !== expectedRevision) return { status: "conflict" };
      const rows = await db
        .prepare(`SELECT module, payload FROM assessment_sections WHERE organization_id = ?1 AND assessment_id = ?2`)
        .bind(organizationId, assessmentId)
        .all<{ module: string; payload: string }>();
      const stored = (module: string) => {
        const row = rows.results.find((item) => item.module === module);
        return row ? (JSON.parse(row.payload) as unknown) : undefined;
      };
      const profile = stored(PROFILE_MODULE) === undefined ? null : profileSchema.safeParse(stored(PROFILE_MODULE));
      const screening = stored(SCREENING_MODULE) === undefined ? null : screeningSchema.safeParse(stored(SCREENING_MODULE));
      const composition = stored(COMPOSITION_MODULE) === undefined ? null : compositionSchema.safeParse(stored(COMPOSITION_MODULE));
      const posture = stored(POSTURE_MODULE) === undefined ? null : postureSchema.safeParse(stored(POSTURE_MODULE));
      const movement = stored(MOVEMENT_MODULE) === undefined ? null : movementSchema.safeParse(stored(MOVEMENT_MODULE));
      const tests = stored(TESTS_MODULE) === undefined ? null : testsSchema.safeParse(stored(TESTS_MODULE));
      const conclusion = stored(CONCLUSION_MODULE) === undefined ? null : conclusionSchema.safeParse(stored(CONCLUSION_MODULE));
      if ([profile, screening, composition, posture, movement, tests, conclusion].some((parsed) => parsed !== null && !parsed.success)) return { status: "invalid" };
      let original: { screening: ReturnType<typeof screeningSchema.parse> | null } | null = null;
      if (head.amendsId) {
        const raw = await db
          .prepare(`SELECT payload FROM assessment_sections WHERE organization_id = ?1 AND assessment_id = ?2 AND module = 'screening'`)
          .bind(organizationId, head.amendsId)
          .first<{ payload: string }>();
        const parsed = raw ? screeningSchema.safeParse(JSON.parse(raw.payload)) : null;
        original = { screening: parsed?.success ? parsed.data : null };
      }
      const snapshot = head.snapshot ? (JSON.parse(head.snapshot) as { birthDate?: unknown }) : {};
      const review = reviewDraft({
        profile: profile?.success ? profile.data : null,
        screening: screening?.success ? screening.data : null,
        composition: composition?.success ? composition.data : null,
        posture: posture?.success ? posture.data : null,
        movement: movement?.success ? movement.data : null,
        tests: tests?.success ? tests.data : null,
        assessedOn: head.assessedOn,
        birthDate: typeof snapshot.birthDate === "string" ? snapshot.birthDate : null,
        original,
        enabled: readEnabledParts(head.enabled),
      });
      if (review.pending.length > 0 || !screening?.success) return { status: "pending", pending: review.pending };
      const stamp = now.toISOString();
      // The batch is one transaction. Every write holds only while the draft is still the one read above (same revision, still a draft, still
      // reachable), and the last statement both moves the revision and records it: a save that landed first leaves every statement without effect.
      const ours = `EXISTS (SELECT 1 FROM assessments g WHERE g.organization_id = ?1 AND g.id = ?3 AND g.state = 'DRAFT' AND g.format_version = 2
        AND g.revision = ?4 AND ${reachAssessment("g")})`;
      const writes = [
        db.prepare(`DELETE FROM assessment_results WHERE organization_id = ?1 AND assessment_id = ?3 AND ${ours}`).bind(organizationId, userId, assessmentId, expectedRevision),
        ...review.results.map((result) =>
          db
            .prepare(
              `INSERT INTO assessment_results (id, assessment_id, organization_id, code, value, unit, method, formula_version, inputs, flags, created_at)
               SELECT ?6, ?3, ?1, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?5 WHERE ${ours}`,
            )
            .bind(
              organizationId,
              userId,
              assessmentId,
              expectedRevision,
              stamp,
              crypto.randomUUID(),
              result.code,
              result.value,
              result.unit,
              result.method,
              result.formulaVersion,
              JSON.stringify(result.inputs),
              JSON.stringify(result.flags),
            ),
        ),
        db
          .prepare(
            `UPDATE assessment_sections SET payload = ?5 WHERE organization_id = ?1 AND assessment_id = ?3 AND module = 'screening' AND ${ours}`,
          )
          .bind(organizationId, userId, assessmentId, expectedRevision, JSON.stringify(recordedScreening(screening.data, userId, stamp, original?.screening ?? null))),
        db
          .prepare(
            `UPDATE assessment_sections SET status = 'DONE', updated_at = ?5, updated_by_user_id = ?2
             WHERE organization_id = ?1 AND assessment_id = ?3 AND ${ours}`,
          )
          .bind(organizationId, userId, assessmentId, expectedRevision, stamp),
      ];
      const results = await db.batch([
        ...writes,
        db
          .prepare(
            `UPDATE assessments SET revision = revision + 1, updated_at = ?5, state = 'RECORDED', recorded_at = ?5, recorded_by_user_id = ?2
             WHERE organization_id = ?1 AND id = ?3 AND state = 'DRAFT' AND format_version = 2 AND revision = ?4 AND ${reachAssessment("assessments")}`,
          )
          .bind(organizationId, userId, assessmentId, expectedRevision, stamp),
        audit("ASSESSMENT_RECORDED", assessmentId, stamp),
      ]);
      if (results[writes.length].meta.changes > 0) return { status: "recorded" };
      const current = await db
        .prepare(`SELECT a.state, a.format_version AS formatVersion FROM assessments a WHERE a.organization_id = ?1 AND a.id = ?3 AND ${reachAssessment("a")}`)
        .bind(organizationId, userId, assessmentId)
        .first<{ state: string; formatVersion: number | null }>();
      return current && current.state === "DRAFT" && current.formatVersion === 2 ? { status: "conflict" } : { status: "not_found" };
    },

    /**
     * Starts an amendment (retificação) of a recorded Avaliação Física: a new draft that points to it, with the reason written (3 to 1000
     * characters), the same date, kind and snapshot, and a copy of its modules to correct — without what finalize wrote (the derived flag, who
     * decided and when), which the amendment records again when it is finalized. The recorded one never changes and stays in the history, read as
     * "Retificada". Only the newest of a chain is amended; one draft per student, as always. It keeps the model (and version) of the one it
     * amends, so its parts are the same: a correction does not bring back a part the original left out, nor drop one it had (slice 0.85).
     */
    async amend(originalId: string, reason: unknown, now = new Date()): Promise<AmendOutcome> {
      const text = typeof reason === "string" ? reason.trim() : "";
      if (text.length < 3 || text.length > 1000) return { status: "invalid_reason" };
      const id = crypto.randomUUID();
      const stamp = now.toISOString();
      const notAmended = `NOT EXISTS (SELECT 1 FROM assessments n WHERE n.amends_assessment_id = o.id AND n.state = 'RECORDED')`;
      try {
        const results = await db.batch([
          db
            .prepare(
              `INSERT INTO assessments
                 (id, organization_id, student_id, assessed_on, kind, previous_assessment_id, state, risk_status, created_by_user_id,
                  created_at, updated_at, screening_answered, format_version, student_snapshot, amends_assessment_id, amend_reason,
                  template_id, template_version, enabled_modules)
               SELECT ?4, o.organization_id, o.student_id, o.assessed_on, o.kind, o.previous_assessment_id, 'DRAFT', 'CLEAR', ?2,
                 ?6, ?6, '[]', 2, o.student_snapshot, o.id, ?5, o.template_id, o.template_version, o.enabled_modules
               FROM assessments o
               WHERE o.organization_id = ?1 AND o.id = ?3 AND o.state = 'RECORDED' AND o.format_version = 2 AND ${notAmended}
                 AND ${reachAssessment("o")}`,
            )
            .bind(organizationId, userId, originalId, id, text, stamp),
          audit("ASSESSMENT_AMENDMENT_STARTED", id, stamp),
          db
            .prepare(
              `INSERT INTO assessment_sections (assessment_id, organization_id, module, status, payload, updated_at, updated_by_user_id)
               SELECT ?3, s.organization_id, s.module, 'IN_PROGRESS',
                 json_remove(s.payload, '$.parq.riskFlag', '$.parq.professionalReview.reviewedAt', '$.parq.professionalReview.reviewerUserId'), ?4, ?2
               FROM assessment_sections s
               WHERE s.organization_id = ?1 AND s.assessment_id = ?5
                 AND EXISTS (SELECT 1 FROM assessments n WHERE n.organization_id = ?1 AND n.id = ?3 AND n.amends_assessment_id = ?5 AND n.state = 'DRAFT')`,
            )
            .bind(organizationId, userId, id, stamp, originalId),
        ]);
        if (results[0].meta.changes > 0) return { status: "started", id };
      } catch (error) {
        if (!String(error).includes("UNIQUE")) throw error;
        const original = await api.get(originalId);
        const open = original ? (await api.listForStudent(original.studentId)).find((item) => item.state === "DRAFT") : undefined;
        return open ? { status: "draft_open", id: open.id } : { status: "not_found" };
      }
      const original = await api.get(originalId);
      if (original?.state === "RECORDED" && original.formatVersion === 2 && original.amendedById) return { status: "already_amended", id: original.amendedById };
      return { status: "not_found" };
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
             l.assessed_on AS assessedOn, l.kind, l.format_version AS formatVersion, ${riskSql("l")} AS riskStatus,
             ${reviewedSql("l")} AS reviewed,
             (SELECT d.id FROM assessments d WHERE d.student_id = s.id AND d.state = 'DRAFT') AS draftId,
             (SELECT d.format_version FROM assessments d WHERE d.student_id = s.id AND d.state = 'DRAFT') AS draftFormatVersion
           FROM students s LEFT JOIN latest l ON l.student_id = s.id
           WHERE s.organization_id = ?1 AND ${activeUser("?2")} AND ${technicalAccessExists("s", "?2")}
           ORDER BY CASE WHEN ${riskSql("l")} = 'REVIEW_REQUIRED' AND NOT ${reviewedSql("l")} THEN 0 ELSE 1 END,
             s.display_name`,
        )
        .bind(organizationId, userId)
        .all<StudentAssessmentRow>();
      return result.results.map(asSummary);
    },
  };
  return api;
}
